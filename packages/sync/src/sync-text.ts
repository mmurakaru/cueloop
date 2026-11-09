/// <reference lib="es2024" />
import * as Y from "yjs";
import * as v from "valibot";

const MAXIMUM_TEXT_LENGTH = 100000;
const MAXIMUM_STATE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_UPDATE_BYTES = 128 * 1024;

export const SyncTextStateSchema = v.pipe(
  v.string(),
  v.minLength(4),
  v.maxLength(Math.ceil(MAXIMUM_STATE_BYTES / 3) * 4),
);
export const SyncTextUpdateSchema = v.pipe(
  v.string(),
  v.minLength(4),
  v.maxLength(Math.ceil(MAXIMUM_UPDATE_BYTES / 3) * 4),
);

export interface SyncTextSnapshot {
  state: string;
  text: string;
}

export interface SyncTextChange extends SyncTextSnapshot {
  update: string;
}

function encodeSyncTextBytes(bytes: Uint8Array): string {
  let binary = "";

  for (const offset of Array.from(
    { length: Math.ceil(bytes.length / 8192) },
    (_, index) => index * 8192,
  )) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }

  return btoa(binary);
}

function decodeSyncTextBytes(value: string, maximumBytes: number): Uint8Array {
  v.parse(v.pipe(v.string(), v.maxLength(Math.ceil(maximumBytes / 3) * 4)), value);
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  if (bytes.byteLength > maximumBytes || encodeSyncTextBytes(bytes) !== value) {
    throw new Error("Sync text encoding must be canonical base64 within its byte budget");
  }

  return bytes;
}

function validateSyncTextContent(text: string): void {
  if (!text.isWellFormed()) throw new Error("Sync text must contain valid Unicode characters");

  if (text.length > MAXIMUM_TEXT_LENGTH) throw new Error("Sync text exceeds its character budget");
}

function readSyncTextSnapshot(document: Y.Doc): SyncTextSnapshot {
  const text = document.getText("content");

  if (document.share.size !== 1 || Object.keys(text.getAttributes()).length !== 0) {
    throw new Error("Sync text document must contain only plain content text");
  }

  v.parse(
    v.array(
      v.object({
        insert: v.string(),
        attributes: v.optional(v.record(v.string(), v.never())),
      }),
    ),
    text.toDelta(),
  );

  const content = text.toString();

  validateSyncTextContent(content);
  const bytes = Y.encodeStateAsUpdate(document);

  if (bytes.byteLength > MAXIMUM_STATE_BYTES)
    throw new Error("Sync text exceeds its state byte budget");

  return { state: encodeSyncTextBytes(bytes), text: content };
}

function openSyncTextDocument(state: string): Y.Doc {
  const document = new Y.Doc();

  try {
    document.getText("content");
    Y.applyUpdate(document, decodeSyncTextBytes(state, MAXIMUM_STATE_BYTES));
    readSyncTextSnapshot(document);

    return document;
  } catch (cause) {
    document.destroy();

    throw cause;
  }
}

function applySyncTextUpdate(document: Y.Doc, bytes: Uint8Array): void {
  const update = Y.decodeUpdate(bytes);

  Y.applyUpdate(document, bytes);
  const applied = Y.decodeStateVector(Y.encodeStateVector(document));

  for (const structure of update.structs) {
    if ((applied.get(structure.id.client) ?? 0) < structure.id.clock + structure.length) {
      throw new Error("Sync text update requires missing document changes");
    }
  }

  for (const [client, ranges] of update.ds.clients) {
    for (const range of ranges) {
      if ((applied.get(client) ?? 0) < range.clock + range.len) {
        throw new Error("Sync text deletion requires missing document changes");
      }
    }
  }
}

/** Creates the shared initial state once, before collaborators derive their edits from it. */
export function createSyncTextState(text: string): SyncTextSnapshot {
  validateSyncTextContent(text);
  const document = new Y.Doc();

  try {
    document.getText("content").insert(0, text);

    return readSyncTextSnapshot(document);
  } finally {
    document.destroy();
  }
}

/** Validates a complete text state without retaining a document or changing its identity. */
export function readSyncTextState(state: string): SyncTextSnapshot {
  const document = openSyncTextDocument(state);

  try {
    return readSyncTextSnapshot(document);
  } finally {
    document.destroy();
  }
}

/** Merges an authorized update without changing the supplied state or retaining a document. */
export function mergeSyncTextUpdate(options: { state: string; update: string }): SyncTextSnapshot {
  const document = openSyncTextDocument(options.state);

  try {
    applySyncTextUpdate(document, decodeSyncTextBytes(options.update, MAXIMUM_UPDATE_BYTES));

    return readSyncTextSnapshot(document);
  } finally {
    document.destroy();
  }
}

function isSyncTextBoundary(text: string, index: number): boolean {
  const previous = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);

  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

/** Owns one editor's text identity; callers explicitly persist, submit, and recover its updates. */
export function createSyncTextDocument(options: { state: string; canEdit: () => boolean }) {
  let document = openSyncTextDocument(options.state);
  let closed = false;
  const requireOpen = () => {
    if (closed) throw new Error("Sync text document is closed");
  };
  const replaceState = (state: string) => {
    const next = openSyncTextDocument(state);

    document.destroy();
    document = next;

    return readSyncTextSnapshot(document);
  };
  const edit = (change: { index: number; deleteCount: number; insert: string }): SyncTextChange => {
    requireOpen();

    if (!options.canEdit())
      throw new Error(
        "Sync text editing requires a connected authority; retain the change as a draft",
      );

    const previous = readSyncTextSnapshot(document);
    const { index, deleteCount, insert } = v.parse(
      v.object({
        index: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
        deleteCount: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
        insert: v.string(),
      }),
      change,
    );

    if (index + deleteCount > previous.text.length)
      throw new Error("Sync text edit is outside the document");

    if (
      !isSyncTextBoundary(previous.text, index) ||
      !isSyncTextBoundary(previous.text, index + deleteCount)
    ) {
      throw new Error("Sync text edit must preserve Unicode character boundaries");
    }

    validateSyncTextContent(
      previous.text.slice(0, index) + insert + previous.text.slice(index + deleteCount),
    );
    const updates: Uint8Array[] = [];
    const capture = (update: Uint8Array) => updates.push(update);

    document.on("update", capture);

    try {
      document.transact(() => {
        const text = document.getText("content");

        text.delete(index, deleteCount);
        text.insert(index, insert);
      });
      const snapshot = readSyncTextSnapshot(document);
      const update = Y.mergeUpdates(updates);

      if (update.byteLength > MAXIMUM_UPDATE_BYTES)
        throw new Error("Sync text edit exceeds its update byte budget");

      return { ...snapshot, update: encodeSyncTextBytes(update) };
    } catch (cause) {
      replaceState(previous.state);

      throw cause;
    } finally {
      document.off("update", capture);
    }
  };

  return {
    get snapshot(): SyncTextSnapshot {
      requireOpen();

      return readSyncTextSnapshot(document);
    },
    edit,
    replace(text: string): SyncTextChange {
      requireOpen();
      validateSyncTextContent(text);
      const previous = document.getText("content").toString();
      let start = 0;
      let end = 0;

      while (start < previous.length && start < text.length && previous[start] === text[start])
        start++;

      if (!isSyncTextBoundary(previous, start)) start--;

      while (
        end < previous.length - start &&
        end < text.length - start &&
        previous[previous.length - end - 1] === text[text.length - end - 1]
      )
        end++;

      if (!isSyncTextBoundary(previous, previous.length - end)) end--;

      return edit({
        index: start,
        deleteCount: previous.length - start - end,
        insert: text.slice(start, text.length - end),
      });
    },
    receive(state: string): SyncTextSnapshot {
      requireOpen();
      const incoming = openSyncTextDocument(state);
      const previous = readSyncTextSnapshot(document);

      try {
        applySyncTextUpdate(document, Y.encodeStateAsUpdate(incoming));

        return readSyncTextSnapshot(document);
      } catch (cause) {
        replaceState(previous.state);

        throw cause;
      } finally {
        incoming.destroy();
      }
    },
    updateSince(state: string): string {
      requireOpen();
      const base = openSyncTextDocument(state);

      try {
        const update = Y.encodeStateAsUpdate(document, Y.encodeStateVector(base));

        if (update.byteLength > MAXIMUM_UPDATE_BYTES)
          throw new Error("Sync text draft exceeds its update byte budget");

        return encodeSyncTextBytes(update);
      } finally {
        base.destroy();
      }
    },
    reset(state: string): SyncTextSnapshot {
      requireOpen();

      return replaceState(state);
    },
    close() {
      closed = true;
      document.destroy();
    },
  };
}

/** Maps a UTF-16 text position through shared changes, or reports an unavailable anchor. */
export function mapSyncTextPosition(options: {
  fromState: string;
  toState: string;
  index: number;
  association?: -1 | 0;
}): number | undefined {
  const previous = openSyncTextDocument(options.fromState);

  try {
    const text = previous.getText("content");

    if (
      !Number.isSafeInteger(options.index) ||
      options.index < 0 ||
      options.index > text.length ||
      !isSyncTextBoundary(text.toString(), options.index)
    )
      return undefined;

    const relative = Y.createRelativePositionFromTypeIndex(
      text,
      options.index,
      options.association ?? -1,
    );
    const next = openSyncTextDocument(options.toState);

    try {
      const absolute = Y.createAbsolutePositionFromRelativePosition(relative, next);

      return absolute?.type === next.getText("content") ? absolute.index : undefined;
    } finally {
      next.destroy();
    }
  } finally {
    previous.destroy();
  }
}

/** A serialized text position contains item identities, not the selected text. */
export function createSyncTextPosition(options: {
  state: string;
  index: number;
  association?: -1 | 0;
}): string {
  const document = openSyncTextDocument(options.state);

  try {
    const text = document.getText("content");

    if (
      !Number.isSafeInteger(options.index) ||
      options.index < 0 ||
      options.index > text.length ||
      !isSyncTextBoundary(text.toString(), options.index)
    )
      throw new Error("Sync text position must be a Unicode boundary within the document");

    return encodeSyncTextBytes(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, options.index, options.association ?? -1),
      ),
    );
  } finally {
    document.destroy();
  }
}

/** Missing items and invalid text positions remain explicitly unavailable. */
export function resolveSyncTextPosition(options: {
  state: string;
  position: string;
}): number | undefined {
  const document = openSyncTextDocument(options.state);

  try {
    const relative = Y.decodeRelativePosition(decodeSyncTextBytes(options.position, 768));
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, document);

    return absolute?.type === document.getText("content") ? absolute.index : undefined;
  } catch {
    return undefined;
  } finally {
    document.destroy();
  }
}

export type {
  SyncTextEditorSnapshot,
  SyncTextEditorSession,
  SyncTextSaveOutcome,
  SyncTextRevision,
} from "./sync-text-session.ts";

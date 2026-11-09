import { SyncPresenceIndicator } from "./SyncPresenceIndicator";
import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  mapSyncTextPosition,
  type SyncTextEditorSession,
  type SyncTextSaveOutcome,
} from "@cueloop/sync/text";
import { toSyncPlanHistoryEntry, orphanedSyncPlanAnnotations } from "@cueloop/daemon/sync-plan";
import type { Annotation } from "@cueloop/schema";
import type { Theme } from "../appearance/theme";
import { MarkdownThreadEditor } from "../markdown/components/MarkdownThreadEditor";
import { useReadySignal } from "../app/ready-signal";
import { useSharedKeyboard } from "../keyboard/use-shared-keyboard";

const EMPTY_ANNOTATIONS: readonly Annotation[] = [];
const CONNECTION_LABELS = {
  initializing: "Loading",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Offline",
  "needs-auth": "Sign in required",
  error: "Connection error",
  closed: "Closed",
};
const FRESHNESS_LABELS = {
  unknown: "Loading data",
  cached: "Cached data",
  complete: "Live data",
  error: "Data error",
};

export function SyncThreadEditor({
  session,
  theme,
  onExit,
  annotations = EMPTY_ANNOTATIONS,
  onReady,
}: {
  session: SyncTextEditorSession;
  theme: Theme;
  onExit: (outcome: SyncTextSaveOutcome) => void;
  annotations?: readonly Annotation[];
  onReady?: () => void;
}): React.ReactNode {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const readSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
  const previousState = useRef(snapshot.textState);
  const [error, setError] = useState<string>();
  const mapCursor = useCallback(
    (index: number, association?: -1 | 0) =>
      mapSyncTextPosition({
        fromState: previousState.current,
        toState: snapshot.textState,
        index,
        association,
      }),
    [snapshot.textState],
  );
  const orphaned = useMemo(
    () =>
      annotations.length
        ? orphanedSyncPlanAnnotations({ annotations, content: snapshot.text })
        : [],
    [annotations, snapshot.text],
  );
  const revision = snapshot.revision ? toSyncPlanHistoryEntry(snapshot.revision) : undefined;
  const save = async (text: string) => {
    setError(undefined);

    try {
      if (text !== session.getSnapshot().text) session.change(text);

      const outcome = await session.save();

      if (
        outcome.status === "accepted" ||
        outcome.status === "draft" ||
        outcome.status === "unchanged"
      )
        onExit(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shared text could not be saved");
    }
  };

  useLayoutEffect(() => {
    previousState.current = snapshot.textState;
  }, [snapshot.textState]);
  useSharedKeyboard((key) => {
    if (key.ctrl && (key.name === "q" || key.name === "c")) {
      key.preventDefault();
      onExit({ status: "draft" });
    } else if (
      !snapshot.editable &&
      !snapshot.saving &&
      key.name === "return" &&
      (key.ctrl || key.meta || key.super)
    ) {
      key.preventDefault();
      void save(snapshot.text);
    }
  });

  useReadySignal(true, onReady);

  const draftLabel = snapshot.saving
    ? "Saving"
    : snapshot.operation === "pending"
      ? "Request pending"
      : snapshot.operation === "rejected"
        ? "Rejected draft"
        : snapshot.draftSaved
          ? "Draft saved locally"
          : "Editing";
  const message = error ?? snapshot.error;

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ height: 1, flexShrink: 0, paddingLeft: 2 }}>
        <text
          fg={theme.text}
        >{`Shared plan  ${CONNECTION_LABELS[snapshot.connection]}  ${FRESHNESS_LABELS[snapshot.freshness]}  ${draftLabel}`}</text>
      </box>
      {snapshot.presence ? (
        <SyncPresenceIndicator
          presence={snapshot.presence}
          textState={snapshot.textState}
          documentIdentifier={snapshot.documentIdentifier}
          theme={theme}
        />
      ) : null}
      {revision?.type === "revision" && revision.author ? (
        <box style={{ height: 1, flexShrink: 0, paddingLeft: 2 }}>
          <text fg={theme.textMuted}>{`Last saved by ${revision.author}`}</text>
        </box>
      ) : null}
      {orphaned.length ? (
        <box style={{ height: 1, flexShrink: 0, paddingLeft: 2 }}>
          <text
            fg={theme.textMuted}
          >{`${orphaned.length} orphaned annotation${orphaned.length === 1 ? "" : "s"}`}</text>
        </box>
      ) : null}
      {message ? (
        <box style={{ height: 1, flexShrink: 0, paddingLeft: 2 }}>
          <text fg={theme.textMuted}>{message}</text>
        </box>
      ) : null}
      <MarkdownThreadEditor
        initialText={snapshot.text}
        text={snapshot.text}
        onTextChange={(value) => {
          setError(undefined);
          session.change(value);
        }}
        onSelectionChange={(selection) => session.select?.(selection)}
        editable={snapshot.editable}
        mapCursor={mapCursor}
        theme={theme}
        onExitEditor={(text) => void save(text)}
        footerHint={
          snapshot.operation === "pending"
            ? "⌃⏎ check request  ⌃q close"
            : "⌃⏎ save & close  ⌃q keep draft"
        }
      />
    </box>
  );
}

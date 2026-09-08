import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { viewFollowing, type Artifact, type WorkspaceKey } from "@cueloop/schema";
import { DaemonCore } from "./api";
import { MAX_BLOB_BYTES, packSessionBlob, unpackSessionBlob } from "./share-blob";

const WS: WorkspaceKey = { repoRoot: "/repo", branch: "main" };
const PLAN: Artifact = { type: "plan", content: "# Plan\n\nDo the thing.\n", meta: {} };

let home: string;
let core: DaemonCore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-blob-"));
  core = new DaemonCore(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("share blob roundtrip", () => {
  test("pack then unpack restores the session with its annotations", () => {
    // Arrange
    const session = core.sessionCreate({ workspace: WS, artifact: PLAN });
    const annotated = core.sessionAnnotate(session.id, {
      id: "a_1",
      kind: "comment",
      anchor: { quote: "the thing", prefix: "", suffix: "" },
      body: "why this?",
    });

    // Act
    const restored = unpackSessionBlob(packSessionBlob(annotated));

    // Assert
    expect(restored).toEqual(annotated);
  });
});

describe("the payload cap against a long review", () => {
  test("a plan the size of the examples with a long discussion and its history stays far under the cap", () => {
    // Arrange: the largest example plan, 200 rounds of comment + reply, 20 reviewer edits, 10 removals
    const paragraph =
      "Review sessions currently live only in daemon memory. If the daemon crashes mid-review, every pending annotation is lost. This plan makes sessions durable without changing the daemon's socket protocol.\n\n";
    const content = `# Implementation Plan: Session Persistence\n\n## Context\n\n${paragraph.repeat(8)}`;
    const session = core.sessionCreate({
      workspace: WS,
      artifact: { type: "plan", content, meta: {} },
    });

    for (let round = 0; round < 200; round++) {
      core.sessionAnnotate(session.id, {
        id: `a_${round}`,
        kind: "comment",
        anchor: { quote: "daemon memory", prefix: "live only in ", suffix: ". If the" },
        body: `Round ${round}: what happens when the store directory is read-only at startup?`,
        author: "SHA256:collaborator-fingerprint-0123456789abcdef",
      });
      core.sessionAnnotate(session.id, {
        id: `r_${round}`,
        kind: "comment",
        anchor: { quote: "daemon memory", prefix: "live only in ", suffix: ". If the" },
        body: "Fail fast with a readable error; the review never opens on a store that cannot write.",
        replyTo: `a_${round}`,
      });
      if (round % 10 === 0)
        core.sessionSetWorkingCopy(session.id, `${content}\n\nEdit ${round}.\n`);
      if (round % 20 === 0) core.sessionRemoveAnnotation(session.id, `r_${round}`);
    }
    const shared = viewFollowing(core.sessionGet(session.id));

    // Act
    const decompressed = Buffer.byteLength(JSON.stringify(shared), "utf8");
    const packed = packSessionBlob(shared).byteLength;

    // Assert: a quarter of the cap decompressed, and the packed blob a small
    // fraction of it; the round-trip holds
    expect(shared.history!.entries.length).toBeGreaterThan(400);
    expect(decompressed).toBeLessThan(MAX_BLOB_BYTES / 4);
    expect(packed).toBeLessThan(decompressed);
    expect(unpackSessionBlob(packSessionBlob(shared)).history!.entries.length).toBe(
      shared.history!.entries.length,
    );
    console.info(
      `share payload: ${shared.history!.entries.length} entries, ${decompressed} bytes decompressed, ${packed} bytes packed, cap ${MAX_BLOB_BYTES}`,
    );
  });
});

describe("unpack rejects bad input", () => {
  test("caps the decompressed size, so a compression bomb throws", () => {
    // Arrange: tiny gzip, huge inflation - the decompression-bomb shape
    const bomb = gzipSync(Buffer.alloc(MAX_BLOB_BYTES + 1, 0x61));

    // Act / Assert
    expect(() => unpackSessionBlob(bomb)).toThrow(/exceeds|maxOutputLength/i);
  });

  test("throws on bytes that are not gzip", () => {
    // Act / Assert
    expect(() => unpackSessionBlob(Buffer.from("not gzip at all"))).toThrow(/gzip/i);
  });

  test("throws on a shape that is not a session", () => {
    // Arrange
    const notASession = gzipSync(Buffer.from(JSON.stringify({ hello: "world" })));

    // Act / Assert
    expect(() => unpackSessionBlob(notASession)).toThrow(/not a valid session/i);
  });
});

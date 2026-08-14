import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact, WorkspaceKey } from "@cueloop/schema";
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

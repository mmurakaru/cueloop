#!/usr/bin/env bun
/**
 * Landing snapshot seeder: an Effect-TS error-handling diff with a "me" note and
 * a collaborator's, anchored to changed lines, so the rail shows both. Opens the
 * real TUI; a vhs tape drives it and captures the frame. Isolated home.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";
import { diffRows, diffRowAnchor } from "../packages/client/src/view-diff";

const home = mkdtempSync(join(tmpdir(), "cueloop-snapshot-diff-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const PATCH = `diff --git a/src/user-service.ts b/src/user-service.ts
index 3a1f2b1..9c4e7a2 100644
--- a/src/user-service.ts
+++ b/src/user-service.ts
@@ -8,7 +8,11 @@ export const getUser = (id: string) =>
   Effect.gen(function* () {
-    const row = yield* db.query(id)
-    return row
+    const row = yield* db.query(id).pipe(
+      Effect.retry(Schedule.recurs(2)),
+      Effect.catchTag("QueryError", (e) => Effect.fail(new UserLookupFailed({ id, cause: e }))),
+    )
+    return yield* Effect.fromNullable(row).pipe(
+      Effect.mapError(() => new UserNotFound({ id })),
+    )
   })
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "effect-errors" },
  artifact: { type: "diff", content: PATCH, meta: { title: "user-service.ts", agent: "pi" } },
});

const rows = diffRows(PATCH);
const rowAt = (needle: string): number => rows.findIndex((row) => row.text.includes(needle));
const anchorAt = (needle: string) => {
  const index = rowAt(needle);
  return { ...diffRowAnchor(rows, index), blockIndex: index };
};

// the reviewer's own note
server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: anchorAt("catchTag"),
  body: "retry then catchTag - won't this retry the not-found path too?",
});

// a collaborator with a lowercase handle (renders "nelson")
server.core.sessionMergeShared(session.id, {
  annotations: [
    {
      id: "collab_nelson",
      kind: "comment",
      anchor: anchorAt("fromNullable"),
      body: "nice - fromNullable + mapError beats an `if (row == null)` guard.",
      author: "nelson",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
});

console.log(`seeded ${session.id}`);
await runClient({ home, sessionId: session.id });
server.stop();

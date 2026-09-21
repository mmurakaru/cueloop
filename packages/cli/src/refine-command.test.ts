/** refine builds a corpus report from stored sessions and skips sessions it has already analyzed on a later run. */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Annotation, Thread, Message, MessageOutcome } from "@cueloop/schema";
import { ThreadStore } from "@cueloop/daemon/store";
import { reportsDir } from "@cueloop/daemon/paths";
import { buildRefineReport } from "@cueloop/adapters/refine-corpus";
import { refineCommand } from "./refine-command";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "cueloop-refine-home-"));
}

function annotation(quote: string, body: string): Annotation {
  return {
    id: `a_${quote}`,
    kind: "comment",
    anchor: { quote, prefix: "", suffix: "" },
    body,
    createdAt: "2026-08-20T10:00:00Z",
  };
}

function message(outcome: MessageOutcome): Message {
  return {
    id: `msg_${outcome}`,
    outcome,
    summary: "",
    body: "",
    sentAt: "2026-08-20T11:00:00Z",
  };
}

function session(
  id: string,
  overrides: Partial<Thread> & { type?: Thread["artifact"]["type"] } = {},
): Thread {
  const { type, ...rest } = overrides;

  return {
    schemaVersion: "1",
    id,
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: type ?? "plan", content: "", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-08-20T10:00:00Z",
    ...rest,
  };
}

describe("buildRefineReport", () => {
  test("reports the analyzed and total counts, distributions, and annotations", () => {
    // Arrange
    const analyzed = [
      session("ses_a", { message: message("approved"), status: "resolved" }),
      session("ses_b", {
        type: "diff",
        message: message("changes_requested"),
        status: "resolved",
        annotations: [annotation("skip tests", "please add a regression test")],
      }),
    ];

    // Act
    const markdown = buildRefineReport(analyzed, 3, "2026-08-26T00:00:00.000Z");

    // Assert
    expect(markdown).toContain("2 sessions analyzed (3 total).");
    expect(markdown).toContain("- plan: 1");
    expect(markdown).toContain("- diff: 1");
    expect(markdown).toContain("- approved: 1");
    expect(markdown).toContain("- request changes: 1");
    expect(markdown).toContain("skip tests");
    expect(markdown).toContain("please add a regression test");
  });

  test("notes when there are no reviewer annotations", () => {
    // Act
    const markdown = buildRefineReport([], 0, "2026-08-26T00:00:00.000Z");

    // Assert
    expect(markdown).toContain("0 sessions analyzed (0 total).");
    expect(markdown).toContain("No reviewer annotations in the analyzed sessions.");
  });
});

describe("refineCommand", () => {
  test("writes a report, skips signal-free sessions, and consumes only resolved sessions", async () => {
    // Arrange
    const home = tempHome();
    const store = new ThreadStore(home);

    store.upsert(session("ses_a", { message: message("approved"), status: "resolved" }));
    store.upsert(
      session("ses_b", {
        message: message("changes_requested"),
        status: "resolved",
        annotations: [annotation("wrong file", "this belongs in store.ts")],
      }),
    );
    store.upsert(
      session("ses_pending", { annotations: [annotation("open point", "still deciding")] }),
    );
    store.upsert(session("ses_empty"));
    const reportPath = join(reportsDir(home), "report.md");

    // Act
    const firstCode = await refineCommand(["--home", home]);

    // Assert
    expect(firstCode).toBe(0);
    expect(readFileSync(reportPath, "utf8")).toContain("3 sessions analyzed (4 total).");

    // Act
    await refineCommand(["--home", home]);

    // Assert
    expect(readFileSync(reportPath, "utf8")).toContain("1 sessions analyzed (4 total).");
  });

  test("re-analyzes a resolved session that is reopened and resolved again with new feedback", async () => {
    // Arrange
    const home = tempHome();
    const store = new ThreadStore(home);

    store.upsert(
      session("ses_x", {
        message: message("approved"),
        status: "resolved",
        annotations: [annotation("first", "one")],
      }),
    );
    const reportPath = join(reportsDir(home), "report.md");

    // Act
    await refineCommand(["--home", home]);

    // Assert
    expect(readFileSync(reportPath, "utf8")).toContain("1 sessions analyzed (1 total).");

    // Arrange
    store.upsert(
      session("ses_x", {
        message: { ...message("changes_requested"), sentAt: "2026-08-21T09:00:00Z" },
        status: "resolved",
        annotations: [annotation("first", "one"), annotation("second", "two")],
      }),
    );

    // Act
    await refineCommand(["--home", home]);

    // Assert
    const secondReport = readFileSync(reportPath, "utf8");

    expect(secondReport).toContain("1 sessions analyzed (1 total).");
    expect(secondReport).toContain("two");
  });
});

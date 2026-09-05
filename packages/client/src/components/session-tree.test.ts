import { describe, expect, test } from "bun:test";
import type { ReviewSession, WorkspaceKey } from "@cueloop/schema";
import { groupInbox, projectName } from "./session-tree";

function session(id: string, title: string, rootCommit?: string, remote?: string): ReviewSession {
  const workspace: WorkspaceKey = { repoRoot: `/home/dev/${id}-checkout`, branch: "main" };
  if (rootCommit !== undefined) workspace.rootCommit = rootCommit;
  if (remote !== undefined) workspace.remote = remote;

  return {
    schemaVersion: "1",
    id,
    workspace,
    artifact: { type: "plan", content: `# ${title}\n`, meta: { title } },
    revisions: [],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("projectName", () => {
  test("prefers the remote basename and strips the .git suffix", () => {
    // Arrange
    const workspace: WorkspaceKey = {
      repoRoot: "/tmp/whatever",
      branch: "main",
      remote: "git@github.com:acme/widget.git",
    };

    // Act
    const name = projectName(workspace);

    // Assert
    expect(name).toBe("widget");
  });

  test("falls back to the working-tree folder name when there is no remote", () => {
    // Arrange
    const workspace: WorkspaceKey = { repoRoot: "/home/dev/cueloop", branch: "main" };

    // Act
    const name = projectName(workspace);

    // Assert
    expect(name).toBe("cueloop");
  });
});

describe("groupInbox", () => {
  test("splits repo-bound threads into Projects and the rest into Threads", () => {
    // Arrange
    const sessions = [
      session("a", "Read the repo", "root-1", "git@github.com:acme/widget.git"),
      session("b", "A loose idea"),
    ];

    // Act
    const { rows, ordered } = groupInbox(sessions);

    // Assert
    const labels = rows.map((row) => `${row.kind}:${"label" in row ? row.label : row.id}`);
    expect(labels).toEqual([
      "section:Projects",
      "project:widget",
      "thread:a",
      "section:Threads",
      "thread:b",
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("collapses threads sharing a root commit into one project", () => {
    // Arrange
    const sessions = [
      session("a", "First", "root-1", "git@github.com:acme/widget.git"),
      session("b", "Second", "root-1", "git@github.com:acme/widget.git"),
    ];

    // Act
    const { rows, ordered } = groupInbox(sessions);

    // Assert
    const projectRows = rows.filter((row) => row.kind === "project");
    expect(projectRows).toHaveLength(1);
    expect(ordered).toHaveLength(2);
  });

  test("selectionIndex on each thread matches its position in ordered", () => {
    // Arrange
    const sessions = [session("a", "One", "root-1"), session("b", "Two")];

    // Act
    const { rows, ordered } = groupInbox(sessions);

    // Assert
    for (const row of rows) {
      if (row.kind === "thread") expect(ordered[row.selectionIndex]!.id).toBe(row.id);
    }
  });

  test("omits the Projects section when nothing is repo-bound", () => {
    // Arrange
    const sessions = [session("a", "Loose one"), session("b", "Loose two")];

    // Act
    const { rows } = groupInbox(sessions);

    // Assert
    expect(rows.some((row) => row.kind === "section" && row.label === "Projects")).toBe(false);
    expect(rows.some((row) => row.kind === "section" && row.label === "Threads")).toBe(true);
  });
});

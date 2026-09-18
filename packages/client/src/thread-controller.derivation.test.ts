import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION, type Annotation, type Thread } from "@cueloop/schema";
import { sameDerivationInputs } from "./thread-controller";

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n\nShip it.\n", meta: {} },
    revisions: [
      { revision: 1, content: "# Plan\n\nShip it.\n", submittedAt: "2026-01-01T00:00:00.000Z" },
    ],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const annotation: Annotation = {
  id: "ann_1",
  kind: "comment",
  anchor: { quote: "Ship it.", prefix: "", suffix: "" },
  body: "nit",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("sameDerivationInputs", () => {
  test("an annotation-only update reuses the projection (a fresh record, identical inputs)", () => {
    // Arrange - the daemon re-serializes the whole thread on any change, so the record is all-new
    const before = threadFixture();
    const after = threadFixture({ annotations: [annotation] });

    // Assert - the artifact and working copy are unchanged, so the projection can be reused
    expect(sameDerivationInputs(before, after)).toBe(true);
  });

  test("a content edit forces a re-derivation", () => {
    const before = threadFixture();
    const after = threadFixture({
      artifact: { type: "plan", content: "# Plan\n\nShip it soon.\n", meta: {} },
    });

    expect(sameDerivationInputs(before, after)).toBe(false);
  });

  test("a working-copy change forces a re-derivation", () => {
    const before = threadFixture();
    const after = threadFixture({ workingCopy: "# Plan\n\nShip it.\n\nedited\n" });

    expect(sameDerivationInputs(before, after)).toBe(false);
  });

  test("a different thread is never a reuse", () => {
    const before = threadFixture();
    const after = threadFixture({ id: "ses_2" });

    expect(sameDerivationInputs(before, after)).toBe(false);
  });
});

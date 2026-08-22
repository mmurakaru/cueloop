import { describe, expect, test } from "bun:test";
import { HARNESS_LAUNCHERS, planHandoffBriefing } from "./agent-launcher";

describe("planHandoffBriefing", () => {
  test("references the session by id and directs the agent to read then annotate, not rewrite", () => {
    // Act
    const briefing = planHandoffBriefing("ses_42");

    // Assert
    expect(briefing).toContain("cueloop session get ses_42");
    expect(briefing).toContain("cueloop session annotate ses_42");
    expect(briefing).toContain("Do not rewrite the plan");
  });
});

describe("HARNESS_LAUNCHERS", () => {
  test("carries the three branded harnesses with their launch commands", () => {
    // Assert
    expect(HARNESS_LAUNCHERS.map((harness) => harness.command)).toEqual(["cc", "pi", "codex"]);
  });
});

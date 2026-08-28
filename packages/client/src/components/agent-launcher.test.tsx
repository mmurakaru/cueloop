import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { fixturePlanSession } from "./story-fixtures";
import { waitForText } from "../test-support";
import { AgentLauncher, HARNESS_LAUNCHERS, planHandoffBriefing } from "./agent-launcher";

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
  test("carries the three harnesses with real binary commands (never the `cc` alias)", () => {
    // Assert - `cc` resolves to the system C compiler when spawned on a PTY, so
    // the Claude harness must run `claude`, the real binary, not the shell alias
    expect(HARNESS_LAUNCHERS.map((harness) => harness.command)).toEqual(["claude", "pi", "codex"]);
  });
});

describe("AgentLauncher", () => {
  test("renders a button for every harness, in order", async () => {
    // Arrange
    const setup = await testRender(
      <box style={{ width: 44, height: 20, flexDirection: "column" }}>
        <AgentLauncher session={fixturePlanSession()} onLaunchHarness={() => {}} theme={DARK} />
      </box>,
      { width: 44, height: 20 },
    );

    // Act
    await waitForText(setup, "Claude Code");
    const frame = setup.captureCharFrame();

    // Assert - all three launcher names present, in launch order
    const names = HARNESS_LAUNCHERS.map((harness) => harness.name);
    const positions = names.map((name) => frame.indexOf(name));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
  });
});

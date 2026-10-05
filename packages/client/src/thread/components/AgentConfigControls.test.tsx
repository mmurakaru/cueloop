import React, { useState } from "react";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../../appearance/theme";
import { RootOverlayProvider } from "../../ui/components/RootOverlay";
import { MenuControlProvider, useMenuControlState } from "../../ui/components/menu-control";
import { locateText, waitForText, settle } from "../../testing/test-support";
import { AgentConfigControls } from "./AgentConfigControls";
import type { ThreadAgentState } from "@cueloop/schema";

const initial: ThreadAgentState = {
  threadId: "test",
  phase: { kind: "idle" },
  comments: [],
  messages: [],
  tools: [],
  configOptions: [
    {
      id: "model",
      name: "Model",
      currentValue: "first",
      options: [
        { value: "first", name: "First model" },
        { value: "second", name: "Second model" },
        ...Array.from({ length: 18 }, (_, index) => ({
          value: `extra-${index}`,
          name: `Extra model ${index}`,
        })),
      ],
    },
    {
      id: "effort",
      name: "Reasoning",
      category: "thought_level",
      currentValue: "medium",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ],
};

test("model and reasoning choices share the existing overlay and close after selection", async () => {
  const choices: string[] = [];

  function TestMenus(): React.ReactNode {
    const menu = useMenuControlState();
    const [state, setState] = useState(initial);

    return (
      <MenuControlProvider value={menu}>
        <RootOverlayProvider>
          <box style={{ height: 20, flexDirection: "column" }}>
            <box style={{ flexGrow: 1 }}>
              <text>Thread body</text>
            </box>
            <AgentConfigControls
              state={state}
              theme={DARK}
              onConfigure={(id, value) => {
                choices.push(`${id}:${value}`);
                setState({
                  ...state,
                  configOptions: state.configOptions?.map((option) =>
                    option.id === id ? { ...option, currentValue: value } : option,
                  ),
                });
              }}
            />
          </box>
        </RootOverlayProvider>
      </MenuControlProvider>
    );
  }
  const setup = await testRender(<TestMenus />, { width: 80, height: 20 });
  const click = async (text: string) => {
    const point = locateText(setup, text);

    await setup.mockMouse.click(point.column, point.row);
    await settle(setup);
  };

  try {
    await waitForText(setup, "First model");
    await click("First model");
    await waitForText(setup, "Second model");
    await click("Second model");
    expect(choices).toEqual(["model:second"]);
    expect(setup.captureCharFrame()).not.toContain("First model");
    await click("Medium");
    await waitForText(setup, "High");
    await click("High");
    expect(choices).toEqual(["model:second", "effort:high"]);
    expect(setup.captureCharFrame()).not.toContain("Medium");
    await click("Second model");
    expect(setup.captureCharFrame()).not.toContain("Extra model 17");
    const model = locateText(setup, "First model");

    for (let count = 0; count < 12; count++)
      await setup.mockMouse.scroll(model.column, model.row, "down");
    await settle(setup);
    await waitForText(setup, "Extra model 17");
    await click("Extra model 17");
    expect(choices.at(-1)).toBe("model:extra-17");
    await click("Extra model 17");
    await click("Thread body");
    expect(setup.captureCharFrame()).not.toContain("First model");
  } finally {
    setup.renderer.destroy();
  }
});

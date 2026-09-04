import React from "react";
import { DARK, type Theme } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ThemeProvider } from "./theme-context";
import { Card } from "./primitives/Card";

export const meta: StoryMeta = { title: "Foundations/Theme" };

/** A high-contrast variant to prove tokens flow through the provider. */
const HIGH_CONTRAST: Theme = { ...DARK, accent: "#00ffff", elevated: "#000000", border: "#ffffff" };

export const ContextDefault: Story = {
  render: () => (
    <Card title=" default dark theme " contentRows={1}>
      <text>no provider needed</text>
    </Card>
  ),
  expectedColors: [DARK.elevated],
};

export const ProviderSwap: Story = {
  render: () => (
    <ThemeProvider theme={HIGH_CONTRAST}>
      <Card title=" provider theme " contentRows={1} borderColor={HIGH_CONTRAST.accent}>
        <text>tokens come from the provider</text>
      </Card>
    </ThemeProvider>
  ),
  expectedColors: ["#00ffff", "#000000"],
};

export const PropOverride: Story = {
  render: () => (
    <ThemeProvider theme={DARK}>
      <Card
        title=" prop-overridden theme "
        contentRows={1}
        theme={HIGH_CONTRAST}
        borderColor={HIGH_CONTRAST.accent}
      >
        <text>the theme prop beats the context</text>
      </Card>
    </ThemeProvider>
  ),
  expectedColors: ["#00ffff"],
};

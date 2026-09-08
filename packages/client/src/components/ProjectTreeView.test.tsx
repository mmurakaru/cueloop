import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ProjectTreeView } from "./ProjectTreeView";
import { clickText, waitForText } from "../test-support";
import { DARK } from "../theme";

test("renders the loaded files as a tree and opens a file on click", async () => {
  const opened: string[] = [];
  const setup = await testRender(
    <ProjectTreeView
      loadFiles={() => Promise.resolve(["src/App.tsx", "README.md"])}
      onSelectFile={(path) => opened.push(path)}
      theme={DARK}
    />,
    { width: 40, height: 16 },
  );

  await waitForText(setup, "README.md");
  await clickText(setup, "README.md");

  expect(opened).toContain("README.md");
});

test("shows an empty hint when there are no files", async () => {
  const setup = await testRender(
    <ProjectTreeView loadFiles={() => Promise.resolve([])} onSelectFile={() => {}} theme={DARK} />,
    { width: 40, height: 8 },
  );

  await waitForText(setup, "empty");
});

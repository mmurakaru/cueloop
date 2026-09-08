import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { FileContentsView } from "./FileContentsView";
import { waitForText } from "../test-support";
import { DARK } from "../theme";

test("renders the loaded file contents", async () => {
  const setup = await testRender(
    <FileContentsView
      path="src/add.ts"
      loadContents={() => Promise.resolve("const answer = 42;\n")}
      theme={DARK}
    />,
    { width: 60, height: 10 },
  );

  await waitForText(setup, "const answer = 42;");
});

test("shows a not-found hint when the file cannot be read", async () => {
  const setup = await testRender(
    <FileContentsView path="missing.ts" loadContents={() => Promise.resolve(null)} theme={DARK} />,
    { width: 60, height: 10 },
  );

  await waitForText(setup, "could not read missing.ts");
  expect(setup.captureCharFrame()).toContain("could not read missing.ts");
});

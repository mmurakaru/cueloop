import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  ClientExtensionRegistry,
  loadInstalledClientExtensions,
} from "../client-extension-registry";
import { settle } from "../test-support";
import { AppShell } from "./AppShell";

function shell(
  registry?: ClientExtensionRegistry,
  onExtensionError?: (message: string) => void,
): React.ReactNode {
  return (
    <AppShell
      sidebarOpen
      onToggleSidebar={() => {}}
      onOpenMenu={() => {}}
      threadsPanel={<text>threads list</text>}
      threadTitle="Thread"
      threadPanel={<text>thread body</text>}
      changesOpen={false}
      projectOpen
      onToggleChanges={() => {}}
      onToggleProject={() => {}}
      onToggleRight={() => {}}
      projectMode="tree"
      focusedPane="project"
      projectPanel={<text>project files</text>}
      extensionRegistry={registry}
      extensionContext={{ workspace: "/repo", threadId: "thread-1" }}
      onExtensionError={onExtensionError}
    />
  );
}

describe("app shell extension zones", () => {
  test("an empty registry preserves the built-in shell frame", async () => {
    const plain = await testRender(shell(), { width: 100, height: 16 });
    const extended = await testRender(shell(new ClientExtensionRegistry()), {
      width: 100,
      height: 16,
    });

    await settle(plain);
    await settle(extended);
    expect(extended.captureCharFrame()).toBe(plain.captureCharFrame());
    plain.renderer.destroy();
    extended.renderer.destroy();
  });

  test("renders a sidebar section and workspace tab without replacing built-in content", async () => {
    const registry = new ClientExtensionRegistry();

    await registry.load("example", (api) => {
      api.registerSection({
        id: "summary",
        zone: "threads.sidebar",
        title: "Summary",
        Component: () => <text>extension summary</text>,
      });
      api.registerView({
        id: "details",
        zone: "workspace.panels",
        title: "Details",
        Component: () => <text>extension details</text>,
      });
    });
    const setup = await testRender(shell(registry), { width: 100, height: 16 });

    await settle(setup);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("extension summary");
    expect(frame).toContain("Details");
    expect(frame).toContain("project files");
    setup.mockInput.pressKey("]");
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("extension details");
    expect(setup.captureCharFrame()).not.toContain("project files");
    setup.mockInput.pressKey("[");
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("project files");
    setup.renderer.destroy();
  });

  test("an installed client entry can use the host React hooks", async () => {
    const root = mkdtempSync(join(tmpdir(), "cueloop-client-extension-test-"));
    const packageRoot = join(root, "node_modules", "example-client");

    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "example-client": "1.0.0" } }),
      );
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({ cueloop: { client: "./client.js" } }),
      );
      writeFileSync(
        join(packageRoot, "client.js"),
        `export default (api) => {
        const React = api.react;
        api.registerSection({ id: "hook", zone: "threads.sidebar", title: "Host hook",
          Component: () => { const [count] = React.useState(1); return React.createElement("text", null, String(count)); }
        });
      };`,
      );
      const registry = new ClientExtensionRegistry();

      await loadInstalledClientExtensions(registry, root);
      const setup = await testRender(shell(registry), { width: 100, height: 16 });

      await settle(setup);
      expect(registry.errors).toEqual([]);
      expect(setup.captureCharFrame()).toContain("Host hook");
      expect(setup.captureCharFrame()).toContain("1");
      setup.renderer.destroy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports a failed client entry through the host error callback", async () => {
    const registry = new ClientExtensionRegistry();
    const errors: string[] = [];
    const setup = await testRender(
      shell(registry, (message) => errors.push(message)),
      { width: 100, height: 16 },
    );

    registry.reportError("Client extension example: failed to load");
    await settle(setup);
    expect(errors).toEqual(["Client extension example: failed to load"]);
    setup.renderer.destroy();
  });
});

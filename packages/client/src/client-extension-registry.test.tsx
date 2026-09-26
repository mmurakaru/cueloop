import { describe, expect, test } from "bun:test";
import React from "react";
import { ClientExtensionRegistry } from "./client-extension-registry";

const Component = () => <></>;

describe("client extension registry", () => {
  test("registers each contribution and removes it on disposal", async () => {
    const registry = new ClientExtensionRegistry();
    const before = registry.snapshot();
    let notifications = 0;
    const unsubscribe = registry.subscribe(() => notifications++);
    const loaded = await registry.load("example", (api) => {
      api.registerSection({ id: "summary", zone: "threads.sidebar", title: "Summary", Component });
      api.registerAction({ id: "open", zone: "thread.header", label: "Open", onPress() {} });
      api.registerView({ id: "details", zone: "workspace.panels", title: "Details", Component });
    });

    expect(registry.snapshot()).not.toBe(before);
    expect(registry.snapshot().sections.map(({ key }) => key)).toEqual(["example:summary"]);
    expect(registry.snapshot().actions.map(({ key }) => key)).toEqual(["example:open"]);
    expect(registry.snapshot().views.map(({ key }) => key)).toEqual(["example:details"]);
    loaded.dispose();
    unsubscribe();
    expect(registry.snapshot().sections).toEqual([]);
    expect(registry.snapshot().actions).toEqual([]);
    expect(registry.snapshot().views).toEqual([]);
    expect(notifications).toBe(6);
  });

  test("rolls back a factory that fails after registering", async () => {
    const registry = new ClientExtensionRegistry();

    await registry.load("broken", (api) => {
      api.registerSection({ id: "summary", zone: "threads.sidebar", title: "Summary", Component });
      throw new Error("boom");
    });

    expect(registry.snapshot().sections).toEqual([]);
    expect(registry.errors[0]).toContain("boom");
  });

  test("a disposed registration cannot remove a later registration with the same ID", async () => {
    const registry = new ClientExtensionRegistry();
    let first: { dispose(): void } | undefined;

    await registry.load("example", (api) => {
      first = api.registerSection({
        id: "summary",
        zone: "threads.sidebar",
        title: "Old",
        Component,
      });
      first.dispose();
      api.registerSection({ id: "summary", zone: "threads.sidebar", title: "New", Component });
    });
    first?.dispose();

    expect(registry.snapshot().sections[0]?.value.title).toBe("New");
  });
});

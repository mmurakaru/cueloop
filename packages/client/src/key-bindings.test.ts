/** Config keys resolve to per-layer actions, and status hints derive from getActiveKeys() so rebinds surface. */

import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYS } from "./config";
import { KeyBindings } from "./key-bindings";

function bindings(context: { overlay?: "none" | "walk" | "compose" | "submit"; spanMode?: boolean } = {}): KeyBindings {
  const resolver = new KeyBindings(DEFAULT_KEYS);
  resolver.setContext({ overlay: context.overlay ?? "none", spanMode: context.spanMode ?? false });
  return resolver;
}

describe("grammar-layer resolution", () => {
  const table: [name: string, shift: boolean, action: string | undefined][] = [
    ["j", false, "down"],
    ["down", false, "down"],
    ["k", false, "up"],
    ["g", false, "top"],
    ["g", true, "bottom"],
    ["v", false, "span"],
    ["c", false, "comment"],
    ["s", false, "suggest"],
    ["x", false, "cut"],
    ["e", false, "edit"],
    ["n", false, "next_annotation"],
    ["p", false, "prev_annotation"],
    ["backspace", false, "delete_annotation"],
    ["return", false, "submit"],
    ["enter", false, "submit"],
    ["q", false, "quit"],
    ["z", false, undefined],
  ];
  for (const [name, shift, action] of table) {
    test(`${shift ? "shift+" : ""}${name} -> ${action}`, () => {
      expect(bindings().resolveAction({ name, shift })).toBe(action!);
    });
  }
});

describe("mode layers own their keys", () => {
  test("span mode resolves the span verbs, not the grammar", () => {
    // Arrange
    const resolver = bindings({ spanMode: true });

    // Assert
    expect(resolver.resolveAction({ name: "l", shift: false })).toBe("span_grow");
    expect(resolver.resolveAction({ name: "c", shift: false })).toBe("span_comment");
    expect(resolver.resolveAction({ name: "escape", shift: false })).toBe("span_cancel");
  });

  test("the compose overlay only knows save and cancel", () => {
    // Arrange
    const resolver = bindings({ overlay: "compose" });

    // Assert
    expect(resolver.resolveAction({ name: "return", shift: false })).toBe("save_compose");
    expect(resolver.resolveAction({ name: "escape", shift: false })).toBe("cancel_overlay");
    expect(resolver.resolveAction({ name: "j", shift: false })).toBeUndefined();
  });

  test("the submit overlay adds the verdict arrows", () => {
    // Arrange
    const resolver = bindings({ overlay: "submit" });

    // Assert
    expect(resolver.resolveAction({ name: "left", shift: false })).toBe("cycle_verdict_left");
    expect(resolver.resolveAction({ name: "right", shift: false })).toBe("cycle_verdict_right");
    expect(resolver.resolveAction({ name: "return", shift: false })).toBe("submit_verdict");
  });

  test("the walk overlay owns the bracket stepping and leaves the grammar keys dead", () => {
    // Arrange
    const resolver = bindings({ overlay: "walk" });

    // Assert
    expect(resolver.resolveAction({ name: "]", shift: false })).toBe("walk_next");
    expect(resolver.resolveAction({ name: "[", shift: false })).toBe("walk_prev");
    expect(resolver.resolveAction({ name: "escape", shift: false })).toBe("walk_leave");
    expect(resolver.resolveAction({ name: "return", shift: false })).toBe("walk_submit");
    expect(resolver.resolveAction({ name: "q", shift: false })).toBe("quit");
    expect(resolver.resolveAction({ name: "j", shift: false })).toBeUndefined();
    expect(resolver.resolveAction({ name: "c", shift: false })).toBeUndefined();
  });
});

describe("getActiveKeys-generated status hints", () => {
  test("normal mode hint matches the locked string", () => {
    expect(bindings().statusHint("normal")).toBe(
      "j/k move · v span · drag selects · c comment · s suggest · x cut · e edit · n/p annotations · ⏎ submit · q quit",
    );
  });

  test("card-selected hint keeps the locked Cut label", () => {
    expect(bindings().statusHint("card")).toBe("card · e edit · x Cut · n/p cards · esc deselect · ⏎ submit");
  });

  test("span hint", () => {
    expect(bindings({ spanMode: true }).statusHint("span")).toBe(
      "span · l/h grow/shrink · w/b slide · $ end · c comment · s suggest · esc",
    );
  });

  test("compose hint", () => {
    expect(bindings({ overlay: "compose" }).statusHint("compose")).toBe("typing · ⏎ save · esc cancel");
  });

  test("submit hint", () => {
    expect(bindings({ overlay: "submit" }).statusHint("submit")).toBe("verdict ←/→ · ⏎ submit · esc cancel");
  });

  test("walk hint", () => {
    expect(bindings({ overlay: "walk" }).statusHint("walk")).toBe(
      "walk · ] next (marks viewed) · [ back · esc leave walk · q quit",
    );
  });

  test("read-only hint", () => {
    expect(bindings().statusHint("read-only")).toBe("observer - read-only · j/k move · n/p annotations · q quit");
  });

  test("a rebound key shows its real binding in the hint", () => {
    // Arrange
    const resolver = new KeyBindings({ ...DEFAULT_KEYS, comment: ["m"] });
    resolver.setContext({ overlay: "none", spanMode: false });

    // Assert
    expect(resolver.resolveAction({ name: "m", shift: false })).toBe("comment");
    expect(resolver.resolveAction({ name: "c", shift: false })).toBeUndefined();
    expect(resolver.statusHint("normal")).toContain("m comment");
  });
});

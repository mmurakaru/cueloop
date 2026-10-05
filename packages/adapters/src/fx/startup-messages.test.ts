import { expect, test } from "bun:test";
import { FxLegacyStartupMessages } from "./startup-messages";

const catalog =
  "[context] skill catalog shortened 112 descriptions: effective=20480 bytes source=compiled default\n";

test("a legacy startup line cannot swallow an HTTP error under the same message ID", () => {
  const diagnostics: string[] = [];
  const messages = new FxLegacyStartupMessages((text) => diagnostics.push(text));

  expect(messages.push("operational", catalog)).toBeUndefined();
  expect(messages.push("operational", "HTTP 401: authentication failed\n")).toBe(
    "HTTP 401: authentication failed\n",
  );
  expect(diagnostics).toEqual([catalog]);
});

test("split startup lines route only the known line and preserve its following text", () => {
  const messages = new FxLegacyStartupMessages(() => {});

  expect(messages.push("notice", catalog.slice(0, 20))).toBeUndefined();
  expect(messages.push("notice", catalog.slice(20) + "An answer\n")).toBe("An answer\n");
  expect(messages.finish()).toEqual([]);
});

test("unknown wording and an assistant discussing notices remain visible", () => {
  const messages = new FxLegacyStartupMessages(() => {});

  expect(messages.push("answer", "You asked about ")).toBe("You asked about ");
  expect(messages.push("answer", catalog)).toBe(catalog);
  expect(messages.push("unknown", "[context] important permission failure")).toBe(
    "[context] important permission failure",
  );
  expect(messages.push("quoted", "[context] skill catalog shortened this is an example\n")).toBe(
    "[context] skill catalog shortened this is an example\n",
  );
});

test("incomplete notices flush at turn completion and pending buffers are bounded", () => {
  const messages = new FxLegacyStartupMessages(() => {});

  expect(messages.push("short", "skill")).toBeUndefined();
  expect(messages.finish()).toEqual([{ id: "short", text: "skill" }]);
  const oversized = "skill discovery warning: candidate " + "x".repeat(32768);

  expect(messages.push("long", oversized)).toBe(oversized);
});

test("chunks without a message ID cannot suppress later unrelated output", () => {
  const messages = new FxLegacyStartupMessages(() => {});

  expect(messages.push(undefined, catalog)).toBeUndefined();
  expect(messages.push(undefined, "A real answer")).toBe("A real answer");
});

test("excess message identities fail open instead of creating unbounded pending buffers", () => {
  const messages = new FxLegacyStartupMessages(() => {});

  for (let i = 0; i < 128; i++) expect(messages.push(String(i), "skill")).toBeUndefined();
  expect(messages.push("overflow", "skill")).toBe("skill");
  expect(messages.finish()).toHaveLength(128);
});

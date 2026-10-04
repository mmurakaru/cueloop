import { expect, test } from "bun:test";
import { FxStartupMessages } from "./startup-messages";

test("startup notices and their continuation chunks do not enter the answer stream", () => {
  const messages = new FxStartupMessages();

  expect(messages.push("notice", "[context] skill cat")).toBeUndefined();
  expect(
    messages.push("notice", "alog shortened 112 descriptions: effective=20480"),
  ).toBeUndefined();
  expect(messages.push("notice", "source=compiled default\n")).toBeUndefined();
  expect(
    messages.push("notice", "skill discovery warning: candidate /workspace/skill"),
  ).toBeUndefined();
  expect(messages.push("answer", "The diff changes the timeout.")).toBe(
    "The diff changes the timeout.",
  );
  expect(messages.finish()).toEqual([]);
});

test("a discovery warning without a preceding catalog notice is suppressed", () => {
  const messages = new FxStartupMessages();

  expect(messages.push("notice", "skill discovery warn")).toBeUndefined();
  expect(messages.push("notice", 'ing: candidate "/workspace/skill" was skipped')).toBeUndefined();
  expect(messages.push("answer", "Here is the answer.")).toBe("Here is the answer.");
});

test("answers discussing notices, unknown notices, and errors are preserved", () => {
  const messages = new FxStartupMessages();

  expect(messages.push("answer", "You asked about ")).toBe("You asked about ");
  expect(messages.push("answer", "skill discovery warning: candidate /workspace/skill")).toBe(
    "skill discovery warning: candidate /workspace/skill",
  );
  expect(messages.push("unknown", "[context] important permission failure")).toBe(
    "[context] important permission failure",
  );
  expect(messages.push("error", "Error: provider authentication failed")).toBe(
    "Error: provider authentication failed",
  );
});

test("ambiguous partial prefixes flush at completion and IDs can be reused on a later turn", () => {
  const messages = new FxStartupMessages();

  expect(messages.push("short", "skill")).toBeUndefined();
  expect(messages.finish()).toEqual([{ id: "short", text: "skill" }]);
  expect(messages.push("short", "A new answer")).toBe("A new answer");
});

test("unidentified chunks cannot suppress unrelated answers", () => {
  const messages = new FxStartupMessages();

  expect(
    messages.push(undefined, "skill discovery warning: candidate /workspace/skill"),
  ).toBeUndefined();
  expect(messages.push(undefined, "A real answer")).toBe("A real answer");
});

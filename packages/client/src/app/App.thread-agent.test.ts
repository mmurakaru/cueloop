import { expect, test } from "bun:test";
import { canRunThreadAgent } from "./App";

test("experimental agent UI requires a local owner and an enabled flag", () => {
  const local = { enabled: true, owner: true, editing: false, shared: false };

  expect(canRunThreadAgent(local)).toBe(true);
  expect(canRunThreadAgent({ ...local, enabled: false })).toBe(false);
  expect(canRunThreadAgent({ ...local, owner: false })).toBe(false);
  expect(canRunThreadAgent({ ...local, editing: true })).toBe(false);
  expect(canRunThreadAgent({ ...local, shared: true })).toBe(false);
});

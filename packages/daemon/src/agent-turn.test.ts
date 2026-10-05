import { expect, test } from "bun:test";
import { stepAgentTurn, type AgentTurn } from "./agent-turn";

test("an initialization stop settles before accepting a fresh turn", () => {
  const starting = stepAgentTurn({ kind: "idle" }, "start");
  const stopped = stepAgentTurn(starting, "stop");
  const ready = stepAgentTurn(stopped, "ready");

  expect(ready).toEqual({ kind: "idle" });
  expect(stepAgentTurn(ready, "start")).toEqual({ kind: "starting", cancelled: false });
});

test("an active stop waits for completion before accepting another turn", () => {
  const running: AgentTurn = { kind: "running" };
  const stopped = stepAgentTurn(running, "stop");

  expect(stopped).toEqual({ kind: "stopping" });
  expect(stepAgentTurn(stopped, "start")).toEqual(stopped);
  expect(stepAgentTurn(stopped, "ready")).toEqual(stopped);
  expect(stepAgentTurn(stepAgentTurn(stopped, "finished"), "start")).toEqual({
    kind: "starting",
    cancelled: false,
  });
});

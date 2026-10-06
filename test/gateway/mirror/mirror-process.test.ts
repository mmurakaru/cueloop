import { afterEach, expect, test } from "bun:test";
import {
  cancelMirrorRun,
  finishMirrorRun,
  runMirrorCommand,
  waitForMirrorCondition,
} from "./mirror-process";

afterEach(finishMirrorRun);

test("cancellation interrupts a running subprocess and allows cleanup commands", async () => {
  const running = runMirrorCommand([process.execPath, "-e", "setInterval(() => {}, 1000)"]);

  cancelMirrorRun();
  await expect(running).rejects.toThrow("Gateway mirror cancelled");
  finishMirrorRun();
  expect(
    (await runMirrorCommand([process.execPath, "-e", "console.log('cleanup')"])).toString(),
  ).toBe("cleanup\n");
});

test("cancellation interrupts readiness polling", async () => {
  const waiting = waitForMirrorCondition("never ready", () => false);

  cancelMirrorRun();
  await expect(waiting).rejects.toThrow("Gateway mirror cancelled");
});

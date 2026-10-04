import { expect, test } from "bun:test";
import { routeHarnessOutput } from "./harness-output-routing";

test("identical assistant and diagnostic wording takes different destinations", () => {
  const text =
    "[context] skill catalog shortened 112 descriptions: effective=20480 bytes source=compiled default\n";

  expect(routeHarnessOutput({ kind: "message", text }).destination).toBe("thread");
  expect(
    routeHarnessOutput({
      kind: "diagnostic",
      text,
      severity: "future-severity",
      title: "Notice",
      source: "protocol",
    }).destination,
  ).toBe("diagnostics");
});

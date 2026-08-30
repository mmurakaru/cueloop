import { describe, expect, test } from "bun:test";
import { daemonSpawnCommand } from "./client";

describe("daemonSpawnCommand", () => {
  test("re-execs the binary as `daemon` when compiled (bun virtual-fs markers)", () => {
    for (const moduleUrl of [
      "file:///$bunfs/root/cueloop",
      "file:///B:/~BUN/root/cueloop",
      "file:///B:/%7EBUN/root/cueloop",
    ]) {
      expect(daemonSpawnCommand("/usr/local/bin/cueloop", moduleUrl)).toEqual([
        "/usr/local/bin/cueloop",
        "daemon",
        "--autostart",
      ]);
    }
  });

  test("runs main.ts with bun from source", () => {
    expect(
      daemonSpawnCommand("/path/to/bun", "file:///repo/packages/daemon/src/client.ts"),
    ).toEqual(["/path/to/bun", "run", "/repo/packages/daemon/src/main.ts"]);
  });
});

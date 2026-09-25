import { expect, test } from "bun:test";
import { join } from "node:path";

test("Claude plugin registers only the Mod, without a broad command hook", async () => {
  const manifest = await Bun.file(join(import.meta.dir, "hooks.json")).json();

  expect(manifest).toMatchObject({ modules: ["./register.ts"] });
  expect(manifest).not.toHaveProperty("hooks");
});

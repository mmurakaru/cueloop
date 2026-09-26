import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstalledExtensionPackages } from "./installed-packages";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function installFixture(
  name: string,
  cueloop: { client?: string; daemon?: string } | undefined,
): string {
  const root = mkdtempSync(join(tmpdir(), "cueloop-extensions-test-"));
  const packageRoot = join(root, "node_modules", name);

  roots.push(root);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { [name]: "1.0.0" } }));
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name, cueloop }));
  writeFileSync(join(packageRoot, "client.js"), "export default () => {};");
  writeFileSync(join(packageRoot, "daemon.js"), "export default () => {};");

  return root;
}

describe("installed extension discovery", () => {
  test("finds separate client and daemon entry points in a scoped package", () => {
    const root = installFixture("@example/tools", { client: "./client.js", daemon: "./daemon.js" });
    const result = discoverInstalledExtensionPackages(root);

    expect(result.errors).toEqual([]);
    expect(result.packages).toEqual([
      {
        name: "@example/tools",
        root: join(root, "node_modules", "@example/tools"),
        clientEntry: realpathSync(join(root, "node_modules", "@example/tools/client.js")),
        daemonEntry: realpathSync(join(root, "node_modules", "@example/tools/daemon.js")),
      },
    ]);
  });

  test("rejects an entry outside its package and continues discovery", () => {
    const root = installFixture("example", { client: "./../outside.js" });
    const result = discoverInstalledExtensionPackages(root);

    expect(result.packages).toEqual([]);
    expect(result.errors[0]).toContain("entry escapes package root");
  });

  test("rejects a symlink entry that leaves the package", () => {
    const root = installFixture("example", { client: "./linked.js" });
    const outside = join(root, "outside.js");

    writeFileSync(outside, "export default () => {};");
    symlinkSync(outside, join(root, "node_modules/example/linked.js"));

    expect(discoverInstalledExtensionPackages(root).errors[0]).toContain(
      "entry escapes package root",
    );
  });

  test("rejects a directory entry before installation succeeds", () => {
    const root = installFixture("example", { client: "./folder" });

    mkdirSync(join(root, "node_modules/example/folder"));

    expect(discoverInstalledExtensionPackages(root).errors[0]).toContain("entry is not a file");
  });

  test("rejects a package without a cueloop manifest", () => {
    const root = installFixture("example", undefined);

    expect(discoverInstalledExtensionPackages(root).errors[0]).toContain("no cueloop manifest");
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installExtensionCommand } from "./install-command";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function testRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cueloop-install-test-"));

  roots.push(root);

  return root;
}

describe("cueloop install", () => {
  test("rejects sources outside npm without running a package command", async () => {
    const root = testRoot();
    let called = false;

    expect(
      await installExtensionCommand(["file:./extension"], {
        installRoot: root,
        runPackageCommand: async () => {
          called = true;

          return { exitCode: 0, stderr: "" };
        },
      }),
    ).toBe(2);
    expect(called).toBe(false);
  });

  test("installs a package whose manifest declares a client entry", async () => {
    const root = testRoot();
    const commands: string[][] = [];
    const result = await installExtensionCommand(["npm:@example/tools@1.0.0"], {
      installRoot: root,
      runPackageCommand: async (args) => {
        commands.push(args);
        const packageRoot = join(root, "node_modules", "@example/tools");

        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(
          join(root, "package.json"),
          JSON.stringify({ dependencies: { "@example/tools": "1.0.0" } }),
        );
        writeFileSync(
          join(packageRoot, "package.json"),
          JSON.stringify({ cueloop: { client: "./client.js" } }),
        );
        writeFileSync(join(packageRoot, "client.js"), "export default () => {};");

        return { exitCode: 0, stderr: "" };
      },
    });

    expect(result).toBe(0);
    expect(commands).toEqual([["add", "--ignore-scripts", "--cwd", root, "@example/tools@1.0.0"]]);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies).toEqual({
      "@example/tools": "1.0.0",
    });
  });

  test("removes a package without a cueloop manifest", async () => {
    const root = testRoot();
    const commands: string[][] = [];
    const result = await installExtensionCommand(["npm:example"], {
      installRoot: root,
      runPackageCommand: async (args) => {
        commands.push(args);
        if (args[0] === "add") {
          const packageRoot = join(root, "node_modules", "example");

          mkdirSync(packageRoot, { recursive: true });
          writeFileSync(
            join(root, "package.json"),
            JSON.stringify({ dependencies: { example: "1.0.0" } }),
          );
          writeFileSync(join(packageRoot, "package.json"), "{}");
        }

        return { exitCode: 0, stderr: "" };
      },
    });

    expect(result).toBe(1);
    expect(commands[1]).toEqual(["remove", "--ignore-scripts", "--cwd", root, "example"]);
  });

  test("restores the prior version after an invalid upgrade", async () => {
    const root = testRoot();
    const packageRoot = join(root, "node_modules", "example");
    const commands: string[][] = [];

    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { example: "1.0.0" } }),
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ version: "1.0.0", cueloop: { client: "./client.js" } }),
    );
    writeFileSync(join(packageRoot, "client.js"), "export default () => {};");
    const result = await installExtensionCommand(["npm:example@2.0.0"], {
      installRoot: root,
      runPackageCommand: async (args) => {
        commands.push(args);
        if (args.at(-1) === "example@2.0.0") {
          writeFileSync(
            join(root, "package.json"),
            JSON.stringify({ dependencies: { example: "2.0.0" } }),
          );
          writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "2.0.0" }));
        } else {
          writeFileSync(
            join(root, "package.json"),
            JSON.stringify({ dependencies: { example: "1.0.0" } }),
          );
          writeFileSync(
            join(packageRoot, "package.json"),
            JSON.stringify({ version: "1.0.0", cueloop: { client: "./client.js" } }),
          );
        }

        return { exitCode: 0, stderr: "" };
      },
    });

    expect(result).toBe(1);
    expect(commands[1]).toEqual(["add", "--ignore-scripts", "--cwd", root, "example@1.0.0"]);
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies.example).toBe(
      "1.0.0",
    );
  });
});

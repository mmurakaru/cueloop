import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("statement padding separates declarations, branches, and returns without changing comments or strings", () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-statement-padding-"));
  const config = join(directory, "config.json");

  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [
        {
          name: "statement-padding",
          specifier: resolve("tools/oxlint/statement-padding/index.ts"),
        },
      ],
      categories: { correctness: "off" },
      rules: { "statement-padding/blank-lines": "error" },
    }),
  );
  const cases = [
    [
      "use();\nif (ready) publish();\nconst stream = open();\n",
      "use();\n\nif (ready) publish();\n\nconst stream = open();\n",
    ],
    [
      "restore();\nif (text()) publish();\nstream.start();\n",
      "restore();\n\nif (text()) publish();\n\nstream.start();\n",
    ],
    [
      "if (first) use();\nelse if (second) other();\nelse fallback();\nfinish();\n",
      "if (first) use();\nelse if (second) other();\nelse fallback();\n\nfinish();\n",
    ],
    [
      "if (first) use(); // Keep with branch.\n// Explain next branch.\nif (second) other();\n",
      "if (first) use(); // Keep with branch.\n\n// Explain next branch.\nif (second) other();\n",
    ],
    [
      "use();\r\nif (ready) publish();\r\nfinish();\r\n",
      "use();\r\n\r\nif (ready) publish();\r\n\r\nfinish();\r\n",
    ],
    [
      "const value = 1; /* first */ /* trailing\ncomment */ if (value) use();\n",
      "const value = 1; /* first */ /* trailing\ncomment */ \n\nif (value) use();\n",
    ],
    [
      "const value = 1; /* trailing\ncomment */ if (value) use();\n",
      "const value = 1; /* trailing\ncomment */ \n\nif (value) use();\n",
    ],
    ["const value = 1;\r\nif (value) use();\r\n", "const value = 1;\r\n\r\nif (value) use();\r\n"],
    [
      "const first = 1;\nconst second = 2;\nif (first) use(second);\n",
      "const first = 1;\nconst second = 2;\n\nif (first) use(second);\n",
    ],
    [
      "function value() {\n  use();\n  return 1;\n}\n",
      "function value() {\n  use();\n\n  return 1;\n}\n",
    ],
    [
      "const value = 1;\n// Why this branch exists.\nif (value) use();\n",
      "const value = 1;\n\n// Why this branch exists.\nif (value) use();\n",
    ],
    [
      "const value = 1; // Keep with declaration.\nif (value) use();\n",
      "const value = 1; // Keep with declaration.\n\nif (value) use();\n",
    ],
    [
      "const text = `const value = 1;\nif (value) use();`;\n\nuse(text);\n",
      "const text = `const value = 1;\nif (value) use();`;\n\nuse(text);\n",
    ],
    ["const first = 1;\n\nif (first) use();\n", "const first = 1;\n\nif (first) use();\n"],
  ];

  try {
    const fixtures = cases.map(([input], index) => {
      const fixture = join(directory, `fixture-${index}.ts`);

      writeFileSync(fixture, input!);

      return fixture;
    });
    const command = [resolve("node_modules/.bin/oxlint"), "--config", config];
    const fixed = Bun.spawnSync([...command, "--fix", ...fixtures]);

    expect(fixed.exitCode).toBe(0);
    for (const [index, fixture] of fixtures.entries()) {
      expect(readFileSync(fixture, "utf8")).toBe(cases[index]![1]!);
    }
    const checked = Bun.spawnSync([...command, ...fixtures]);

    expect(checked.exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

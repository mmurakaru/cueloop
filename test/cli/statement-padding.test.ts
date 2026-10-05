import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("statement padding fixes declaration and return boundaries without changing comments or strings", () => {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-statement-padding-"));
  const config = join(directory, "config.json");
  const fixture = join(directory, "fixture.ts");

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
    for (const [input, output] of cases) {
      writeFileSync(fixture, input!);
      const fixed = Bun.spawnSync([
        resolve("node_modules/.bin/oxlint"),
        "--config",
        config,
        "--fix",
        fixture,
      ]);

      expect(fixed.exitCode).toBe(0);
      expect(readFileSync(fixture, "utf8")).toBe(output!);
      const checked = Bun.spawnSync([
        resolve("node_modules/.bin/oxlint"),
        "--config",
        config,
        fixture,
      ]);

      expect(checked.exitCode).toBe(0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

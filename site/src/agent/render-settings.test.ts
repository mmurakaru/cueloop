import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../astro.config.mjs";

const siteRoot = fileURLToPath(new URL("../..", import.meta.url));

function readBuiltFile(relativePath: string): string {
  return readFileSync(join(siteRoot, "dist", relativePath), "utf8");
}

describe("site render settings", () => {
  beforeAll(async () => {
    const build = Bun.spawn(["bunx", "astro", "build"], {
      cwd: siteRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await build.exited;

    if (code !== 0) {
      throw new Error(await new Response(build.stderr).text());
    }
  }, 30000);

  test("keeps literal dashes and inline spaces in the built site", () => {
    const installPage = readBuiltFile("docs/install/index.html");
    const homePage = readBuiltFile("index.html");

    expect(installPage).toContain("cueloop --version");
    expect(installPage).not.toContain("cueloop \u2013version");
    expect(homePage).toContain('plan, diff <span class="amp">&amp;</span> review.');
  });

  test("the configured markdown processor leaves punctuation literal", async () => {
    const processor = config.markdown?.processor;

    expect(processor).toBeDefined();
    expect(config.compressHTML).toBe(true);

    const renderer = await processor!.createRenderer(config.markdown ?? {});
    const rendered = await renderer.render(
      'Flags stay written as --force and ---, and "quotes" stay straight.',
    );

    expect(rendered.code).toContain("--force");
    expect(rendered.code).toContain("---");
    expect(rendered.code).toContain('"quotes"');
    expect(rendered.code).not.toContain("\u2013");
    expect(rendered.code).not.toContain("\u2014");
    expect(rendered.code).not.toContain("\u201c");
    expect(rendered.code).not.toContain("\u201d");
  });
});

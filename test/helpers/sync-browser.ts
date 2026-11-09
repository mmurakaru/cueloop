import { chromium } from "playwright";
import { expect } from "bun:test";
import * as v from "valibot";

export async function verifyTestBrowserSync(options: {
  cacheURL: string;
  userID: string;
  auth: string;
}) {
  const build = await Bun.build({
    entrypoints: ["examples/sync-workspace/browser-client.ts"],
    target: "browser",
  });

  expect(build.success).toBe(true);
  const bundle = build.outputs[0]!;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/client.js"
        ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } })
        : new Response("<!doctype html><title>Sync compatibility</title>"),
  });

  try {
    const browser = await chromium.launch({
      executablePath: process.env.CUELOOP_TEST_CHROME_EXECUTABLE,
    });

    try {
      const page = await browser.newPage();

      await page.goto(server.url.href);
      const result: unknown = await page.evaluate(
        async (configuration) => {
          const module: typeof import("../../examples/sync-workspace/browser-client.ts") =
            await import(configuration.moduleUrl);

          return module.verifyBrowserSync(configuration);
        },
        {
          cacheURL: options.cacheURL,
          userID: options.userID,
          auth: options.auth,
          moduleUrl: `${server.url}client.js`,
        },
      );
      const browserResult = v.parse(
        v.object({
          accepted: v.literal("success"),
          content: v.literal("Written by the browser client"),
        }),
        result,
      );

      expect(browserResult.content).toBe("Written by the browser client");
    } finally {
      await browser.close();
    }
  } finally {
    await server.stop(true);
  }
}

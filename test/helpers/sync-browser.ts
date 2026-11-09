import { chromium, type Page } from "playwright";
import { expect } from "bun:test";
import * as v from "valibot";

async function withTestSyncBrowser<Result>(
  run: (page: Page, moduleUrl: string) => Promise<Result>,
) {
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

      return await run(page, `${server.url}client.js`);
    } finally {
      await browser.close();
    }
  } finally {
    await server.stop(true);
  }
}

export async function verifyTestBrowserSync(options: {
  cacheURL: string;
  userID: string;
  auth: string;
}) {
  await withTestSyncBrowser(async (page, moduleUrl) => {
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
        moduleUrl,
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
  });
}

export async function verifyTestBrowserQuery(options: {
  cacheURL: string;
  userID: string;
  auth: string;
  storageKey?: string;
  workspaceIdentifier: string;
  expectedContent: string[];
  forbiddenContent: string[];
}) {
  await withTestSyncBrowser(async (page, moduleUrl) => {
    const receivedFrames: string[] = [];

    page.on("websocket", (socket) => {
      socket.on("framereceived", (frame) => receivedFrames.push(String(frame.payload)));
    });
    const result: unknown = await page.evaluate(
      async (configuration) => {
        const module: typeof import("../../examples/sync-workspace/browser-client.ts") =
          await import(configuration.moduleUrl);

        return module.verifyBrowserRead(configuration);
      },
      {
        moduleUrl,
        cacheURL: options.cacheURL,
        userID: options.userID,
        auth: options.auth,
        storageKey: options.storageKey,
        workspaceIdentifier: options.workspaceIdentifier,
        pageSize: 1,
      },
    );
    const records = v.parse(v.array(v.object({ content: v.string() })), result);
    const received = receivedFrames.join("\n");

    expect(records.map((record) => record.content)).toEqual(options.expectedContent);

    for (const content of options.expectedContent) expect(received).toContain(content);

    for (const content of options.forbiddenContent) expect(received).not.toContain(content);
  });
}

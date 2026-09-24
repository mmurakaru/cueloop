import { describe, expect, test } from "bun:test";
import { serveNegotiatedDocument, type AssetFetcher } from "./markdown-response";

function responseFetcher(response: Response): AssetFetcher {
  return async () => response;
}

describe("serveNegotiatedDocument", () => {
  test("serves a Markdown representation with cache-safe headers", async () => {
    let requestedAsset = "";
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/docs/install/", {
        headers: { Accept: "text/markdown" },
      }),
      async (request) => {
        requestedAsset = new URL(request.url).pathname;

        return new Response("# Install cueloop\n");
      },
      responseFetcher(new Response("<html></html>")),
    );

    expect(requestedAsset).toBe("/_markdown/docs/install/index.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-location")).toBe("/docs/install/index.md");
    expect(response.headers.get("vary")).toContain("Accept");
    expect(await response.text()).toBe("# Install cueloop\n");
  });

  test("returns an agent-friendly Markdown 404 for unknown pages", async () => {
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/unknown-page", {
        headers: { Accept: "text/markdown" },
      }),
      responseFetcher(new Response("missing", { status: 404 })),
      responseFetcher(new Response("<html>home</html>", { status: 200 })),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("https://www.cueloop.dev/sitemap.xml");
  });

  test("preserves real HTML status codes and varies on Accept", async () => {
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/unknown-page", {
        headers: { Accept: "text/html" },
      }),
      responseFetcher(new Response("missing", { status: 404 })),
      responseFetcher(new Response("<html>not found</html>", { status: 404 })),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("vary")).toContain("Accept");
  });

  test("passes static assets through without document negotiation", async () => {
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/favicon.svg", {
        headers: { Accept: "image/svg+xml" },
      }),
      responseFetcher(new Response("not used", { status: 500 })),
      responseFetcher(new Response("<svg />", { headers: { "Content-Type": "image/svg+xml" } })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });

  test("passes the API root through without document negotiation", async () => {
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/api", {
        headers: { Accept: "application/json" },
      }),
      responseFetcher(new Response("not used", { status: 500 })),
      responseFetcher(new Response('{"code":"api_route_not_found"}', { status: 404 })),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("api_route_not_found");
  });

  test("returns 406 when no document representation is acceptable", async () => {
    const response = await serveNegotiatedDocument(
      new Request("https://www.cueloop.dev/docs/", {
        headers: { Accept: "application/json" },
      }),
      responseFetcher(new Response("markdown")),
      responseFetcher(new Response("html")),
    );

    expect(response.status).toBe(406);
    expect(response.headers.get("vary")).toBe("Accept");
  });
});

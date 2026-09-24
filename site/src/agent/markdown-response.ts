import { negotiateDocumentContent } from "./http-content-negotiation";

/** Fetches one asset or routed response from the Cloudflare Pages runtime. */
export type AssetFetcher = (request: Request) => Promise<Response>;

const markdownNotFound = `# Not found

The requested cueloop.dev page does not exist.

- [Read the cueloop docs](https://www.cueloop.dev/docs/)
- [View the sitemap](https://www.cueloop.dev/sitemap.xml)
- [Read llms.txt](https://www.cueloop.dev/llms.txt)
`;

function isDocumentPath(pathname: string): boolean {
  if (pathname.startsWith("/_markdown/") || pathname === "/api" || pathname.startsWith("/api/")) {
    return false;
  }
  const lastSegment = pathname.split("/").findLast((segment) => segment.length > 0);

  return lastSegment === undefined || !lastSegment.includes(".");
}

function markdownAssetPath(pathname: string): string {
  const cleanPath = pathname === "/" ? "" : pathname.replace(/\/$/, "");

  return `/_markdown${cleanPath}/index.md`;
}

function publicMarkdownPath(pathname: string): string {
  const cleanPath = pathname === "/" ? "" : pathname.replace(/\/$/, "");

  return `${cleanPath}/index.md`;
}

function addVaryAccept(headers: Headers): void {
  const varyValues = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!varyValues.some((value) => value.toLowerCase() === "accept")) varyValues.unshift("Accept");
  headers.set("Vary", varyValues.join(", "));
}

function documentResponse(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers);
  addVaryAccept(headers);
  headers.set("Link", `<${publicMarkdownPath(pathname)}>; rel="alternate"; type="text/markdown"`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Serves negotiated Markdown documents while preserving the static HTML response path. */
export async function serveNegotiatedDocument(
  request: Request,
  fetchAsset: AssetFetcher,
  fetchHtml: AssetFetcher,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (!isDocumentPath(pathname) || (request.method !== "GET" && request.method !== "HEAD")) {
    return fetchHtml(request);
  }

  const representation = negotiateDocumentContent(request.headers.get("Accept"));

  if (representation === "not-acceptable") {
    return new Response("cueloop.dev pages are available as text/html or text/markdown.\n", {
      status: 406,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        Vary: "Accept",
      },
    });
  }

  if (representation === "html") return documentResponse(await fetchHtml(request), pathname);

  const assetUrl = new URL(markdownAssetPath(pathname), request.url);
  const assetRequest = new Request(assetUrl, {
    method: request.method,
    headers: request.headers,
  });
  const assetResponse = await fetchAsset(assetRequest);

  if (!assetResponse.ok) {
    return new Response(request.method === "HEAD" ? null : markdownNotFound, {
      status: 404,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: "Accept",
      },
    });
  }

  const headers = new Headers(assetResponse.headers);
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("Content-Location", publicMarkdownPath(pathname));
  headers.set("Link", `<${pathname}>; rel="alternate"; type="text/html"`);
  addVaryAccept(headers);

  return new Response(request.method === "HEAD" ? null : assetResponse.body, {
    status: 200,
    headers,
  });
}

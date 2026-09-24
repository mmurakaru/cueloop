const apiHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
} as const;

const apiRoutes = {
  "/api/v1": {
    name: "cueloop public API",
    version: "v1",
    endpoints: {
      product: "https://www.cueloop.dev/api/v1/product",
      capabilities: "https://www.cueloop.dev/api/v1/capabilities",
      health: "https://www.cueloop.dev/api/v1/health",
      openapi: "https://www.cueloop.dev/openapi.json",
    },
  },
  "/api/v1/product": {
    name: "cueloop",
    description: "A terminal-first review surface for coding agents.",
    category: "developer_tool",
    homepage: "https://www.cueloop.dev/",
    documentation: "https://www.cueloop.dev/docs/",
    repository: "https://github.com/mmurakaru/cueloop",
    cli: {
      install: "curl -fsSL https://cueloop.dev/install.sh | sh",
      package: "https://www.npmjs.com/package/cueloop",
    },
  },
  "/api/v1/capabilities": {
    workflows: ["plan", "reply", "diff", "review", "prototype", "refine"],
    reviewActions: ["comment", "approve", "request_changes"],
    integrations: ["Claude Code", "Codex", "pi"],
    collaboration: {
      protocol: "SSH",
      documentation: "https://www.cueloop.dev/docs/sharing/",
    },
  },
  "/api/v1/health": {
    status: "operational",
    service: "cueloop public discovery API",
    version: "v1",
  },
} as const;

type PublicApiPath = keyof typeof apiRoutes;
type PublicApiBody = (typeof apiRoutes)[PublicApiPath];

function isPublicApiPath(pathname: string): pathname is PublicApiPath {
  return pathname in apiRoutes;
}

function apiResponse(body: PublicApiBody, requestMethod: string): Response {
  const response = Response.json(body, { headers: apiHeaders });

  return requestMethod === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}

function apiProblem(
  request: Request,
  status: number,
  title: string,
  code: string,
  detail: string,
): Response {
  const body = {
    type: "https://www.cueloop.dev/docs/reference/api/#errors",
    title,
    status,
    detail,
    code,
    resolution: "Read https://www.cueloop.dev/openapi.json for supported operations.",
    instance: new URL(request.url).pathname,
  };
  const response = Response.json(body, {
    status,
    headers: {
      ...apiHeaders,
      "Content-Type": "application/problem+json; charset=utf-8",
    },
  });

  return request.method === "HEAD"
    ? new Response(null, { status, headers: response.headers })
    : response;
}

/** Serves the read-only cueloop discovery API and structured API errors. */
export function handleCueloopPublicApi(request: Request): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...apiHeaders,
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = apiProblem(
      request,
      405,
      "Method not allowed",
      "api_method_not_allowed",
      `${request.method} is not supported for this read-only API.`,
    );
    response.headers.set("Allow", "GET, HEAD, OPTIONS");

    return response;
  }

  const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";

  if (!isPublicApiPath(pathname)) {
    return apiProblem(
      request,
      404,
      "API route not found",
      "api_route_not_found",
      `No public cueloop API operation exists at ${pathname}.`,
    );
  }

  return apiResponse(apiRoutes[pathname], request.method);
}

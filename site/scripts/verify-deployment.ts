interface DeploymentCheck {
  path: string;
  expectedStatus: number;
  accept?: string;
  contentType?: string;
  bodyIncludes?: string;
  varyOnAccept?: boolean;
  redirect?: RequestRedirect;
  location?: string;
}

const checks: DeploymentCheck[] = [
  { path: "/", expectedStatus: 200, contentType: "text/html", varyOnAccept: true },
  {
    path: "/docs/",
    expectedStatus: 200,
    accept: "text/markdown",
    contentType: "text/markdown",
    bodyIncludes: "# cueloop documentation",
    varyOnAccept: true,
  },
  { path: "/about/", expectedStatus: 200, contentType: "text/html" },
  { path: "/contact/", expectedStatus: 200, contentType: "text/html" },
  { path: "/privacy/", expectedStatus: 200, contentType: "text/html" },
  { path: "/llms.txt", expectedStatus: 200, bodyIncludes: "## When to use cueloop" },
  { path: "/SKILL.md", expectedStatus: 200, bodyIncludes: "name: cueloop" },
  { path: "/robots.txt", expectedStatus: 200, bodyIncludes: "Sitemap:" },
  { path: "/sitemap.xml", expectedStatus: 200, contentType: "application/xml" },
  { path: "/openapi.json", expectedStatus: 200, contentType: "application/json" },
  { path: "/api/v1", expectedStatus: 200, contentType: "application/json" },
  { path: "/api/v1/product", expectedStatus: 200, contentType: "application/json" },
  { path: "/api/v1/capabilities", expectedStatus: 200, contentType: "application/json" },
  { path: "/api/v1/health", expectedStatus: 200, contentType: "application/json" },
  {
    path: "/api/v1/not-a-route",
    expectedStatus: 404,
    contentType: "application/problem+json",
    bodyIncludes: "api_route_not_found",
  },
  { path: "/not-a-real-page", expectedStatus: 404, contentType: "text/html" },
  {
    path: "/not-a-real-page",
    expectedStatus: 404,
    accept: "text/markdown",
    contentType: "text/markdown",
    bodyIncludes: "# Not found",
    varyOnAccept: true,
  },
  {
    path: "/docs/concepts/annotations/",
    expectedStatus: 301,
    redirect: "manual",
    location: "/docs/concepts/comments/",
  },
  {
    path: "/docs/sharing/quickstart/",
    expectedStatus: 301,
    redirect: "manual",
    location: "/docs/sharing/",
  },
];

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verifyResponse(
  baseUrl: URL,
  check: DeploymentCheck,
  attemptsRemaining = 20,
): Promise<void> {
  const label = `${check.path}${check.accept ? ` (${check.accept})` : ""}`;

  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      headers: check.accept ? { Accept: check.accept } : undefined,
      redirect: check.redirect ?? "follow",
    });
    const body = await response.text();

    invariant(
      response.status === check.expectedStatus,
      `${label}: expected ${check.expectedStatus}, received ${response.status}`,
    );
    if (check.contentType) {
      invariant(
        response.headers.get("content-type")?.includes(check.contentType) === true,
        `${label}: expected Content-Type ${check.contentType}`,
      );
    }
    if (check.bodyIncludes) {
      invariant(
        body.includes(check.bodyIncludes),
        `${label}: response body is missing expected text`,
      );
    }
    if (check.varyOnAccept) {
      invariant(
        response.headers
          .get("vary")
          ?.split(",")
          .some((value) => value.trim().toLowerCase() === "accept") === true,
        `${label}: response does not vary on Accept`,
      );
    }
    if (check.location) {
      invariant(
        response.headers.get("location") === check.location,
        `${label}: expected Location ${check.location}`,
      );
    }
  } catch (error) {
    if (attemptsRemaining === 1) throw error;
    await Bun.sleep(500);

    return verifyResponse(baseUrl, check, attemptsRemaining - 1);
  }
}

/** Verifies every public machine endpoint and negotiated document response after deployment. */
export async function verifyCueloopDeployment(origin: string): Promise<void> {
  const baseUrl = new URL(origin);

  await Promise.all(checks.map((check) => verifyResponse(baseUrl, check)));
}

if (import.meta.main) {
  const origin = Bun.argv[2];
  invariant(origin !== undefined, "usage: bun run verify:deployment -- <origin>");
  await verifyCueloopDeployment(origin);
  console.log(`Verified ${checks.length} public responses at ${origin}`);
}

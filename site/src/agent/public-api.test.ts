import { describe, expect, test } from "bun:test";
import { handleCueloopPublicApi } from "./public-api";

describe("handleCueloopPublicApi", () => {
  test.each(["/api/v1", "/api/v1/product", "/api/v1/capabilities", "/api/v1/health"])(
    "serves %s as JSON",
    async (path) => {
      const response = handleCueloopPublicApi(new Request(`https://www.cueloop.dev${path}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.text()).not.toBeEmpty();
    },
  );

  test("returns a structured JSON error for an unknown API route", async () => {
    const response = handleCueloopPublicApi(new Request("https://www.cueloop.dev/api/v1/missing"));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toContain('"code":"api_route_not_found"');
    expect(body).toContain(
      '"resolution":"Read https://www.cueloop.dev/openapi.json for supported operations."',
    );
  });

  test("returns a structured JSON error for unsupported methods", async () => {
    const response = handleCueloopPublicApi(
      new Request("https://www.cueloop.dev/api/v1/product", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  test("answers preflight requests without authentication", () => {
    const response = handleCueloopPublicApi(
      new Request("https://www.cueloop.dev/api/v1/product", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

import type { DeviceFlowDependencies } from "../../packages/gateway/src/github-device-flow";

const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const ACCESS_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";

export function createTestJsonResponse<T>(body: T): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const DEFAULT_GRANT_BODY = {
  device_code: "dev-1",
  user_code: "WXYZ-1234",
  verification_uri: "https://github.com/login/device",
  verification_uri_complete: "https://github.com/login/device?user_code=WXYZ-1234",
  expires_in: 900,
  interval: 5,
};

export const TEST_GRANT_BODY = DEFAULT_GRANT_BODY;

/** Route device-flow calls by URL, draining a per-poll token queue so a test can walk pending -> success. */
export function createTestDeviceFlowFetch(routes: {
  device?: unknown;
  token?: unknown[];
  user?: unknown;
}) {
  const bodies: string[] = [];
  const tokenQueue = [...(routes.token ?? [])];
  const fetch: DeviceFlowDependencies["fetch"] = async (input, init) => {
    const url = input.toString();

    if (init?.body !== undefined) bodies.push(String(init.body));
    if (url === DEVICE_CODE_ENDPOINT)
      return createTestJsonResponse(routes.device ?? DEFAULT_GRANT_BODY);
    if (url === ACCESS_TOKEN_ENDPOINT) return createTestJsonResponse(tokenQueue.shift() ?? {});
    if (url === USER_ENDPOINT) return createTestJsonResponse(routes.user ?? {});

    throw new Error(`github-device-flow test: unexpected url ${url}`);
  };

  return { fetch, bodies };
}

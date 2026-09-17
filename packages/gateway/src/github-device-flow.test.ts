import { describe, expect, test } from "bun:test";
import {
  fetchGithubLoginAndName,
  pollForUserToken,
  requestDeviceCode,
  resolveCollaboratorIdentity,
  type DeviceFlowDeps,
} from "./github-device-flow";

const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const ACCESS_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";

function jsonResponse<T>(body: T): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const GRANT_BODY = {
  device_code: "dev-1",
  user_code: "WXYZ-1234",
  verification_uri: "https://github.com/login/device",
  verification_uri_complete: "https://github.com/login/device?user_code=WXYZ-1234",
  expires_in: 900,
  interval: 5,
};

/** Route by URL, and drain a per-endpoint queue so a poll can walk pending -> success. */
function stubFetch(routes: { device?: unknown; token?: unknown[]; user?: unknown }) {
  const bodies: string[] = [];
  const tokenQueue = [...(routes.token ?? [])];
  const fetch: DeviceFlowDeps["fetch"] = async (input, init) => {
    const url = input.toString();

    if (init?.body !== undefined) bodies.push(String(init.body));
    if (url === DEVICE_CODE_ENDPOINT) return jsonResponse(routes.device ?? GRANT_BODY);
    if (url === ACCESS_TOKEN_ENDPOINT) return jsonResponse(tokenQueue.shift() ?? {});
    if (url === USER_ENDPOINT) return jsonResponse(routes.user ?? {});

    throw new Error(`github-device-flow test: unexpected url ${url}`);
  };

  return { fetch, bodies };
}

const noSleep: DeviceFlowDeps["sleep"] = async () => {};

describe("requestDeviceCode", () => {
  test("posts the client id, requests no scope, and returns the grant", async () => {
    const { fetch, bodies } = stubFetch({});

    const grant = await requestDeviceCode("client-abc", { fetch, sleep: noSleep });

    expect(bodies[0]).toContain("client-abc");
    expect(bodies[0]).not.toContain("scope");
    expect(grant.verificationUriComplete).toBe(GRANT_BODY.verification_uri_complete);
    expect(grant.intervalSeconds).toBe(5);
  });
});

describe("pollForUserToken", () => {
  test("walks pending then slow_down then success, growing the interval", async () => {
    const slept: number[] = [];
    const { fetch } = stubFetch({
      token: [
        { error: "authorization_pending" },
        { error: "slow_down", interval: 10 },
        { access_token: "tok-1" },
      ],
    });
    const sleep: DeviceFlowDeps["sleep"] = async (ms) => {
      slept.push(ms);
    };

    const outcome = await pollForUserToken("client-abc", "dev-1", 5, { fetch, sleep });

    expect(outcome).toEqual({ kind: "token", token: "tok-1" });
    expect(slept).toEqual([5000, 5000, 10000]);
  });

  test("access_denied and expired_token stop with a typed failure", async () => {
    const denied = await pollForUserToken("c", "d", 5, {
      ...stubFetch({ token: [{ error: "access_denied" }] }),
      sleep: noSleep,
    });
    const expired = await pollForUserToken("c", "d", 5, {
      ...stubFetch({ token: [{ error: "expired_token" }] }),
      sleep: noSleep,
    });

    expect(denied).toEqual({ kind: "failed", reason: "access_denied" });
    expect(expired).toEqual({ kind: "failed", reason: "expired_token" });
  });
});

describe("fetchGithubLoginAndName", () => {
  test("parses the login and name", async () => {
    const { fetch } = stubFetch({ user: { login: "robin", name: "Robin" } });

    const identity = await fetchGithubLoginAndName("tok-1", { fetch, sleep: noSleep });

    expect(identity).toEqual({ login: "robin", name: "Robin" });
  });
});

describe("resolveCollaboratorIdentity", () => {
  test("returns only the identity, prompts for verification, and never exposes the token", async () => {
    const { fetch } = stubFetch({
      token: [{ access_token: "tok-secret" }],
      user: { login: "robin", name: null },
    });
    let prompted = "";

    const outcome = await resolveCollaboratorIdentity("client-abc", {
      fetch,
      sleep: noSleep,
      onVerification: (prompt) => {
        prompted = prompt.verificationUriComplete;
      },
    });

    expect(prompted).toBe(GRANT_BODY.verification_uri_complete);
    expect(outcome).toEqual({ kind: "identity", login: "robin" });
    expect(JSON.stringify(outcome)).not.toContain("tok-secret");
  });
});

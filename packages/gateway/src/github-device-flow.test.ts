import { describe, expect, test } from "bun:test";
import {
  fetchGithubLoginAndName,
  pollForUserToken,
  requestDeviceCode,
  resolveCollaboratorIdentity,
  type DeviceFlowDependencies,
} from "./github-device-flow";
import {
  createTestDeviceFlowFetch,
  TEST_GRANT_BODY,
} from "../../../test/helpers/github-device-flow-stubs";

const noSleep: DeviceFlowDependencies["sleep"] = async () => {};

describe("requestDeviceCode", () => {
  test("posts the client id, requests no scope, and returns the grant", async () => {
    const { fetch, bodies } = createTestDeviceFlowFetch({});

    const grant = await requestDeviceCode("client-abc", { fetch, sleep: noSleep });

    expect(bodies[0]).toContain("client-abc");
    expect(bodies[0]).not.toContain("scope");
    expect(grant.verificationUriComplete).toBe(TEST_GRANT_BODY.verification_uri_complete);
    expect(grant.intervalSeconds).toBe(5);
  });

  test("builds the pre-filled link when GitHub omits verification_uri_complete", async () => {
    const { fetch } = createTestDeviceFlowFetch({
      device: {
        device_code: "dev-2",
        user_code: "ABCD-5678",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    });

    const grant = await requestDeviceCode("client-abc", { fetch, sleep: noSleep });

    expect(grant.verificationUriComplete).toBe(
      "https://github.com/login/device?user_code=ABCD-5678",
    );
  });
});

describe("pollForUserToken", () => {
  test("walks pending then slow_down then success, growing the interval", async () => {
    const slept: number[] = [];
    const { fetch } = createTestDeviceFlowFetch({
      token: [
        { error: "authorization_pending" },
        { error: "slow_down", interval: 10 },
        { access_token: "tok-1" },
      ],
    });
    const sleep: DeviceFlowDependencies["sleep"] = async (milliseconds) => {
      slept.push(milliseconds);
    };

    const outcome = await pollForUserToken("client-abc", "dev-1", 5, { fetch, sleep });

    expect(outcome).toEqual({ kind: "token", token: "tok-1" });
    expect(slept).toEqual([5000, 5000, 10000]);
  });

  test("access_denied and expired_token stop with a typed failure", async () => {
    const denied = await pollForUserToken("c", "d", 5, {
      ...createTestDeviceFlowFetch({ token: [{ error: "access_denied" }] }),
      sleep: noSleep,
    });
    const expired = await pollForUserToken("c", "d", 5, {
      ...createTestDeviceFlowFetch({ token: [{ error: "expired_token" }] }),
      sleep: noSleep,
    });

    expect(denied).toEqual({ kind: "failed", reason: "access_denied" });
    expect(expired).toEqual({ kind: "failed", reason: "expired_token" });
  });
});

describe("fetchGithubLoginAndName", () => {
  test("parses the login and name", async () => {
    const { fetch } = createTestDeviceFlowFetch({ user: { login: "robin", name: "Robin" } });

    const identity = await fetchGithubLoginAndName("tok-1", { fetch, sleep: noSleep });

    expect(identity).toEqual({ login: "robin", name: "Robin" });
  });
});

describe("resolveCollaboratorIdentity", () => {
  test("returns only the identity, prompts for verification, and never exposes the token", async () => {
    const { fetch } = createTestDeviceFlowFetch({
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

    expect(prompted).toBe(TEST_GRANT_BODY.verification_uri_complete);
    expect(outcome).toEqual({ kind: "identity", login: "robin" });
    expect(JSON.stringify(outcome)).not.toContain("tok-secret");
  });
});

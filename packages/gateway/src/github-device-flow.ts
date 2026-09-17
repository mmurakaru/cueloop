/** GitHub device flow for collaborator identity: request a code, poll, read the login once, discard the token. */

import * as v from "valibot";

const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const ACCESS_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Injected IO so tests run with no network and no real waiting. */
export interface DeviceFlowDependencies {
  fetch: FetchFunction;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface DeviceCodeGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface VerificationPrompt {
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
}

/** Why a device-flow poll ended without a token. */
export type DeviceFlowFailure = "access_denied" | "expired_token" | "unexpected";

export type TokenPollOutcome =
  | { kind: "token"; token: string }
  | { kind: "failed"; reason: DeviceFlowFailure };

export type IdentityOutcome =
  | { kind: "identity"; login: string; name?: string }
  | { kind: "failed"; reason: DeviceFlowFailure };

const DeviceCodeSchema = v.object({
  device_code: v.string(),
  user_code: v.string(),
  verification_uri: v.string(),
  verification_uri_complete: v.optional(v.string()),
  expires_in: v.number(),
  interval: v.number(),
});

const AccessTokenSchema = v.object({
  access_token: v.optional(v.string()),
  error: v.optional(v.string()),
  interval: v.optional(v.number()),
});

const UserSchema = v.object({
  login: v.string(),
  name: v.nullish(v.string()),
});

/** The identity-only GitHub App client id; device-flow identity is unavailable when unset. */
export function githubClientId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CUELOOP_GITHUB_CLIENT_ID || undefined;
}

/** Ask GitHub for a device and user code for this app, requesting no scope. */
export async function requestDeviceCode(
  clientId: string,
  dependencies: DeviceFlowDependencies,
): Promise<DeviceCodeGrant> {
  const response = await dependencies.fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  const parsed = v.parse(DeviceCodeSchema, await response.json());
  // GitHub omits verification_uri_complete, so build the pre-filled link ourselves.
  const verificationUriComplete =
    parsed.verification_uri_complete ?? `${parsed.verification_uri}?user_code=${parsed.user_code}`;

  return {
    deviceCode: parsed.device_code,
    userCode: parsed.user_code,
    verificationUri: parsed.verification_uri,
    verificationUriComplete,
    expiresInSeconds: parsed.expires_in,
    intervalSeconds: parsed.interval,
  };
}

/** Poll until the user authorizes, denies, or the code expires; never throws on a documented device-flow error. */
export async function pollForUserToken(
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  dependencies: DeviceFlowDependencies,
): Promise<TokenPollOutcome> {
  let waitSeconds = intervalSeconds;
  const maxAttempts = Math.ceil(DEVICE_CODE_LIFETIME_SECONDS / Math.max(intervalSeconds, 1)) + 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await dependencies.sleep(waitSeconds * 1000);
    const response = await dependencies.fetch(ACCESS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: DEVICE_GRANT_TYPE,
      }),
    });
    const parsed = v.parse(AccessTokenSchema, await response.json());

    if (parsed.access_token) return { kind: "token", token: parsed.access_token };
    if (parsed.error === "authorization_pending") continue;
    if (parsed.error === "slow_down") {
      waitSeconds = parsed.interval ?? waitSeconds + 5;

      continue;
    }
    if (parsed.error === "access_denied") return { kind: "failed", reason: "access_denied" };
    if (parsed.error === "expired_token") return { kind: "failed", reason: "expired_token" };

    return { kind: "failed", reason: "unexpected" };
  }

  return { kind: "failed", reason: "expired_token" };
}

/** Read the authorized user's login and name; the token is used here and never returned. */
export async function fetchGithubLoginAndName(
  token: string,
  dependencies: DeviceFlowDependencies,
): Promise<{ login: string; name?: string }> {
  const response = await dependencies.fetch(USER_ENDPOINT, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "cueloop",
    },
  });
  const parsed = v.parse(UserSchema, await response.json());

  return { login: parsed.login, name: parsed.name ?? undefined };
}

/** Run the whole device flow and return only the resolved identity; the access token never leaves this function. */
export async function resolveCollaboratorIdentity(
  clientId: string,
  options: DeviceFlowDependencies & { onVerification: (prompt: VerificationPrompt) => void },
): Promise<IdentityOutcome> {
  const grant = await requestDeviceCode(clientId, options);

  options.onVerification({
    verificationUri: grant.verificationUri,
    verificationUriComplete: grant.verificationUriComplete,
    userCode: grant.userCode,
  });
  const outcome = await pollForUserToken(
    clientId,
    grant.deviceCode,
    grant.intervalSeconds,
    options,
  );

  if (outcome.kind === "failed") return outcome;
  const identity = await fetchGithubLoginAndName(outcome.token, options);

  return { kind: "identity", login: identity.login, name: identity.name };
}

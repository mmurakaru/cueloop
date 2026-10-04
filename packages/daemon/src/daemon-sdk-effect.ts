import { Context, Effect, Layer, type Scope } from "effect";
import {
  connectOwnerSdk,
  normalizeSdkError,
  type OwnerDaemonSdk,
  type DaemonSdkError,
} from "./daemon-sdk";
import type { ConnectOptions } from "./client";
import type { DaemonRequestOptions } from "./client-errors";

type EffectMethods<Methods> = {
  readonly [Key in keyof Methods]: Methods[Key] extends (
    ...args: infer Arguments
  ) => Promise<infer Result>
    ? (...args: Arguments) => Effect.Effect<Result, DaemonSdkError>
    : never;
};

/** The Effect service owns a scoped connection while daemon-owned work outlives local waits. */
export class CueloopSdk extends Context.Service<
  CueloopSdk,
  {
    readonly threads: EffectMethods<OwnerDaemonSdk["threads"]>;
    readonly comments: EffectMethods<OwnerDaemonSdk["comments"]>;
    readonly sessions: EffectMethods<OwnerDaemonSdk["sessions"]>;
    readonly agents: EffectMethods<OwnerDaemonSdk["agents"]>;
  }
>()("@cueloop/daemon/CueloopSdk") {
  static ownerLayer(
    options: Omit<ConnectOptions, "role"> = {},
  ): Layer.Layer<CueloopSdk, DaemonSdkError> {
    return Layer.effect(CueloopSdk, acquireOwnerSdk(options).pipe(Effect.map(effectSdkService)));
  }
}

function acquireOwnerSdk(
  options: Omit<ConnectOptions, "role">,
): Effect.Effect<OwnerDaemonSdk, DaemonSdkError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.tryPromise({ try: () => connectOwnerSdk(options), catch: normalizeSdkError }),
    (sdk) => Effect.sync(() => sdk.close()),
  );
}

function sdkEffect<Result>(
  request: (options: DaemonRequestOptions) => Promise<Result>,
  options?: DaemonRequestOptions,
): Effect.Effect<Result, DaemonSdkError> {
  return Effect.tryPromise({
    try: (signal) =>
      request({
        ...options,
        signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
      }),
    catch: normalizeSdkError,
  });
}

function effectSdkService(sdk: OwnerDaemonSdk): CueloopSdk["Service"] {
  return {
    threads: {
      get: (id, options) => sdkEffect((request) => sdk.threads.get(id, request), options),
      create: (input, options) =>
        sdkEffect((request) => sdk.threads.create(input, request), options),
    },
    comments: {
      add: (input, options) => sdkEffect((request) => sdk.comments.add(input, request), options),
      list: (id, options) => sdkEffect((request) => sdk.comments.list(id, request), options),
      reply: (input, options) =>
        sdkEffect((request) => sdk.comments.reply(input, request), options),
    },
    sessions: {
      sendMessage: (input, options) =>
        sdkEffect((request) => sdk.sessions.sendMessage(input, request), options),
    },
    agents: {
      get: (id, options) => sdkEffect((request) => sdk.agents.get(id, request), options),
      prompt: (input, options) =>
        sdkEffect((request) => sdk.agents.prompt(input, request), options),
      replyToComment: (input, options) =>
        sdkEffect((request) => sdk.agents.replyToComment(input, request), options),
      wait: (input, options) => sdkEffect((request) => sdk.agents.wait(input, request), options),
      cancel: (id, options) => sdkEffect((request) => sdk.agents.cancel(id, request), options),
    },
  };
}

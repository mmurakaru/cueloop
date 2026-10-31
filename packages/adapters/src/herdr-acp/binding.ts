import { mkdirSync, rmSync } from "node:fs";
import * as v from "valibot";
import type {
  AgentHarnessConnection,
  AgentHarnessEvent,
  AgentHarnessResult,
} from "@cueloop/schema";
import type { FxAcpFrame, FxAcpOptions } from "../fx/acp";
import { FxAcpConnection } from "../fx/acp";
import { createDurableAcpTask, type AcpDispatchRecovery } from "../durable-acp-task";
import { RelayChild } from "./child";
import { HerdrRelayClient } from "./client";
import type { HcInstall } from "./detect";
import { ensureRelay } from "./launch";
import {
  herdrAcpDirectory,
  herdrEpochPath,
  herdrRelayPidPath,
  herdrSessionName,
  herdrSocketPath,
  herdrTerminalName,
  herdrTranscriptPath,
} from "./names";
import type { RelayState, StdoutLine } from "./protocol";
import { promptStillOpen } from "./scan";

const INTERRUPTED =
  "Fx execution was interrupted after dispatch. Inspect its effects before retrying.";

export interface HerdrAcpOptions {
  home: string;
  command: string[];
  launch: "hc" | "process";
  hc?: HcInstall;
  env?: NodeJS.ProcessEnv;
  hcSession?: string;
  xdgRuntimeDir?: string;
  xdgStateHome?: string;
  xdgConfigHome?: string;
}

interface LiveSession {
  key: string;
  client: HerdrRelayClient;
  child: RelayChild;
  epoch: string;
  cursor: number;
  sequence: number;
  sessionId: string | null;
  prompt: RelayState["prompt"];
  running: boolean;
}

export interface HerdrAcpIntegration {
  prepare(processKey: string, cwd: string): Promise<void>;
  openAcp(options: FxAcpOptions & { agentProcessKey?: string }): FxAcpConnection;
  existingSession(processKey?: string): string | undefined;
  recoverPrompt(
    processKey: string | undefined,
    emit: (frame: FxAcpFrame) => void,
  ): Promise<{ stopReason: string } | { missing: true }>;
  remove(processKey: string): Promise<void>;
  createAcp(
    connection: () => Promise<AgentHarnessConnection>,
    publish: (event: AgentHarnessEvent) => void,
    processKey: string,
  ): ReturnType<typeof createDurableAcpTask>;
}

/** Own the relays for one daemon. Each Thread process key gets one child. */
export function createHerdrAcp(options: HerdrAcpOptions): HerdrAcpIntegration {
  const sessions = new Map<string, LiveSession>();
  const env = options.env ?? process.env;
  const hcSession = herdrSessionName(env, options.hcSession);

  const requireSession = (processKey: string | undefined): LiveSession => {
    const session = processKey ? sessions.get(processKey) : undefined;

    if (!session) throw new Error(INTERRUPTED);

    return session;
  };

  return {
    prepare: (processKey, cwd) =>
      prepareSession(options, sessions, processKey, cwd, env, hcSession),
    openAcp: (acp) => openConnection(requireSession(acp.agentProcessKey), acp),
    existingSession(processKey) {
      const session = processKey ? sessions.get(processKey) : undefined;

      return session?.sessionId ?? undefined;
    },
    recoverPrompt(processKey, _emit) {
      return recover(requireSession(processKey));
    },
    async remove(processKey) {
      const session = sessions.get(processKey);

      sessions.delete(processKey);

      if (session) session.client.shutdown();
      else await releaseRelay(herdrSocketPath(options.home, processKey));

      rmSync(herdrTranscriptPath(options.home, processKey), { force: true });
      rmSync(herdrEpochPath(options.home, processKey), { force: true });
      rmSync(herdrRelayPidPath(options.home, processKey), { force: true });
    },
    createAcp(connection, publish, processKey) {
      const recovery: AcpDispatchRecovery = {
        checkpoint: () => {
          const session = requireSession(processKey);

          return {
            phase: "dispatched",
            cursor: session.cursor,
            epoch: session.epoch,
            key: processKey,
          };
        },
        ack(cursor) {
          sessions.get(processKey)?.client.acknowledge(cursor);
        },
        resume: async (input) => resumePrompt(requireSession(processKey), connection, input),
      };

      return createDurableAcpTask(connection, publish, recovery);
    },
  };
}

async function prepareSession(
  options: HerdrAcpOptions,
  sessions: Map<string, LiveSession>,
  processKey: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  hcSession: string,
): Promise<void> {
  const current = sessions.get(processKey);

  if (current?.running) return;

  mkdirSync(herdrAcpDirectory(options.home), { recursive: true, mode: 0o700 });
  const socketPath = herdrSocketPath(options.home, processKey);

  await ensureRelay({
    socketPath,
    transcriptPath: herdrTranscriptPath(options.home, processKey),
    cwd,
    command: options.command,
    name: herdrTerminalName(processKey),
    launch: options.launch,
    hc: options.hc,
    hcSession,
    xdgRuntimeDir: options.xdgRuntimeDir,
    xdgStateHome: options.xdgStateHome,
    xdgConfigHome: options.xdgConfigHome,
    env,
  });
  const client = new HerdrRelayClient();

  await client.connect(socketPath);
  const state = await client.attach();
  const child = new RelayChild((line) => client.write(line));

  child.onShutdown = () => client.shutdown();
  child.onDetach = () => client.close();
  const session: LiveSession = {
    key: processKey,
    client,
    child,
    epoch: state.epoch,
    cursor: 0,
    sequence: state.sequence,
    sessionId: state.sessionId,
    prompt: state.prompt,
    running: state.running,
  };

  client.onStdout = (line) => deliver(session, line);
  client.onChildExit = () => {
    session.running = false;
    child.exited(null);
  };
  client.onSocketClose = () => {
    session.running = false;
    child.exited(null);
  };
  sessions.set(processKey, session);
  const inFlight = state.prompt !== null && state.prompt.stopReason === null;

  // A finished session has to stream the next prompt. Recovery holds output until replay.
  if (state.running && !inFlight) {
    client.follow();
    child.release();
  }
}

async function releaseRelay(socketPath: string): Promise<void> {
  const client = new HerdrRelayClient();

  try {
    await client.connect(socketPath);
    client.shutdown();
  } catch {
    // No relay is listening for this Thread.
  }
}

function openConnection(session: LiveSession, options: FxAcpOptions): FxAcpConnection {
  return new FxAcpConnection({
    command: options.command,
    env: options.env,
    cwd: options.cwd,
    onFrame: options.onFrame,
    onExit: options.onExit,
    child: session.child,
    initialSequence: session.sequence,
    detachOnClose: true,
    onResponse: (frame) => {
      const id = v.safeParse(v.number(), frame.id);

      if (!id.success || frame.method !== undefined) return;

      const result = v.safeParse(
        v.object({ stopReason: v.optional(v.string()) }),
        frame.result ?? {},
      );

      session.child.noteResponse(id.output, result.success ? result.output.stopReason : undefined);
    },
  });
}

async function recover(session: LiveSession): Promise<{ stopReason: string } | { missing: true }> {
  const prompt = session.prompt;

  if (!session.running) throw new Error(INTERRUPTED);

  if (!prompt || !promptStillOpen(prompt, session.cursor)) {
    session.client.follow();
    session.child.release();

    return { missing: true };
  }

  const waiter =
    prompt.stopReason === null
      ? session.child.waitForStop(prompt.id)
      : Promise.resolve(prompt.stopReason);
  const queued: StdoutLine[] = [];

  session.client.onStdout = (line) => queued.push(line);
  const replayed = await session.client.replay(session.cursor);
  const caughtUp = [...replayed.historical, ...replayed.trailing, ...queued.splice(0)];

  // Parsing here would commit durable progress while this phase still holds its invocation.
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      session.child.release();

      for (const line of caughtUp) deliver(session, line);

      session.client.onStdout = (line) => deliver(session, line);

      for (const line of queued.splice(0)) deliver(session, line);

      resolve();
    }, 0);
  });
  const stopReason = await waiter;

  if (!stopReason) throw new Error(INTERRUPTED);

  return { stopReason };
}

function deliver(session: LiveSession, line: StdoutLine): void {
  session.cursor = line.cursor;
  session.child.push(line.line);
}

async function resumePrompt(
  session: LiveSession,
  connection: () => Promise<AgentHarnessConnection>,
  input: { text: string; requestId: string; cursor: number; epoch?: string },
): Promise<AgentHarnessResult> {
  if ((input.epoch && input.epoch !== session.epoch) || !session.running) {
    throw new Error(INTERRUPTED);
  }

  session.cursor = input.cursor;
  const backend = await connection();

  if (!backend.resumePrompt) throw new Error(INTERRUPTED);

  return backend.resumePrompt(input.text, input.requestId);
}

/** Claude Mod entry. The host permits only local imports and `claude-code`. */

type Workflow = "plan" | "reply" | "prototype" | "diff" | "review" | "refine";
type ToolCall = {
  tool: string;
  tool_use_id: string;
  plan?: string;
  workflow?: Workflow;
  content?: string;
  proposal?: string;
  pullRequestReference?: string;
  title?: string;
};
type ToolResult = { deny: string } | { result: string };
type OpenThreadResult = { output: ToolResult; approvedRetry: boolean };
type SessionStart = { cwd: string; isInteractive: boolean };
type SessionEnd = { sessionId: string; reason: string };
type SessionCompact = { trigger: string };
type Engine = {
  session: { id(): Promise<string>; cwd(): Promise<string> };
  prompt: { submit(input: { text: string }): Promise<object> };
  tool: {
    register(input: {
      name: string;
      description: string;
      inputSchema: {
        type: "object";
        properties: Record<string, { type: "string"; enum?: readonly string[] }>;
        required?: string[];
      };
    }): Promise<object>;
  };
  process: {
    run(
      argv: readonly string[],
      options?: { cwd?: string; stdin?: string; timeoutMs?: number },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
  env: { get(name: string): Promise<string | undefined> };
  store: {
    get(key: string): Promise<boolean | undefined>;
    set(key: string, value: boolean): Promise<void>;
  };
  clock: { every(ms: number, fn: () => void): { cancel(): void } };
};
type On = {
  (
    event: "session.start",
    hook: (
      engine: Engine,
      input: SessionStart,
      next: (input: SessionStart) => Promise<{ cwd: string }>,
    ) => Promise<{ cwd: string }>,
  ): void;
  (
    event: "tool.call",
    hook: (
      engine: Engine,
      input: ToolCall,
      next: (input: ToolCall) => Promise<ToolResult>,
    ) => Promise<ToolResult>,
  ): void;
  (
    event: "session.compact",
    hook: (
      engine: Engine,
      input: SessionCompact,
      next: (input: SessionCompact) => Promise<{ messages: object[] }>,
    ) => Promise<{ messages: object[] }>,
  ): void;
  (
    event: "session.end",
    hook: (
      engine: Engine,
      input: SessionEnd,
      next: (input: SessionEnd) => Promise<{ sessionId: string }>,
    ) => Promise<{ sessionId: string }>,
  ): void;
};
type BridgeRequest =
  | {
      operation: "open";
      harness: "claude-code";
      harnessSessionId: string;
      cwd: string;
      workflow: Workflow;
      content?: string;
      proposal?: string;
      pullRequestReference?: string;
      title?: string;
    }
  | { operation: "pending"; harness: "claude-code"; harnessSessionId: string }
  | { operation: "ack"; bindingId: string; deliveryId: string; messageId: string }
  | { operation: "refine" };
type BridgeDelivery = {
  bindingId: string;
  threadId: string;
  deliveryId: string;
  message: { id: string };
  wakeText: string;
};
type BridgeResponse =
  | { operation: "open"; threadId: string; approvedRetry: boolean; manualOpenCommand?: string }
  | { operation: "pending"; deliveries: BridgeDelivery[]; pendingThreadIds: string[] }
  | { operation: "ack"; deliveryId: string }
  | { operation: "refine"; report: string };

export type ClaudeModEngine = Engine;

export type ClaudeModOn = On;

const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch"]);
const OPEN_THREAD_TOOL = "mcp__cueloop__open_thread";
const REFINE_CORPUS_TOOL = "mcp__cueloop__refine_corpus";
const MINIMUM_CLAUDE_CODE_VERSION = [2, 1, 278] as const;

function supportsClaudeCodeVersion(actual: number[]): boolean {
  for (const [index, required] of MINIMUM_CLAUDE_CODE_VERSION.entries()) {
    if (actual[index]! > required) {
      return true;
    }
    if (actual[index]! < required) {
      return false;
    }
  }

  return true;
}

async function assertSupportedClaudeCode(engine: Engine): Promise<void> {
  const result = await engine.process.run(["claude", "--version"], { timeoutMs: 5_000 });
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(result.stdout.trim());
  const actual = match?.slice(1).map(Number);
  const supported = result.exitCode === 0 && actual && supportsClaudeCodeVersion(actual);

  if (!supported)
    throw new Error("cueloop requires Claude Code 2.1.278 or newer with function hooks enabled");
}

async function callBridge(engine: Engine, request: BridgeRequest): Promise<BridgeResponse> {
  const entry = await engine.env.get("CUELOOP_HARNESS_ENTRY");
  const argv = entry ? ["bun", "run", entry, "harness"] : ["cueloop", "harness"];
  const result = await engine.process.run(argv, {
    stdin: JSON.stringify(request),
    timeoutMs: 30_000,
  });

  if (result.exitCode !== 0)
    throw new Error(`Claude Mod cueloop harness bridge failed: ${result.stderr.trim()}`);

  // SAFETY: the cueloop CLI validates requests and serializes this closed response union.
  const response = JSON.parse(result.stdout) as BridgeResponse;

  if (response.operation !== request.operation)
    throw new Error("Claude Mod cueloop harness bridge returned the wrong operation");

  return response;
}

type ModState = {
  sessionId: string | null;
  pendingThreadIds: string[];
  available: boolean;
  timer: { cancel(): void } | null;
  polling: Promise<void> | null;
  unavailableReason: string | null;
};

async function pollMessages(engine: Engine, state: ModState): Promise<void> {
  if (!state.sessionId || state.polling) {
    return state.polling ?? undefined;
  }

  state.polling = (async () => {
    const response = await callBridge(engine, {
      operation: "pending",
      harness: "claude-code",
      harnessSessionId: state.sessionId!,
    });

    if (response.operation !== "pending")
      throw new Error("Claude Mod cueloop bridge returned no pending deliveries");
    state.pendingThreadIds = response.pendingThreadIds;
    for (const delivery of response.deliveries) {
      const storeKey = `cueloop-message-${delivery.message.id}`;

      if ((await engine.store.get(storeKey)) !== true) {
        await engine.prompt.submit({ text: delivery.wakeText });
        await engine.store.set(storeKey, true);
      }
      await callBridge(engine, {
        operation: "ack",
        bindingId: delivery.bindingId,
        deliveryId: delivery.deliveryId,
        messageId: delivery.message.id,
      });
    }
    state.available = true;
  })()
    .catch(() => {
      state.available = false;
    })
    .finally(() => {
      state.polling = null;
    });

  return state.polling;
}

async function openThread(
  engine: Engine,
  state: ModState,
  input: ToolCall,
): Promise<OpenThreadResult> {
  if (!input.workflow) {
    return { output: { deny: "Claude Mod cueloop workflow is missing" }, approvedRetry: false };
  }
  if (input.workflow === "review" && !input.pullRequestReference) {
    return {
      output: { deny: "Claude Mod cueloop review needs pullRequestReference" },
      approvedRetry: false,
    };
  }
  if (input.workflow === "refine" && !input.proposal) {
    return { output: { deny: "Claude Mod cueloop refine needs proposal" }, approvedRetry: false };
  }
  if (input.workflow !== "review" && input.workflow !== "refine" && !input.content) {
    return {
      output: { deny: `Claude Mod cueloop ${input.workflow} needs content` },
      approvedRetry: false,
    };
  }

  try {
    const activeSessionId = await engine.session.id();
    const response = await callBridge(engine, {
      operation: "open",
      harness: "claude-code",
      harnessSessionId: activeSessionId,
      cwd: await engine.session.cwd(),
      workflow: input.workflow,
      content: input.content,
      proposal: input.proposal,
      pullRequestReference: input.pullRequestReference,
      title: input.title,
    });

    if (response.operation !== "open") {
      throw new Error("Claude Mod cueloop bridge did not open");
    }
    if (response.approvedRetry) {
      state.pendingThreadIds = state.pendingThreadIds.filter((id) => id !== response.threadId);
    } else if (!state.pendingThreadIds.includes(response.threadId)) {
      state.pendingThreadIds.push(response.threadId);
    }

    return {
      approvedRetry: response.approvedRetry,
      output: {
        result: response.approvedRetry
          ? "The unchanged approved plan may proceed."
          : `Thread ${response.threadId} is pending. End this turn and wait for its Message.` +
            (response.manualOpenCommand ? ` ${response.manualOpenCommand}` : ""),
      },
    };
  } catch (error) {
    state.available = false;

    return {
      output: { deny: `Claude Mod cueloop Thread unavailable: ${String(error)}` },
      approvedRetry: false,
    };
  }
}

export function register(on: On): void {
  const state: ModState = {
    sessionId: null,
    pendingThreadIds: [],
    available: false,
    timer: null,
    polling: null,
    unavailableReason: null,
  };

  on("session.start", async (engine, input, next) => {
    state.sessionId = await engine.session.id();
    try {
      await assertSupportedClaudeCode(engine);
      state.unavailableReason = null;
    } catch (error) {
      state.unavailableReason = String(error);
      state.available = false;

      return next(input);
    }
    await engine.tool.register({
      name: "open_thread",
      description:
        "Open or revise a cueloop Thread for plan, reply, prototype, diff, review, or refine.",
      inputSchema: {
        type: "object",
        properties: {
          workflow: {
            type: "string",
            enum: ["plan", "reply", "prototype", "diff", "review", "refine"],
          },
          content: { type: "string" },
          proposal: { type: "string" },
          pullRequestReference: { type: "string" },
          title: { type: "string" },
        },
        required: ["workflow"],
      },
    });
    await engine.tool.register({
      name: "refine_corpus",
      description: "Analyze resolved cueloop Threads before drafting a refine proposal.",
      inputSchema: { type: "object", properties: {} },
    });
    await pollMessages(engine, state);
    state.timer?.cancel();
    state.timer = engine.clock.every(1_000, () => {
      void pollMessages(engine, state);
    });

    return next(input);
  });

  on("tool.call", async (engine, input, next) => {
    if (state.unavailableReason) {
      return { deny: state.unavailableReason };
    }
    if (input.tool === "ExitPlanMode") {
      if (!input.plan) {
        return { deny: "Claude Mod could not read the plan; cueloop gate stayed closed." };
      }
      const result = await openThread(engine, state, {
        ...input,
        workflow: "plan",
        content: input.plan,
      });

      if (result.approvedRetry) {
        return next(input);
      }

      return { deny: "result" in result.output ? result.output.result : result.output.deny };
    }
    if (input.tool === OPEN_THREAD_TOOL) {
      const opened = await openThread(engine, state, input);

      return opened.output;
    }
    if (input.tool === REFINE_CORPUS_TOOL) {
      try {
        const response = await callBridge(engine, { operation: "refine" });

        return response.operation === "refine"
          ? { result: response.report }
          : { deny: "Claude Mod cueloop refine bridge returned the wrong result" };
      } catch (error) {
        return { deny: `Claude Mod cueloop refine unavailable: ${String(error)}` };
      }
    }
    if (!state.available) {
      return { deny: "Claude Mod cueloop is unavailable; review gate stayed closed." };
    }
    if (state.pendingThreadIds.length > 0 && !READ_ONLY_TOOLS.has(input.tool)) {
      return { deny: `cueloop Threads pending: ${state.pendingThreadIds.join(", ")}` };
    }

    return next(input);
  });

  on("session.compact", async (engine, input, next) => {
    await pollMessages(engine, state);

    return next(input);
  });
  on("session.end", async (_engine, input, next) => {
    state.timer?.cancel();
    state.timer = null;
    state.sessionId = null;

    return next(input);
  });
}

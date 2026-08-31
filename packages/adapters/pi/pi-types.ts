/**
 * Structural typing of the pi ExtensionAPI surface this adapter uses.
 * pi is an integration target, not a dependency: the real API object arrives
 * at the factory when pi loads the extension, so these shapes only need to be
 * structurally compatible with pi's - registerTool, registerCommand,
 * on("tool_call" | "session_shutdown"), sendUserMessage (the wake path), and
 * context.ui.notify.
 */

export interface TextContent {
  type: "text";
  text: string;
}

/** Result a tool returns to the model; isError marks a failure result. */
export interface PiToolResult<TDetails = unknown> {
  content: TextContent[];
  details: TDetails;
  isError?: boolean;
}

/** Streams partial progress for a running tool call. */
export type PiToolUpdateCallback<TDetails = unknown> = (partial: PiToolResult<TDetails>) => void;

export interface PiUIContext {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

/** The slice of pi's extension context the adapter reads. */
export interface PiContext {
  cwd: string;
  ui?: PiUIContext;
}

/** Plain JSON-schema parameters; structurally what pi's TypeBox schemas are. */
export interface PiParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: readonly string[] }>;
  required?: string[];
}

export interface PiToolDefinition<TParams = Record<string, unknown>, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: PiParameterSchema;
  execute(
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: PiToolUpdateCallback<TDetails> | undefined,
    context: PiContext,
  ): Promise<PiToolResult<TDetails>>;
}

/** Fired before a tool executes; a handler can block it. */
export interface PiToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PiToolCallResult {
  block?: boolean;
  reason?: string;
}

export type PiToolCallHandler = (
  event: PiToolCallEvent,
  context: PiContext,
) => PiToolCallResult | undefined | Promise<PiToolCallResult | undefined>;

export interface PiCommandOptions {
  description?: string;
  handler(args: string, context: PiContext): Promise<void> | void;
}

/** Fired once as the pi session tears down; the adapter aborts in-flight waiters here. */
export interface PiSessionEvent {
  type: "session_start" | "session_shutdown";
}

export type PiSessionHandler = (event: PiSessionEvent) => void | Promise<void>;

/**
 * How an injected message reaches the live turn: "followUp" queues it for after
 * the current turn ends, "steer" interrupts the running turn. cueloop wakes with
 * "followUp" so a returning verdict never cuts off work the human is mid-request.
 */
export interface PiSendMessageOptions {
  deliverAs?: "followUp" | "steer";
}

export interface PiExtensionAPI {
  registerTool(tool: PiToolDefinition<any, any>): void;
  registerCommand(name: string, options: PiCommandOptions): void;
  on(event: "tool_call", handler: PiToolCallHandler): void;
  on(event: "session_start" | "session_shutdown", handler: PiSessionHandler): void;
  /** Inject a message into the live session - the non-blocking wake path. */
  sendUserMessage(content: string, options?: PiSendMessageOptions): void;
}

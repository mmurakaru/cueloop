/** Request failure certainty never promises rollback after bytes may have reached the daemon. */
export type DaemonRequestCertainty = "not_sent" | "unknown";

/** Transport failures are distinct from daemon rejection codes and domain terminal outcomes. */
export class DaemonTransportError extends Error {
  readonly _tag = "DaemonTransportError";

  constructor(
    readonly kind: "protocol" | "connection" | "timeout" | "cancelled",
    message: string,
    readonly certainty: DaemonRequestCertainty,
    readonly method?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DaemonTransportError";
  }
}

/** Local cancellation stops observation; it does not cancel daemon-owned work. */
export interface DaemonRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

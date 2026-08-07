/** Daemon errors carry a stable code so clients can branch on it. */

export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

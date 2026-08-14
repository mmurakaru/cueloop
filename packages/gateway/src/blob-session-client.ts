/**
 * A SessionClient backed by one decrypted blob instead of the local daemon.
 * This is the swap that lets the gateway render the real <App> against a share:
 * the controller asks for a session, this hands back the one it holds.
 *
 * The viewer connection is read-only (ADR 0004 phase 1), so every mutation verb
 * rejects. The App already gates writes behind readOnly, so a reject is a
 * belt-and-braces guard, never a path a viewer hits. Phase 3 (collaborator
 * write-back with id-stable union merge to the store) replaces these rejects.
 */

import type { ReviewSession } from "@cueloop/schema";
import type { EventFrame, SessionClient } from "@cueloop/daemon/client";

export class BlobSessionClient implements SessionClient {
  constructor(private readonly session: ReviewSession) {}

  onEvent(_listener: (event: EventFrame) => void): () => void {
    return () => {};
  }

  async subscribe(): Promise<void> {}

  async sessionGet(_id: string): Promise<ReviewSession> {
    return this.session;
  }

  async sessionList(): Promise<ReviewSession[]> {
    return [this.session];
  }

  sessionAnnotate(): Promise<ReviewSession> {
    return readOnly();
  }

  sessionRemoveAnnotation(): Promise<ReviewSession> {
    return readOnly();
  }

  sessionSetWorkingCopy(): Promise<ReviewSession> {
    return readOnly();
  }

  sessionSetViewed(): Promise<ReviewSession> {
    return readOnly();
  }

  sessionResolve(): Promise<ReviewSession> {
    return readOnly();
  }

  close(): void {}
}

function readOnly(): Promise<never> {
  return Promise.reject(new Error("this shared plan is read-only"));
}

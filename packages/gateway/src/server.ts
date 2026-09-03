/**
 * The sharing gateway: one raw ssh2 front door, one session handler that
 * branches on channel type (the wish / gliderlabs / git-shell model). A shell
 * request whose username is a share id renders that plan read-only; an exec
 * request as user `share` receives an uploaded blob. Everything else is denied.
 *
 * The gateway is the only component that holds a key: the client uploads
 * plaintext-over-SSH, the gateway seals it before R2 ever sees it, and decrypts
 * only to render server-side (ADR 0004's trust-the-gateway model).
 */

import { createHash } from "node:crypto";
import React from "react";
import * as v from "valibot";
import {
  Server,
  utils,
  type AuthContext,
  type Connection,
  type ServerChannel,
  type Session,
} from "ssh2";
import type { Annotation, ReviewSession } from "@cueloop/schema";
import { AnnotationSchema } from "@cueloop/daemon/validate";
import { App } from "@cueloop/client";
import {
  DEFAULT_SHARE_HOST,
  packSessionBlob,
  unpackSessionBlob,
  MAX_BLOB_BYTES,
} from "@cueloop/daemon/share-blob";
import { BlobSessionClient } from "./blob-session-client";
import {
  renderOverChannel,
  TERMINAL_RESTORE,
  type ChannelRender,
  type PtySize,
} from "./channel-renderer";
import { openBlob, sealBlob } from "./crypto";
import { loadOrCreateHostKey } from "./host-key";
import { GatewayMetrics, startMetricsServer } from "./metrics";
import { TokenBucket } from "./rate-limit";
import { SHARE_UPLOAD_USER, isShareId, mintShareId } from "./share-id";
import { WatchedShareStore, type ShareStore } from "./store";

const PushPayloadSchema = v.object({
  shareId: v.optional(v.unknown()),
  annotations: v.optional(v.unknown()),
});
const TransportErrorSchema = v.object({
  level: v.optional(v.string()),
  code: v.optional(v.string()),
});

/** How often a quiet watch stream says it is alive. */
export const WATCH_HEARTBEAT_MS = 30_000;

/** One line of a `cueloop-watch` stream. */
export type WatchFrame =
  | { type: "ready" }
  | { type: "ping" }
  | { type: "session"; session: ReviewSession };

export interface GatewayOptions {
  store: ShareStore;
  /** 256-bit master key; the per-blob keys derive from it. */
  masterKey: Buffer;
  /** Where the persisted SSH host key lives. */
  hostKeyPath: string;
  /** Listen port. Default 22 (the gateway owns it); tests pass 0. */
  port?: number;
  /** Bind address. Default 0.0.0.0 in production; tests pass 127.0.0.1. */
  host?: string;
  /** Host shown in the minted `ssh <id>@<host>` line. Default cueloop.dev. */
  publicHost?: string;
  /** Largest accepted upload. Default MAX_BLOB_BYTES (1 MiB). */
  maxUploadBytes?: number;
  /** When set, serve Prometheus `/metrics` on this port (loopback). Off if absent. */
  metricsPort?: number;
  /** Bind for the metrics server. Default 127.0.0.1 - never expose it on the public port. */
  metricsHost?: string;
  onError?: (cause: unknown) => void;
}

export interface GatewayHandle {
  host: string;
  port: number;
  /** The bound loopback metrics port, when a metrics server was started. */
  metricsPort?: number;
  close(): Promise<void>;
}

/** The verified-key identity captured at auth; fingerprint feeds attribution. */
interface Identity {
  username: string;
  fingerprint: string;
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
  const publicHost = options.publicHost ?? DEFAULT_SHARE_HOST;
  const maxUploadBytes = options.maxUploadBytes ?? MAX_BLOB_BYTES;
  const onError = options.onError ?? ((cause: unknown) => console.error("[gateway]", cause));
  const uploadLimiter = new TokenBucket(20, 1);
  const hostKey = loadOrCreateHostKey(options.hostKeyPath);

  // Metrics are always collected (bounded, negligible) but only served when a
  // port is configured, so production is unaffected until an operator opts in.
  const metrics = new GatewayMetrics();
  const store = new WatchedShareStore(meterStore(options.store, metrics));
  const metricsServer =
    options.metricsPort !== undefined
      ? startMetricsServer(metrics, { host: options.metricsHost, port: options.metricsPort })
      : null;

  const clients = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKey] }, (client, info) => {
    const remoteIp = info.ip;
    let identity: Identity | null = null;

    clients.add(client);
    client.on("close", () => clients.delete(client));

    client.on("authentication", (ctx: AuthContext) => {
      // Accept any key, but require one and PROVE ownership: the fingerprint is
      // the zero-signup identity (ADR 0003), so it must be spoof-proof.
      // Rejecting `none` guarantees we always capture a key. Public-key auth is
      // two passes: the probe carries no signature - accept it so the client
      // signs; the signed pass we verify against the presented key. ssh2 does
      // not verify for us, so skipping this would let anyone claim any key.
      if (ctx.method !== "publickey") return ctx.reject(["publickey"]);
      if (ctx.signature) {
        const key = utils.parseKey(ctx.key.data);

        if (
          key instanceof Error ||
          !ctx.blob ||
          !key.verify(ctx.blob, ctx.signature, ctx.hashAlgo)
        ) {
          return ctx.reject();
        }
      }
      identity = { username: ctx.username, fingerprint: keyFingerprint(ctx.key.data) };
      ctx.accept();
    });

    client.on("ready", () => {
      client.on("session", (accept) => {
        if (identity) handleSession(accept(), identity, remoteIp);
      });
    });
    client.on("error", (err) => {
      // Scanners on the open :22 fail the handshake constantly; keep those to one
      // terse line and reserve the loud path for genuinely unexpected errors.
      if (isExpectedTransportError(err))
        console.warn(`[gateway] dropped ${remoteIp}: ${errorMessage(err)}`);
      else onError(err);
    });
  });

  function handleSession(session: Session, identity: Identity, remoteIp: string): void {
    let pty: PtySize = { cols: 80, rows: 24 };
    let render: ChannelRender | null = null;

    session.on("pty", (accept, _reject, info) => {
      pty = { cols: info.cols, rows: info.rows };
      accept?.();
    });
    session.on("window-change", (accept, _reject, info) => {
      pty = { cols: info.cols, rows: info.rows };
      render?.resize(pty);
      accept?.();
    });

    session.on("shell", (accept) => {
      const channel = accept();

      void handleView(channel, identity, pty, (handle) => (render = handle));
    });

    session.on("exec", (accept, reject, info) => {
      if (identity.username !== SHARE_UPLOAD_USER) return reject();
      const channel = accept();

      if (info.command === "cueloop-pull") void handlePull(channel, identity);
      else if (info.command === "cueloop-push") void handlePush(channel, identity);
      else if (info.command === "cueloop-watch") void handleWatch(channel, identity);
      else void handleUpload(channel, identity, remoteIp);
    });
  }

  async function handleView(
    channel: ServerChannel,
    identity: Identity,
    pty: PtySize,
    keepRender: (handle: ChannelRender) => void,
  ): Promise<void> {
    const startedAt = Date.now();
    const shareId = identity.username;

    if (!isShareId(shareId)) {
      channel.stderr.write(
        "cueloop: connect as ssh <share-id>@" + publicHost + " to view a shared plan\r\n",
      );

      return end(channel, 1);
    }
    let session;

    try {
      const stored = await store.get(shareId);

      if (!stored) {
        channel.stderr.write("cueloop: this share was not found or has expired\r\n");

        return end(channel, 1);
      }
      session = unpackSessionBlob(openBlob(options.masterKey, shareId, stored));
    } catch (err) {
      onError(err);
      metrics.recordShare("view", "error", elapsed(startedAt));
      channel.stderr.write("cueloop: could not open this share\r\n");

      return end(channel, 1);
    }
    try {
      // Every viewer is a collaborator: they annotate, and each note unions
      // back into the stored blob stamped with their fingerprint. They cannot
      // edit the plan or submit a verdict (the App's collaborator role).
      const client = new BlobSessionClient(session, {
        store,
        masterKey: options.masterKey,
        shareId,
        author: identity.fingerprint,
        changes: store,
      });
      let handle: ChannelRender | null = null;

      handle = await renderOverChannel(
        channel,
        pty,
        React.createElement(App, {
          sessionId: session.id,
          role: "collaborator",
          selfAuthor: identity.fingerprint,
          openClient: () => Promise.resolve(client),
          // quitting is the graceful path: stop the renderer and restore the
          // terminal before the channel closes, so mouse reporting is left off
          onExit: () => endView(channel, handle, 0),
        }),
      );
      keepRender(handle);
      metrics.recordShare("view", "ok", elapsed(startedAt));
    } catch (err) {
      onError(err);
      metrics.recordShare("view", "error", elapsed(startedAt));
      end(channel, 1);
    }
  }

  async function handleUpload(
    channel: ServerChannel,
    identity: Identity,
    remoteIp: string,
  ): Promise<void> {
    if (!uploadLimiter.take(remoteIp)) {
      channel.stderr.write("cueloop: rate limited, try again shortly\r\n");

      return end(channel, 1);
    }
    const startedAt = Date.now();
    let id: string;

    try {
      const bytes = await readCapped(channel, maxUploadBytes);
      // shareId is the planner's local marker; it must never live in the blob,
      // or a collaborator's view would try to pull/push against the gateway.
      const { shareId: _local, ...uploaded } = unpackSessionBlob(bytes);
      const session = { ...uploaded, owner: identity.fingerprint };

      id = mintShareId();
      await store.put(id, sealBlob(options.masterKey, id, packSessionBlob(session)));
    } catch (cause) {
      onError(cause);
      metrics.recordShare("create", "error", elapsed(startedAt));
      channel.stderr.write(
        `cueloop: upload rejected - ${cause instanceof Error ? cause.message : String(cause)}\r\n`,
      );

      return end(channel, 1);
    }
    channel.write(`ssh ${id}@${publicHost}\n`);
    metrics.recordShare("create", "ok", elapsed(startedAt));
    end(channel, 0);
  }

  // The owner (the fingerprint that uploaded) pulls the current session back.
  async function handlePull(channel: ServerChannel, identity: Identity): Promise<void> {
    const startedAt = Date.now();

    try {
      const shareId = (await readCapped(channel, 256)).toString("utf8").trim();

      if (!isShareId(shareId)) return void fail(channel, "not a share id");
      const stored = await store.get(shareId);

      if (!stored) return void fail(channel, "this share was not found or has expired");
      const session = unpackSessionBlob(openBlob(options.masterKey, shareId, stored));

      if (session.owner !== identity.fingerprint)
        return void fail(channel, "only the planner who shared this can pull it");
      channel.write(JSON.stringify(session));
      metrics.recordShare("pull", "ok", elapsed(startedAt));
      end(channel, 0);
    } catch (err) {
      onError(err);
      metrics.recordShare("pull", "error", elapsed(startedAt));
      fail(channel, "could not read this share");
    }
  }

  /**
   * The owner follows the share live: after the id, the channel stays open and
   * carries one JSON line per change with the whole session record, plus a
   * heartbeat so a dead link is noticed. The client reconnects when it closes.
   */
  async function handleWatch(channel: ServerChannel, identity: Identity): Promise<void> {
    const startedAt = Date.now();
    let shareId: string;

    try {
      shareId = (await readCapped(channel, 256)).toString("utf8").trim();
      if (!isShareId(shareId)) return void fail(channel, "not a share id");
      const stored = await store.get(shareId);

      if (!stored) return void fail(channel, "this share was not found or has expired");
      const session = unpackSessionBlob(openBlob(options.masterKey, shareId, stored));

      if (session.owner !== identity.fingerprint)
        return void fail(channel, "only the planner who shared this can watch it");
    } catch (err) {
      onError(err);
      metrics.recordShare("watch", "error", elapsed(startedAt));

      return void fail(channel, "could not read this share");
    }
    const send = (frame: WatchFrame): void => void channel.write(`${JSON.stringify(frame)}\n`);
    const heartbeat = setInterval(() => send({ type: "ping" }), WATCH_HEARTBEAT_MS);
    const unsubscribe = store.subscribe(shareId, () => {
      void store
        .get(shareId)
        .then((bytes) => {
          if (!bytes) return finish();
          send({
            type: "session",
            session: unpackSessionBlob(openBlob(options.masterKey, shareId, bytes)),
          });
        })
        .catch(onError);
    });
    const finish = (): void => {
      unsubscribe();
      clearInterval(heartbeat);
      end(channel, 0);
    };

    channel.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
    send({ type: "ready" });
    metrics.recordShare("watch", "ok", elapsed(startedAt));
  }

  // The owner mirrors their own annotations into the share (stage 2 push-up).
  async function handlePush(channel: ServerChannel, identity: Identity): Promise<void> {
    const startedAt = Date.now();

    try {
      const payload = v.parse(
        PushPayloadSchema,
        JSON.parse((await readCapped(channel, maxUploadBytes)).toString("utf8")),
      );
      const shareId = v.safeParse(v.string(), payload.shareId);
      const annotations = v.safeParse(v.array(AnnotationSchema), payload.annotations);

      if (!shareId.success || !isShareId(shareId.output))
        return void fail(channel, "not a share id");
      if (!annotations.success) return void fail(channel, "annotations must be a list");
      const stored = await store.get(shareId.output);

      if (!stored) return void fail(channel, "this share was not found or has expired");
      const session = unpackSessionBlob(openBlob(options.masterKey, shareId.output, stored));

      if (session.owner !== identity.fingerprint)
        return void fail(channel, "only the planner who shared this can push to it");
      // Round-trip validates the pushed notes: a malformed one throws here, so the stored blob stays intact.
      const next = unpackSessionBlob(
        packSessionBlob(mergeOwnerAnnotations(session, annotations.output)),
      );

      await store.put(
        shareId.output,
        sealBlob(options.masterKey, shareId.output, packSessionBlob(next)),
      );
      metrics.recordShare("push", "ok", elapsed(startedAt));
      end(channel, 0);
    } catch (err) {
      onError(err);
      metrics.recordShare("push", "error", elapsed(startedAt));
      fail(channel, "could not update this share");
    }
  }

  const port = options.port ?? 22;
  const host = options.host ?? "0.0.0.0";
  const listened = await new Promise<{ host: string; port: number }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, function (this: Server) {
      server.off("error", reject);
      const address = this.address();

      resolve({ host, port: address instanceof Object ? address.port : port });
    });
  });

  return {
    ...listened,
    metricsPort: metricsServer?.port,
    // Stop accepting, end live connections, and resolve at once. We do not wait
    // for every connection to drain: a viewer whose renderer is still tearing
    // down must never stall shutdown (systemctl stop, or a test's teardown).
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end();
        clients.clear();
        server.close();
        metricsServer?.stop();
        resolve();
      }),
  };
}

/** Seconds since `startedAt`, for latency histograms. */
function elapsed(startedAt: number): number {
  return (Date.now() - startedAt) / 1000;
}

/** Wrap a store so every R2 get/put counts toward the R2 error-rate SLI. */
function meterStore(store: ShareStore, metrics: GatewayMetrics): ShareStore {
  return {
    async get(id) {
      try {
        const bytes = await store.get(id);

        metrics.recordR2("get", "ok");

        return bytes;
      } catch (err) {
        metrics.recordR2("get", "error");
        throw err;
      }
    },
    async put(id, bytes) {
      try {
        await store.put(id, bytes);
        metrics.recordR2("put", "ok");
      } catch (err) {
        metrics.recordR2("put", "error");
        throw err;
      }
    },
  };
}

/** SHA256 fingerprint of a public key, in OpenSSH's `SHA256:...` form. */
function keyFingerprint(keyData: Buffer): string {
  return "SHA256:" + createHash("sha256").update(keyData).digest("base64").replace(/=+$/, "");
}

/** Drain an exec channel's stdin, failing fast past the byte cap. */
function readCapped(channel: ServerChannel, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    channel.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        reject(new Error(`upload exceeds ${max} bytes`));
        channel.destroy();

        return;
      }
      chunks.push(chunk);
    });
    channel.on("end", () => resolve(Buffer.concat(chunks)));
    channel.on("error", reject);
  });
}

function end(channel: ServerChannel, code: number): void {
  channel.exit(code);
  channel.end();
}

/**
 * Graceful teardown of a rendered view: stop the renderer (no more frames), then
 * write the terminal-restore bytes straight to the still-open channel and flush
 * them with the close. Relying on the renderer's post-close restore drops these
 * (the wrapped stdout early-returns once the channel is gone), leaving the
 * client's terminal spewing SGR mouse reports.
 */
function endView(channel: ServerChannel, render: ChannelRender | null, code: number): void {
  render?.destroy();
  channel.write(TERMINAL_RESTORE);
  end(channel, code);
}

function fail(channel: ServerChannel, message: string): void {
  channel.stderr.write(`cueloop: ${message}\r\n`);
  end(channel, 1);
}

/** ssh2 transport failures from the open internet (bad handshake, auth abort, reset) are per-connection and expected - not gateway faults. */
export function isExpectedTransportError(cause: unknown): boolean {
  const result = v.safeParse(TransportErrorSchema, cause);

  if (!result.success) return false;
  const { level, code } = result.output;

  if (level === "handshake" || level === "authentication" || level === "protocol") return true;

  return code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Union the owner's own notes into the blob by id, never clobbering a collaborator's. */
function mergeOwnerAnnotations(
  session: ReviewSession,
  incoming: Array<Omit<Annotation, "createdAt">>,
): ReviewSession {
  const byId = new Map(session.annotations.map((annotation) => [annotation.id, annotation]));
  const now = new Date().toISOString();

  for (const note of incoming) {
    const existing = byId.get(note.id);

    if (existing?.author) continue;
    // the owner's notes stay unauthored: strip any author so the pull filter and the delete guard hold
    const { author: _drop, ...rest } = note;

    byId.set(note.id, { ...rest, createdAt: existing?.createdAt ?? now });
  }

  return { ...session, annotations: [...byId.values()] };
}

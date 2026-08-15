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
import { Server, utils, type AuthContext, type Connection, type ServerChannel, type Session } from "ssh2";
import { App } from "@cueloop/client";
import { DEFAULT_SHARE_HOST, packSessionBlob, unpackSessionBlob, MAX_BLOB_BYTES } from "@cueloop/daemon/share-blob";
import { BlobSessionClient } from "./blob-session-client";
import { renderOverChannel, type ChannelRender, type PtySize } from "./channel-renderer";
import { openBlob, sealBlob } from "./crypto";
import { loadOrCreateHostKey } from "./host-key";
import { TokenBucket } from "./rate-limit";
import { SHARE_UPLOAD_USER, isShareId, mintShareId } from "./share-id";
import type { ShareStore } from "./store";

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
  onError?: (err: unknown) => void;
}

export interface GatewayHandle {
  host: string;
  port: number;
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
  const onError = options.onError ?? ((err: unknown) => console.error("[gateway]", err));
  const uploadLimiter = new TokenBucket(20, 1);
  const hostKey = loadOrCreateHostKey(options.hostKeyPath);

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
        if (key instanceof Error || !ctx.blob || !key.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) {
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
    client.on("error", onError);
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
      if (info.command.includes("pull")) void handlePull(channel, identity);
      else void handleUpload(channel, identity, remoteIp);
    });
  }

  async function handleView(
    channel: ServerChannel,
    identity: Identity,
    pty: PtySize,
    keepRender: (handle: ChannelRender) => void,
  ): Promise<void> {
    const shareId = identity.username;
    if (!isShareId(shareId)) {
      channel.stderr.write("cueloop: connect as ssh <share-id>@" + publicHost + " to view a shared plan\r\n");
      return end(channel, 1);
    }
    let session;
    try {
      const stored = await options.store.get(shareId);
      if (!stored) {
        channel.stderr.write("cueloop: this share was not found or has expired\r\n");
        return end(channel, 1);
      }
      session = unpackSessionBlob(openBlob(options.masterKey, shareId, stored));
    } catch (err) {
      onError(err);
      channel.stderr.write("cueloop: could not open this share\r\n");
      return end(channel, 1);
    }
    try {
      // Every viewer is a collaborator: they annotate, and each note unions
      // back into the stored blob stamped with their fingerprint. They cannot
      // edit the plan or submit a verdict (the App's collaborator role).
      const client = new BlobSessionClient(session, {
        store: options.store,
        masterKey: options.masterKey,
        shareId,
        author: identity.fingerprint,
      });
      keepRender(
        await renderOverChannel(
          channel,
          pty,
          React.createElement(App, {
            sessionId: session.id,
            role: "collaborator",
            openClient: () => Promise.resolve(client),
            onExit: () => end(channel, 0),
          }),
        ),
      );
    } catch (err) {
      onError(err);
      end(channel, 1);
    }
  }

  async function handleUpload(channel: ServerChannel, identity: Identity, remoteIp: string): Promise<void> {
    if (!uploadLimiter.take(remoteIp)) {
      channel.stderr.write("cueloop: rate limited, try again shortly\r\n");
      return end(channel, 1);
    }
    let id: string;
    try {
      const bytes = await readCapped(channel, maxUploadBytes);
      const session = { ...unpackSessionBlob(bytes), owner: identity.fingerprint };
      id = mintShareId();
      await options.store.put(id, sealBlob(options.masterKey, id, packSessionBlob(session)));
    } catch (err) {
      onError(err);
      channel.stderr.write(`cueloop: upload rejected - ${err instanceof Error ? err.message : String(err)}\r\n`);
      return end(channel, 1);
    }
    channel.write(`ssh ${id}@${publicHost}\n`);
    end(channel, 0);
  }

  // The owner (the fingerprint that uploaded) pulls the current session back.
  async function handlePull(channel: ServerChannel, identity: Identity): Promise<void> {
    try {
      const shareId = (await readCapped(channel, 256)).toString("utf8").trim();
      if (!isShareId(shareId)) return void reject(channel, "not a share id");
      const stored = await options.store.get(shareId);
      if (!stored) return void reject(channel, "this share was not found or has expired");
      const session = unpackSessionBlob(openBlob(options.masterKey, shareId, stored));
      if (session.owner !== identity.fingerprint) return void reject(channel, "only the planner who shared this can pull it");
      channel.write(JSON.stringify(session));
      end(channel, 0);
    } catch (err) {
      onError(err);
      reject(channel, "could not read this share");
    }
  }

  const port = options.port ?? 22;
  const host = options.host ?? "0.0.0.0";
  const listened = await new Promise<{ host: string; port: number }>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, function (this: Server) {
      server.off("error", reject);
      const address = this.address();
      resolve({ host, port: typeof address === "object" && address ? address.port : port });
    });
  });

  return {
    ...listened,
    // Stop accepting, end live connections, and resolve at once. We do not wait
    // for every connection to drain: a viewer whose renderer is still tearing
    // down must never stall shutdown (systemctl stop, or a test's teardown).
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end();
        clients.clear();
        server.close();
        resolve();
      }),
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

function reject(channel: ServerChannel, message: string): void {
  channel.stderr.write(`cueloop: ${message}\r\n`);
  end(channel, 1);
}

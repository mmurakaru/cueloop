import { Client, type ClientChannel } from "ssh2";
import {
  loadGhosttyTerminals,
  type GhosttyTerminal,
} from "../../../packages/client/src/terminal/ghostty-terminal";
import { encodePtyKeyPress, type PtyKeyPress } from "../../helpers/pty-key-codes";
import { waitForMirrorCondition } from "./mirror-process";

export type MirrorSshIdentity = { port: number; privateKey: string; username: string };

export function connectMirrorSsh(identity: MirrorSshIdentity): Promise<Client> {
  return new Promise((resolve, reject) => {
    const connection = new Client();

    connection.on("ready", () => resolve(connection));
    connection.on("error", reject);
    connection.connect({ host: "127.0.0.1", ...identity, readyTimeout: 10_000 });
  });
}

export async function execMirrorSsh(
  identity: MirrorSshIdentity,
  command: string,
  input: Uint8Array | string,
  endInput = true,
): Promise<Buffer> {
  const connection = await connectMirrorSsh(identity);

  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let diagnostic = "";
      const timer = setTimeout(() => {
        connection.destroy();
        reject(new Error(`Gateway mirror SSH command timed out: ${command}`));
      }, 30_000);

      connection.exec(command, (error, channel) => {
        if (error) {
          clearTimeout(timer);
          reject(error);

          return;
        }
        channel.on("data", (chunk: Buffer) => chunks.push(chunk));
        channel.stderr.on("data", (chunk: Buffer) => (diagnostic += chunk.toString()));
        channel.on("close", (code: number | undefined) => {
          clearTimeout(timer);
          if (code && code !== 0) reject(new Error(diagnostic || `SSH command exited ${code}`));
          else resolve(Buffer.concat(chunks));
        });
        if (endInput) channel.end(input);
        else channel.write(input);
      });
    });
  } finally {
    connection.end();
  }
}

/** Assertions observe rendered cells, not stale text left in the SSH byte stream. */
export class MirrorSshView {
  private channel?: ClientChannel;
  private connection?: Client;
  private closed = false;
  readonly terminal: GhosttyTerminal;
  readonly cols = 120;
  readonly rows = 40;

  constructor() {
    const terminal = loadGhosttyTerminals()?.create(this.cols, this.rows);

    if (!terminal) throw new Error("Gateway mirror requires the native Ghostty VT test library");
    this.terminal = terminal;
  }

  async open(identity: MirrorSshIdentity, title: string): Promise<void> {
    this.connection = await connectMirrorSsh(identity);
    this.channel = await new Promise<ClientChannel>((resolve, reject) =>
      this.connection!.shell(
        { term: "xterm-256color", cols: this.cols, rows: this.rows },
        (error, channel) => (error ? reject(error) : resolve(channel)),
      ),
    );
    this.channel.on("data", (bytes: Buffer) => this.terminal.write(bytes));
    this.channel.on("close", () => (this.closed = true));
    // Each test viewer has a fresh key and therefore gets the identity dialog.
    await this.waitForText("welcome");
    this.press("escape");
    await this.waitForScreen(() => !this.text().includes("welcome"), "identity dialog dismissed");
    await this.waitForText(title);
  }

  text(): string {
    return Array.from({ length: this.rows }, (_, row) =>
      this.terminal.rowText(row, this.cols),
    ).join("\n");
  }

  write(text: string): void {
    if (this.closed || !this.channel) throw new Error("Gateway mirror SSH view is closed");
    this.channel.write(text);
  }

  press(key: PtyKeyPress): void {
    this.write(encodePtyKeyPress(key));
  }

  click(column: number, row: number): void {
    this.write(`\x1b[<0;${column + 1};${row + 1}M\x1b[<0;${column + 1};${row + 1}m`);
  }

  async selectText(text: string): Promise<void> {
    const lines = this.text().split("\n");
    const row = lines.findIndex((line) => line.includes(text));
    const column = lines[row]?.indexOf(text) ?? -1;

    if (column < 0) throw new Error(`Gateway mirror cannot select missing text: ${text}`);
    const before = JSON.stringify(this.terminal.readCell(column + 1, row));

    this.write(
      `\x1b[<0;${column + 1};${row + 1}M\x1b[<32;${column + text.length + 1};${row + 1}M\x1b[<0;${column + text.length + 1};${row + 1}m`,
    );
    await this.waitForScreen(
      () => JSON.stringify(this.terminal.readCell(column + 1, row)) !== before,
      "selected passage",
    );
  }

  async waitForText(text: string): Promise<void> {
    await this.waitForScreen(() => this.text().includes(text), text);
  }

  async waitForScreen(predicate: () => boolean, label: string): Promise<void> {
    try {
      await waitForMirrorCondition(label, () => {
        if (this.closed) throw new Error("SSH view closed before its expected frame");

        return predicate();
      });
    } catch (error) {
      throw new Error(`Gateway mirror screen failed: ${label}\n${this.text()}`, { cause: error });
    }
  }

  close(): void {
    this.channel?.destroy();
    this.connection?.destroy();
    this.terminal.free();
  }
}

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import { DeliveredMessageStore } from "./delivered-message-store";

const home = mkdtempSync(join(tmpdir(), "cueloop-delivered-messages-"));
const path = join(home, "ids.json");
const message: Message = {
  id: "msg_1",
  outcome: "approved",
  summary: "Ready.",
  body: "# Review: approved",
  sentAt: "2026-09-21T00:00:00.000Z",
};

interface InjectionGate {
  release?: () => void;
  started?: () => void;
}

afterEach(() => {
  rmSync(path, { force: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("DeliveredMessageStore", () => {
  test("deduplicates a successful injection after adapter reload", async () => {
    const injected: Message[] = [];
    const first = new DeliveredMessageStore(path);

    await first.sendOnce(message, (payload) => {
      injected.push(payload);
    });
    await new DeliveredMessageStore(path).sendOnce(message, (payload) => {
      injected.push(payload);
    });

    expect(injected).toEqual([message]);
  });

  test("does not record a failed native injection", async () => {
    const first = new DeliveredMessageStore(path);

    await expect(
      first.sendOnce(message, () => {
        throw new Error("native send failed");
      }),
    ).rejects.toThrow("native send failed");

    const injected: Message[] = [];

    await new DeliveredMessageStore(path).sendOnce(message, (payload) => {
      injected.push(payload);
    });

    expect(injected).toEqual([message]);
  });

  test("rejects a corrupt journal instead of re-injecting old Messages", () => {
    writeFileSync(path, "{broken");

    expect(() => new DeliveredMessageStore(path)).toThrow();
  });

  test("serializes concurrent sends from independent store instances", async () => {
    const secondMessage = { ...message, id: "msg_2" };
    const injected: string[] = [];
    const gate: InjectionGate = {};
    const firstStarted = new Promise<void>((resolve) => {
      gate.started = resolve;
    });
    const firstInjection = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const first = new DeliveredMessageStore(path).sendOnce(message, async () => {
      injected.push(message.id);
      gate.started?.();
      await firstInjection;
    });
    const second = new DeliveredMessageStore(path).sendOnce(secondMessage, () => {
      injected.push(secondMessage.id);
    });

    await firstStarted;
    expect(injected).toEqual([message.id]);
    gate.release?.();
    await Promise.all([first, second]);
    await new DeliveredMessageStore(path).sendOnce(message, () => {
      injected.push(message.id);
    });
    await new DeliveredMessageStore(path).sendOnce(secondMessage, () => {
      injected.push(secondMessage.id);
    });

    expect(injected).toEqual([message.id, secondMessage.id]);
  });

  test("serializes concurrent retries of the same Message", async () => {
    const injected: string[] = [];

    await Promise.all([
      new DeliveredMessageStore(path).sendOnce(message, () => {
        injected.push(message.id);
      }),
      new DeliveredMessageStore(path).sendOnce(message, () => {
        injected.push(message.id);
      }),
    ]);

    expect(injected).toEqual([message.id]);
  });

  test("recovers an abandoned lock from a terminated process", async () => {
    writeFileSync(path + ".lock", "99999999");
    const injected: string[] = [];

    await new DeliveredMessageStore(path).sendOnce(message, () => {
      injected.push(message.id);
    });

    expect(injected).toEqual([message.id]);
  });
});

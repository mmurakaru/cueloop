/**
 * Durable harness routing state. Bindings identify where a Thread came from;
 * deliveries record which Message still needs to reach that binding. Keeping
 * both outside Thread records prevents harness identity from leaking into the
 * product primitive and makes redelivery independent of the review lifecycle.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Delivery, HarnessBinding } from "@cueloop/schema";
import * as v from "valibot";
import { harnessStatePath } from "./paths";

type BindInput = Pick<HarnessBinding, "threadId" | "harness" | "harnessSessionId">;
type EnqueueInput = Pick<Delivery, "bindingId" | "messageId">;

const NonEmpty = v.pipe(v.string(), v.minLength(1));
const HarnessBindingSchema = v.object({
  id: NonEmpty,
  threadId: NonEmpty,
  harness: NonEmpty,
  harnessSessionId: NonEmpty,
  createdAt: NonEmpty,
});
const DeliverySchema = v.object({
  id: NonEmpty,
  messageId: NonEmpty,
  bindingId: NonEmpty,
  status: v.picklist(["pending", "acknowledged"]),
  createdAt: NonEmpty,
  acknowledgedAt: v.optional(NonEmpty),
});
const HarnessStateSchema = v.object({
  bindings: v.array(HarnessBindingSchema),
  deliveries: v.array(DeliverySchema),
});
const FileErrorSchema = v.object({ code: v.string() });

export class HarnessStateStore {
  private readonly path: string;
  private bindings = new Map<string, HarnessBinding>();
  private deliveries = new Map<string, Delivery>();

  constructor(home: string) {
    this.path = harnessStatePath(home);
    this.load();
  }

  bind(input: BindInput): HarnessBinding {
    const existing = [...this.bindings.values()].find(
      (binding) =>
        binding.threadId === input.threadId &&
        binding.harness === input.harness &&
        binding.harnessSessionId === input.harnessSessionId,
    );

    if (existing) return existing;
    const binding: HarnessBinding = {
      ...input,
      id: newRoutingId("bind"),
      createdAt: new Date().toISOString(),
    };

    this.bindings.set(binding.id, binding);
    this.persist();

    return binding;
  }

  binding(id: string): HarnessBinding | null {
    return this.bindings.get(id) ?? null;
  }

  /** The first binding is the submitter; other bindings need explicit future routing. */
  submittingBinding(threadId: string): HarnessBinding | null {
    return [...this.bindings.values()].find((binding) => binding.threadId === threadId) ?? null;
  }

  enqueue(input: EnqueueInput): Delivery {
    const existing = [...this.deliveries.values()].find(
      (delivery) =>
        delivery.bindingId === input.bindingId && delivery.messageId === input.messageId,
    );

    if (existing) return existing;
    const delivery: Delivery = {
      ...input,
      id: newRoutingId("del"),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.deliveries.set(delivery.id, delivery);
    this.persist();

    return delivery;
  }

  pending(bindingId: string): Delivery[] {
    return [...this.deliveries.values()].filter(
      (delivery) => delivery.bindingId === bindingId && delivery.status === "pending",
    );
  }

  delivery(deliveryId: string): Delivery | null {
    return this.deliveries.get(deliveryId) ?? null;
  }

  acknowledge(deliveryId: string, acknowledgedAt = new Date().toISOString()): Delivery {
    const delivery = this.deliveries.get(deliveryId);

    if (!delivery) throw new Error(`no delivery ${deliveryId}`);
    if (delivery.status === "acknowledged") return delivery;
    const acknowledged: Delivery = {
      ...delivery,
      status: "acknowledged",
      acknowledgedAt,
    };

    this.deliveries.set(deliveryId, acknowledged);
    this.persist();

    return acknowledged;
  }

  private load(): void {
    let serialized: string;

    try {
      serialized = readFileSync(this.path, "utf8");
    } catch (error) {
      const parsed = v.safeParse(FileErrorSchema, error);

      if (parsed.success && parsed.output.code === "ENOENT") {
        return;
      }

      throw error;
    }

    const state = v.parse(HarnessStateSchema, JSON.parse(serialized));

    this.bindings = new Map(state.bindings.map((binding) => [binding.id, binding]));
    this.deliveries = new Map(state.deliveries.map((delivery) => [delivery.id, delivery]));
  }

  private persist(): void {
    const temporaryPath = this.path + ".tmp";
    const state = {
      bindings: [...this.bindings.values()],
      deliveries: [...this.deliveries.values()],
    };

    writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
    renameSync(temporaryPath, this.path);
  }
}

function newRoutingId(prefix: "bind" | "del"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

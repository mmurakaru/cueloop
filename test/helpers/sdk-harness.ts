import type { AgentHarnessAdapter } from "@cueloop/schema";

/** Controlled completion lets socket tests prove local cancellation preserves harness work. */
export function createTestSdkHarness() {
  let finish: (() => void) | undefined;
  let cancelled = 0;
  const adapter: AgentHarnessAdapter = {
    id: "sdk-test",
    label: "SDK test",
    connect({ onEvent }) {
      return {
        start: async () => "test-session",
        prompt: () =>
          new Promise((resolve) => {
            finish = () => {
              onEvent({ kind: "message", id: crypto.randomUUID(), text: "Answer" });
              resolve({ outcome: "completed" });
            };
          }),
        cancel: () => {
          cancelled++;
          finish?.();
        },
        permission() {},
        close() {},
      };
    },
  };

  return { adapter, complete: () => finish?.(), cancelled: () => cancelled };
}

import { createThreadHarness, type ThreadHarnessOptions } from "../thread-harness";

export type PiHarnessOptions = Omit<ThreadHarnessOptions, "backend">;

export function createPiHarness(config: PiHarnessOptions) {
  return createThreadHarness(config);
}

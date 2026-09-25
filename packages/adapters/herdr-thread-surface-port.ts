import {
  openHerdrThreadSurface,
  type HerdrThreadSurfacePersistence,
} from "@cueloop/daemon/herdr-thread-surface";
import { loadHerdrThreadSurface } from "@cueloop/daemon/thread-surface-config";
import type { HerdrEnv } from "@cueloop/schema";
import type { ThreadSurfacePort } from "./harness-thread-controller";

/** Herdr opens the canonical cueloop TUI; the controller owns the pending gate. */
export function createHerdrThreadSurfacePort(
  persistence: HerdrThreadSurfacePersistence,
  env: HerdrEnv = process.env,
  userConfigPath?: string,
): ThreadSurfacePort {
  return {
    openThreads(_threadId, _panel, thread) {
      return openHerdrThreadSurface(
        thread,
        persistence,
        env,
        loadHerdrThreadSurface(userConfigPath),
      );
    },
  };
}

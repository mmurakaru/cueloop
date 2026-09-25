import {
  openGhosttyThreadSurface,
  type GhosttyThreadSurfacePersistence,
} from "@cueloop/daemon/ghostty-thread-surface";
import {
  openHerdrThreadSurface,
  type HerdrThreadSurfacePersistence,
} from "@cueloop/daemon/herdr-thread-surface";
import {
  loadGhosttyThreadSurface,
  loadHerdrThreadSurface,
} from "@cueloop/daemon/thread-surface-config";
import type { ThreadSurfacePort } from "./harness-thread-controller";

/** Herdr owns layout when it is nested inside Ghostty. */
export function createTerminalThreadSurfacePort(
  persistence: HerdrThreadSurfacePersistence & GhosttyThreadSurfacePersistence,
  env: NodeJS.ProcessEnv = process.env,
  userConfigPath?: string,
): ThreadSurfacePort {
  return {
    async openThreads(_threadId, _panel, thread) {
      const herdr = await openHerdrThreadSurface(
        thread,
        persistence,
        env,
        loadHerdrThreadSurface(userConfigPath),
      );

      if (herdr !== "unavailable") return herdr;

      return openGhosttyThreadSurface(
        thread,
        persistence,
        env,
        loadGhosttyThreadSurface(userConfigPath),
      );
    },
  };
}

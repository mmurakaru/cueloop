/** Personal-only terminal automation settings. Repository config cannot open terminals. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";

/** Placement of a cueloop Thread inside Herdr. */
export type HerdrThreadSurface = "tab" | "pane" | "none";

const PersonalThreadSurfaceSchema = v.object({
  integrations: v.optional(
    v.object({
      herdr: v.optional(
        v.object({
          thread_surface: v.fallback(v.optional(v.picklist(["tab", "pane", "none"])), undefined),
        }),
      ),
    }),
  ),
});

/** Read Herdr placement from the personal TOML file only; invalid values use the tab default. */
export function loadHerdrThreadSurface(userConfigPath?: string): HerdrThreadSurface {
  const path =
    userConfigPath ??
    process.env.CUELOOP_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml");

  if (!existsSync(path)) return "tab";

  try {
    const parsed = v.safeParse(
      PersonalThreadSurfaceSchema,
      Bun.TOML.parse(readFileSync(path, "utf8")),
    );

    return parsed.success ? (parsed.output.integrations?.herdr?.thread_surface ?? "tab") : "tab";
  } catch {
    return "tab";
  }
}

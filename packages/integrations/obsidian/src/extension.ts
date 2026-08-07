/**
 * The bundled Obsidian extension: a plain factory over the pure core,
 * registering through the public extension API like any third-party
 * extension would (no privileged built-ins).
 */

import type { ExtensionFactory } from "@cueloop/extension-api";
import { exportSession, type ObsidianConfig } from "./export";

export function createObsidianExtension(config: ObsidianConfig): ExtensionFactory {
  return (cueloop) => {
    cueloop.registerExporter("obsidian", async (session) => exportSession(session, config));
  };
}

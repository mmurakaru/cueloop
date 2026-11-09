import React from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { SyncTextEditorSession } from "@cueloop/sync/text";
import type { SyncClientOutcome } from "@cueloop/sync/serve";
import { SyncThreadEditor } from "./SyncThreadEditor";
import { loadConfig } from "../settings/config";
import { composeTheme, type Appearance } from "../appearance/theme-presets";

export { SyncThreadEditor } from "./SyncThreadEditor";

/** The host owns terminal rendering; the calling application owns the editor session. */
export async function runSyncTextEditor(
  session: SyncTextEditorSession,
  options: { repoRoot?: string } = {},
): Promise<SyncClientOutcome> {
  const renderer = await createCliRenderer({ enableMouseMovement: true, exitOnCtrlC: false });
  const config = loadConfig(options);
  const root = createRoot(renderer);

  return new Promise<SyncClientOutcome>((resolve) => {
    let exited = false;
    const finish = (outcome: SyncClientOutcome) => {
      if (exited) return;

      exited = true;
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.off("SIGHUP", hangup);
      renderer.destroy();
      resolve(outcome);
    };
    const interrupt = () => finish({ status: "interrupted", signal: "SIGINT" });
    const terminate = () => finish({ status: "interrupted", signal: "SIGTERM" });
    const hangup = () => finish({ status: "completed" });
    const render = (appearance: Appearance) =>
      root.render(
        <SyncThreadEditor
          session={session}
          theme={composeTheme(config.ui.theme, config.themeOverrides, appearance)}
          onExit={() => finish({ status: "completed" })}
        />,
      );

    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    process.once("SIGHUP", hangup);
    render("dark");
    void renderer
      .waitForThemeMode(100)
      .then((mode) => {
        if (!exited && mode && mode !== "dark") render(mode);
      })
      .catch(() => {});
  });
}

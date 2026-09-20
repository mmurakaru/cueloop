import React from "react";
import type { Theme } from "../theme";

/** The one-line hint above the shared footer: how to leave nav mode, or how to enter it. */
const DIFF_NAV_HINT = "x reject · c fold · d layout · k walk · ⏎ submit · type to leave";
const THREAD_NAV_HINT = "c comment · e edit · s share · n/p cards · ⏎ submit · type to leave";
const COMPOSE_HINT = "type to comment · esc for nav mode";

/**
 * The single mode hint the app shows above its footer. It follows the focused
 * surface: a diff lists the diff commands, a thread the thread commands, and
 * either shows the compose hint while typing. Rendered once, never per surface.
 */
export function NavModeHint({
  navMode,
  surface,
  theme,
}: {
  navMode: boolean;
  surface: "thread" | "diff";
  theme: Theme;
}): React.ReactNode {
  const navHint = surface === "diff" ? DIFF_NAV_HINT : THREAD_NAV_HINT;

  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2 }}>
      <text selectable={false} fg={theme.textDim}>
        {navMode ? navHint : COMPOSE_HINT}
      </text>
    </box>
  );
}

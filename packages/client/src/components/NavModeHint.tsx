import React from "react";
import type { Theme } from "../theme";

const DIFF_NAV_HINT = "x reject · c fold · d layout · k walk · ⏎ submit · type to leave";
const THREAD_NAV_HINT = "c comment · e edit · s share · n/p cards · ⏎ submit · type to leave";
const BARE_NAV_HINT = "c comment · z fold · type to leave";
const COMPOSE_HINT = "type to comment · esc for nav mode";

const NAV_HINTS = { thread: THREAD_NAV_HINT, diff: DIFF_NAV_HINT, bare: BARE_NAV_HINT };

export type NavHintSurface = keyof typeof NAV_HINTS;

export function NavModeHint({
  navMode,
  surface,
  theme,
}: {
  navMode: boolean;
  surface: NavHintSurface;
  theme: Theme;
}): React.ReactNode {
  const navHint = NAV_HINTS[surface];

  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2 }}>
      <text selectable={false} fg={theme.textDim}>
        {navMode ? navHint : COMPOSE_HINT}
      </text>
    </box>
  );
}

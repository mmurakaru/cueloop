// Hover tooltips for the header controls. A tiny header cell clips its own children, so the label is
// surfaced at the screen root instead: controls report the hovered label and cursor cell, and this layer
// paints it one row below, nudged left when it would run past the right edge.

import React, { createContext, useContext, useMemo, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { DARK, type Theme } from "../theme";

interface TooltipTarget {
  label: string;
  x: number;
  y: number;
}

interface TooltipApi {
  showTooltip: (label: string, x: number, y: number) => void;
  hideTooltip: () => void;
}

const TooltipContext = createContext<TooltipApi>({
  showTooltip: () => {},
  hideTooltip: () => {},
});

/** Report or clear the hovered control's tooltip; a no-op outside a TooltipProvider. */
export function useTooltip(): TooltipApi {
  return useContext(TooltipContext);
}

/** Wrap a shell so its header controls can surface hover tooltips at the screen root. */
export function TooltipProvider({
  theme,
  children,
}: {
  theme?: Theme;
  children: React.ReactNode;
}): React.ReactNode {
  const tokens = theme ?? DARK;
  const { width, height } = useTerminalDimensions();
  const [target, setTarget] = useState<TooltipTarget | null>(null);
  const api = useMemo<TooltipApi>(
    () => ({
      showTooltip: (label, x, y) => setTarget({ label, x, y }),
      hideTooltip: () => setTarget(null),
    }),
    [],
  );

  const boxWidth = target ? target.label.length + 2 : 0;
  const left = target ? Math.max(0, Math.min(target.x, width - boxWidth)) : 0;
  const top = target ? (target.y + 1 <= height - 1 ? target.y + 1 : Math.max(0, target.y - 1)) : 0;

  return (
    <TooltipContext.Provider value={api}>
      {children}
      {target ? (
        <box
          style={{
            position: "absolute",
            left,
            top,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: tokens.elevated,
          }}
        >
          <text fg={tokens.text}>{target.label}</text>
        </box>
      ) : null}
    </TooltipContext.Provider>
  );
}

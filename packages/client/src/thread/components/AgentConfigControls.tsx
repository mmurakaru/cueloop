import React, { useEffect, useRef } from "react";
import type { BoxRenderable } from "@opentui/core";
import type { ThreadAgentState, AgentConfigOption } from "@cueloop/schema";
import type { Theme } from "../../appearance/theme";
import { useMenuControl } from "../../ui/components/menu-control";
import { useRootOverlay } from "../../ui/components/RootOverlay";
import { useFrameMeasure } from "../../ui/use-frame-measure";

/** Model and reasoning menus reuse the shell's measured, mutually exclusive overlay. */
export function AgentConfigControls({
  state,
  theme,
  onConfigure,
}: {
  state: ThreadAgentState;
  theme: Theme;
  onConfigure: (id: string, value: string) => void;
}): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", gap: 2, marginRight: 2 }}>
      {state.configOptions
        ?.filter(
          (option) =>
            option.category === "thought_level" ||
            option.id === "model" ||
            option.id === "provider",
        )
        .map((option) => (
          <AgentConfigMenu
            key={option.id}
            option={option}
            theme={theme}
            disabled={state.phase.kind === "running" || state.phase.kind === "permission"}
            onConfigure={onConfigure}
          />
        ))}
    </box>
  );
}

function AgentConfigMenu({
  option,
  theme,
  disabled,
  onConfigure,
}: {
  option: AgentConfigOption;
  theme: Theme;
  disabled: boolean;
  onConfigure: (id: string, value: string) => void;
}): React.ReactNode {
  const menu = useMenuControl();
  const overlay = useRootOverlay();
  const ref = useRef<BoxRenderable | null>(null);
  const open = menu.openMenuId === `agent-config:${option.id}`;
  const anchor = useFrameMeasure(
    () => ({ x: ref.current?.x ?? 0, y: ref.current?.y ?? 0 }),
    (a, b) => a.x === b.x && a.y === b.y,
    { x: 0, y: 0 },
    open,
  );

  useEffect(() => {
    if (!open) return;
    overlay.setOverlay(
      "agent-config",
      <box
        onMouseUp={menu.closeMenu}
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}
      >
        <box
          onMouseUp={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            left: Math.max(0, anchor.x - 20),
            top: Math.max(0, anchor.y - Math.min(10, option.options.length) - 2),
            width: 32,
            border: true,
            borderColor: theme.border,
            backgroundColor: theme.elevated,
            flexDirection: "column",
          }}
        >
          <scrollbox style={{ height: Math.min(10, option.options.length) }}>
            {option.options.map((choice) => (
              <text
                key={choice.value}
                fg={choice.value === option.currentValue ? theme.accent : theme.text}
                onMouseUp={() => {
                  onConfigure(option.id, choice.value);
                  menu.closeMenu();
                }}
              >{`${choice.value === option.currentValue ? "✓ " : "  "}${choice.name}`}</text>
            ))}
          </scrollbox>
        </box>
      </box>,
    );

    return () => overlay.clearOverlay("agent-config");
  }, [open, anchor, option, theme, menu, overlay, onConfigure]);

  return (
    <box
      ref={ref}
      onMouseUp={disabled ? undefined : () => menu.toggleMenu(`agent-config:${option.id}`)}
    >
      <text fg={disabled ? theme.textDim : theme.textMuted}>
        {option.options.find((choice) => choice.value === option.currentValue)?.name ??
          option.currentValue}
      </text>
    </box>
  );
}

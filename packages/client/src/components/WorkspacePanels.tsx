import React, { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { ExtensionUIContext } from "@cueloop/extension-api/client";
import type { ClientExtensionRegistry } from "../client-extension-registry";
import type { Theme } from "../theme";
import type { ProjectPanelMode } from "./AppShell";
import { ExtensionZone, useClientExtensionSnapshot, visibleWorkspaceViews } from "./ExtensionZone";
import { FileTab, PanelColumn } from "./PanelColumn";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

/** The existing right pane owns built-in modes and selectable extension views. */
export function WorkspacePanels(props: {
  width: number;
  projectMode: ProjectPanelMode;
  projectPanel: React.ReactNode;
  onToggleChanges: () => void;
  onToggleProject: () => void;
  onToggleRight: () => void;
  onFocus: () => void;
  focused?: boolean;
  registry: ClientExtensionRegistry;
  context: ExtensionUIContext;
  theme: Theme;
  onExtensionError?: (message: string) => void;
}): React.ReactNode {
  const { registry, context, theme } = props;
  const snapshot = useClientExtensionSnapshot(registry);
  const views = visibleWorkspaceViews(snapshot, context);
  const [selectedView, setSelectedView] = useState<(typeof views)[number] | null>(null);
  const selected = views.find(
    ({ key, value }) => key === selectedView?.key && value === selectedView.value,
  );

  const showBuiltIn = (toggle: () => void): void => {
    setSelectedView(null);
    toggle();
  };

  useKeyboard((key) => {
    if (!props.focused || (key.name !== "[" && key.name !== "]")) return;
    const choices = [null, ...views];
    const current = selected ? views.indexOf(selected) + 1 : 0;
    const step = key.name === "]" ? 1 : -1;

    setSelectedView(choices[(current + step + choices.length) % choices.length] ?? null);
  });

  const toggles = (
    <box style={{ flexDirection: "row", flexShrink: 0, alignItems: "center" }}>
      <IconButton
        glyph="changes"
        active={!selected && props.projectMode === "changes"}
        onPress={() => showBuiltIn(props.onToggleChanges)}
        marginRight={2}
        theme={theme}
      />
      <IconButton
        glyph="project"
        active={!selected && props.projectMode === "tree"}
        onPress={() => showBuiltIn(props.onToggleProject)}
        marginRight={2}
        theme={theme}
      />
      <IconButton
        glyph={NERD.sidebarRight}
        onPress={props.onToggleRight}
        tip="Toggle Sidebar"
        theme={theme}
      />
    </box>
  );

  return (
    <PanelColumn
      width={props.width}
      border="left"
      header={
        views.length > 0 ? (
          <box style={{ flexDirection: "row", minWidth: 0 }}>
            {views.map(({ key, value }) => (
              <box key={key} onMouseUp={() => setSelectedView({ key, value })}>
                <FileTab label={value.title} active={key === selected?.key} theme={theme} />
              </box>
            ))}
          </box>
        ) : null
      }
      headerRight={toggles}
      onFocus={props.onFocus}
      theme={theme}
    >
      {selected ? (
        <ExtensionZone
          zone="workspace.panels"
          registry={registry}
          context={context}
          selectedViewId={selected.key}
          onError={props.onExtensionError}
        />
      ) : (
        props.projectPanel
      )}
    </PanelColumn>
  );
}

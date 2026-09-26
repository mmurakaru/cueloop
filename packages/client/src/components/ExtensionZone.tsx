import React, { useSyncExternalStore } from "react";
import type { ExtensionUIContext } from "@cueloop/extension-api/client";
import type {
  ClientExtensionRegistry,
  ClientExtensionSnapshot,
} from "../client-extension-registry";
import { useComponentTheme } from "./theme-context";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";

/** Subscribe to the client extension registry without coupling extensions to React state. */
export function useClientExtensionSnapshot(
  registry: ClientExtensionRegistry,
): ClientExtensionSnapshot {
  return useSyncExternalStore(registry.subscribe, registry.snapshot, registry.snapshot);
}

/** Views eligible for the current workspace, in package registration order. */
export function visibleWorkspaceViews(
  snapshot: ClientExtensionSnapshot,
  context: ExtensionUIContext,
): ClientExtensionSnapshot["views"] {
  return snapshot.views.filter(({ value }) => isVisible(value.when, context));
}

function isVisible(
  when: ((context: ExtensionUIContext) => boolean) | undefined,
  context: ExtensionUIContext,
): boolean {
  if (!when) return true;

  try {
    return when(context);
  } catch (error) {
    console.error("Client extension visibility failed", error);

    return false;
  }
}

class ExtensionRenderBoundary extends React.Component<
  { children: React.ReactNode; onError?: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error("Client extension rendering failed", error);
    this.props.onError?.(`Extension rendering failed: ${error.message}`);
  }

  render(): React.ReactNode {
    if (this.state.failed) return <text>Extension failed</text>;

    return this.props.children;
  }
}

/** Render host-framed sections, host buttons, or the selected workspace view. */
export function ExtensionZone(props: {
  zone: "threads.sidebar" | "thread.header" | "workspace.panels";
  registry: ClientExtensionRegistry;
  context: ExtensionUIContext;
  selectedViewId?: string | null;
  onError?: (message: string) => void;
}): React.ReactNode {
  const { zone, registry, context, selectedViewId, onError } = props;
  const snapshot = useClientExtensionSnapshot(registry);
  const theme = useComponentTheme();

  if (zone === "threads.sidebar") {
    return snapshot.sections
      .filter(({ value }) => isVisible(value.when, context))
      .map(({ key, value }) => (
        <box key={key} style={{ flexDirection: "column", maxHeight: 8, flexShrink: 0 }}>
          <text fg={theme.textDim}>{value.title}</text>
          <ExtensionRenderBoundary onError={onError}>
            {React.createElement(value.Component, { context })}
          </ExtensionRenderBoundary>
        </box>
      ));
  }

  if (zone === "thread.header") {
    return snapshot.actions
      .filter(({ value }) => isVisible(value.when, context))
      .map(({ key, value }) => (
        <IconButton
          key={key}
          glyph={value.glyph ?? NERD.kebab}
          tip={value.label}
          onPress={() => {
            try {
              void Promise.resolve(value.onPress(context)).catch((error) => {
                console.error(`Client extension action failed: ${key}`, error);
                onError?.(`Extension action failed: ${value.label}`);
              });
            } catch (error) {
              console.error(`Client extension action failed: ${key}`, error);
              onError?.(`Extension action failed: ${value.label}`);
            }
          }}
          marginRight={1}
          theme={theme}
        />
      ));
  }

  const selected = snapshot.views.find(
    ({ key, value }) => key === selectedViewId && isVisible(value.when, context),
  );

  return selected ? (
    <ExtensionRenderBoundary key={selected.key} onError={onError}>
      {React.createElement(selected.value.Component, { context })}
    </ExtensionRenderBoundary>
  ) : null;
}

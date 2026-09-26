import type * as React from "react";
import type { ComponentType } from "react";

export type ExtensionComponent = ComponentType<{ context: ExtensionUIContext }>;

/** The client supplies current workspace and Thread identity to extension UI. */
export interface ExtensionUIContext {
  workspace: string | null;
  threadId: string | null;
}

/** A host-owned registration that can be removed on extension reload. */
export interface ExtensionUIDisposable {
  dispose(): void;
}

/** A titled, height-bounded section below the scrolling Threads list. */
export interface ThreadSidebarSection {
  id: string;
  zone: "threads.sidebar";
  title: string;
  Component: ExtensionComponent;
  when?: (context: ExtensionUIContext) => boolean;
}

/** An action rendered with the Thread header's existing button primitive. */
export interface ThreadHeaderAction {
  id: string;
  zone: "thread.header";
  label: string;
  glyph?: string;
  onPress(context: ExtensionUIContext): void | Promise<void>;
  when?: (context: ExtensionUIContext) => boolean;
}

/** A selectable full-height view inside the workspace's existing right pane. */
export interface WorkspacePanelView {
  id: string;
  zone: "workspace.panels";
  title: string;
  Component: ExtensionComponent;
  when?: (context: ExtensionUIContext) => boolean;
}

/** Client-only registration API; server and VCS capabilities use the daemon entry point. */
export interface ClientExtensionAPI {
  /** Use this React instance for hooks so components share the host renderer's dispatcher. */
  react: typeof React;
  /** Host keyboard hook; package-local OpenTUI hooks do not share the host context. */
  useKeyboard: typeof import("@opentui/react").useKeyboard;
  registerSection(section: ThreadSidebarSection): ExtensionUIDisposable;
  registerAction(action: ThreadHeaderAction): ExtensionUIDisposable;
  registerView(view: WorkspacePanelView): ExtensionUIDisposable;
}

/** Client packages export one factory that registers their UI contributions. */
export type ClientExtensionFactory = (api: ClientExtensionAPI) => void | Promise<void>;

/**
 * The single typed extension contract. This module is import-free
 * beyond the schema: whatever a declaration file can reach gets published,
 * so the contract stays self-contained.
 *
 * An extension is a factory:
 *   export default (cueloop: ExtensionAPI) => { cueloop.registerCommand(...) }
 * Registration is data written into a per-extension record; action methods
 * are late-bound by the host. No import-time side effects.
 */

import type { Annotation, ReviewSession, VerdictKind } from "@cueloop/schema";

/** A renderable line: styled runs the host paints into the terminal grid. */
export interface UiRun {
  text: string;
  fg?: string;
  bg?: string;
}

export type UiLine = UiRun[];

/** Renderers project an artifact type into lines at a given width. */
export type ArtifactRenderer = (artifact: { content: string; meta: Record<string, unknown> }, width: number) => UiLine[];

export interface CommandContext {
  session: ReviewSession | null;
  annotate(annotation: Omit<Annotation, "createdAt">): Promise<void>;
  resolve(verdict: VerdictKind, summary: string): Promise<void>;
  notify(message: string): void;
}

export interface CommandRegistration {
  description: string;
  handler(context: CommandContext, args: string): void | Promise<void>;
}

export interface KeybindingRegistration {
  /** Action name; binds through the same [keys] config as built-ins. */
  action: string;
  defaultKeys: string[];
  handler(context: CommandContext): void | Promise<void>;
}

/** Exporters ship resolved sessions somewhere (notes vaults, forges). */
export type Exporter = (session: ReviewSession) => Promise<{ success: boolean; path?: string; error?: string }>;

export interface ExtensionAPI {
  /** Renderers for artifact types; built-ins register through this too. */
  registerRenderer(artifactType: string, renderer: ArtifactRenderer): void;
  registerCommand(name: string, registration: CommandRegistration): void;
  registerKeybinding(registration: KeybindingRegistration): void;
  registerExporter(name: string, exporter: Exporter): void;
  /** Observe session lifecycle; fold semantics: observers never cancel. */
  on(event: "session.created" | "session.resolved" | "session.updated", handler: (session: ReviewSession) => void): void;
}

export type ExtensionFactory = (cueloop: ExtensionAPI) => void | Promise<void>;

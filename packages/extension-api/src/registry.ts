/**
 * The contribution registry: registrations are plain data, attributed
 * per extension. Reserved app keybindings are rejected at registration so a
 * broken extension cannot shadow core grammar.
 */

import type {
  ArtifactRenderer,
  CommandRegistration,
  Exporter,
  ExtensionAPI,
  ExtensionFactory,
  KeybindingRegistration,
} from "./types";
import type { ReviewSession } from "@cueloop/schema";

const RESERVED_KEYS = new Set(["j", "k", "g", "G", "v", "c", "s", "x", "e", "n", "p", "q", "return", "escape", "backspace"]);

export interface ExtensionRecord {
  name: string;
  renderers: Map<string, ArtifactRenderer>;
  commands: Map<string, CommandRegistration>;
  keybindings: KeybindingRegistration[];
  exporters: Map<string, Exporter>;
  listeners: Map<string, ((session: ReviewSession) => void)[]>;
  errors: string[];
}

export class Registry {
  readonly extensions: ExtensionRecord[] = [];

  /** Run one extension factory, capturing its registrations. */
  async load(name: string, factory: ExtensionFactory): Promise<ExtensionRecord> {
    const record: ExtensionRecord = {
      name,
      renderers: new Map(),
      commands: new Map(),
      keybindings: [],
      exporters: new Map(),
      listeners: new Map(),
      errors: [],
    };
    const api: ExtensionAPI = {
      registerRenderer(type, renderer) {
        record.renderers.set(type, renderer);
      },
      registerCommand(commandName, registration) {
        record.commands.set(commandName, registration);
      },
      registerKeybinding(registration) {
        const clash = registration.defaultKeys.find((key) => RESERVED_KEYS.has(key));
        if (clash) {
          record.errors.push(`keybinding "${registration.action}" rejected: "${clash}" is reserved`);
          return;
        }
        record.keybindings.push(registration);
      },
      registerExporter(exporterName, exporter) {
        record.exporters.set(exporterName, exporter);
      },
      on(event, handler) {
        const list = record.listeners.get(event) ?? [];
        list.push(handler);
        record.listeners.set(event, list);
      },
    };
    try {
      await factory(api);
    } catch (err) {
      // one broken extension never takes the app down
      record.errors.push(err instanceof Error ? err.message : String(err));
    }
    this.extensions.push(record);
    return record;
  }

  /** First-registered wins for renderers/commands; built-ins load first. */
  rendererFor(artifactType: string): ArtifactRenderer | undefined {
    for (const extension of this.extensions) {
      const renderer = extension.renderers.get(artifactType);
      if (renderer) return renderer;
    }
    return undefined;
  }

  commandFor(name: string): { extension: string; registration: CommandRegistration } | undefined {
    for (const extension of this.extensions) {
      const command = extension.commands.get(name);
      if (command) return { extension: extension.name, registration: command };
    }
    return undefined;
  }

  emit(event: string, session: ReviewSession): void {
    for (const extension of this.extensions) {
      for (const handler of extension.listeners.get(event) ?? []) {
        try {
          handler(session);
        } catch {
          // observers never cancel and never crash the host
        }
      }
    }
  }
}

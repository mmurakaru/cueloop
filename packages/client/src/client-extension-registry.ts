import { pathToFileURL } from "node:url";
import * as React from "react";
import { useKeyboard } from "@opentui/react";
import * as v from "valibot";
import { discoverInstalledExtensionPackages } from "@cueloop/extension-api/installed-packages";
import type {
  ClientExtensionAPI,
  ClientExtensionFactory,
  ExtensionUIDisposable,
  ThreadHeaderAction,
  ThreadSidebarSection,
  WorkspacePanelView,
} from "@cueloop/extension-api/client";

interface OwnedContribution<T> {
  key: string;
  value: T;
}

/** A stable snapshot lets React subscribe without rebuilding contribution arrays on every render. */
export interface ClientExtensionSnapshot {
  sections: readonly OwnedContribution<ThreadSidebarSection>[];
  actions: readonly OwnedContribution<ThreadHeaderAction>[];
  views: readonly OwnedContribution<WorkspacePanelView>[];
  lastError: string | null;
}

/** Client extension registrations are isolated by package and disposed on load failure. */
export class ClientExtensionRegistry {
  private readonly listeners = new Set<() => void>();
  private readonly sections = new Map<string, ThreadSidebarSection>();
  private readonly actions = new Map<string, ThreadHeaderAction>();
  private readonly views = new Map<string, WorkspacePanelView>();
  private current: ClientExtensionSnapshot = {
    sections: [],
    actions: [],
    views: [],
    lastError: null,
  };
  readonly errors: string[] = [];

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): ClientExtensionSnapshot => this.current;

  private changed(): void {
    this.current = {
      sections: [...this.sections].map(([key, value]) => ({ key, value })),
      actions: [...this.actions].map(([key, value]) => ({ key, value })),
      views: [...this.views].map(([key, value]) => ({ key, value })),
      lastError: this.errors.at(-1) ?? null,
    };
    for (const listener of this.listeners) listener();
  }

  private add<T extends { id: string; zone: string }>(
    map: Map<string, T>,
    owner: string,
    contribution: T,
    zone: string,
  ): ExtensionUIDisposable {
    if (!/^[a-z][a-z0-9-]*$/.test(contribution.id))
      throw new Error(`Client extension invalid contribution ID: ${contribution.id}`);
    if (contribution.zone !== zone)
      throw new Error(`Client extension ${owner}:${contribution.id} must use zone ${zone}`);
    const key = `${owner}:${contribution.id}`;

    if (this.sections.has(key) || this.actions.has(key) || this.views.has(key))
      throw new Error(`Client extension duplicate contribution: ${key}`);
    map.set(key, contribution);
    this.changed();

    return {
      dispose: () => {
        if (map.get(key) === contribution) {
          map.delete(key);
          this.changed();
        }
      },
    };
  }

  reportError(message: string): void {
    this.errors.push(message);
    this.changed();
  }

  /** Load one client factory and remove all of its registrations if it fails. */
  async load(owner: string, factory: ClientExtensionFactory): Promise<ExtensionUIDisposable> {
    const registrations: ExtensionUIDisposable[] = [];
    const api: ClientExtensionAPI = {
      react: React,
      useKeyboard,
      registerSection: (section) => {
        const registration = this.add(this.sections, owner, section, "threads.sidebar");

        registrations.push(registration);

        return registration;
      },
      registerAction: (action) => {
        const registration = this.add(this.actions, owner, action, "thread.header");

        registrations.push(registration);

        return registration;
      },
      registerView: (view) => {
        const registration = this.add(this.views, owner, view, "workspace.panels");

        registrations.push(registration);

        return registration;
      },
    };

    try {
      await factory(api);
    } catch (error) {
      for (const registration of registrations) registration.dispose();
      this.reportError(`Client extension ${owner}: ${String(error)}`);
    }

    return {
      dispose: () => {
        for (const registration of registrations) registration.dispose();
      },
    };
  }
}

/** Import only the client entry points of installed extension packages. */
export async function loadInstalledClientExtensions(
  registry: ClientExtensionRegistry,
  installRoot?: string,
): Promise<void> {
  const discovery = discoverInstalledExtensionPackages(installRoot);

  for (const error of discovery.errors) registry.reportError(error);
  for (const extension of discovery.packages) {
    if (!extension.clientEntry) continue;

    try {
      const module: unknown = await import(pathToFileURL(extension.clientEntry).href);
      const parsed = v.safeParse(v.object({ default: v.function() }), module);

      if (!parsed.success) throw new Error("client entry point must export a default factory");
      await registry.load(extension.name, async (api) => {
        await parsed.output.default(api);
      });
    } catch (error) {
      registry.reportError(`Client extension ${extension.name}: ${String(error)}`);
    }
  }
}

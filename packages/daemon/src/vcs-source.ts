/** Select and run VCS diff adapters without exposing daemon state to extensions. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { VcsAdapter, VcsDiffSnapshot, ExtensionFactory } from "@cueloop/extension-api";
import { Registry } from "@cueloop/extension-api";
import { parse as parseToml } from "smol-toml";
import * as v from "valibot";
import { jjVcsAdapter } from "./jj-working-tree";
import { workingChangeList, workingTreeDiff } from "./working-tree";
import { listProjectFiles } from "./project-files";
import { DiffFileContentsSchema } from "./validate";

const VcsDiffSnapshotSchema = v.object({
  patch: v.string(),
  files: v.array(DiffFileContentsSchema),
  source: v.optional(
    v.object({
      changeId: v.optional(v.pipe(v.string(), v.minLength(1))),
      revisionId: v.pipe(v.string(), v.minLength(1)),
    }),
  ),
});

async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const child = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(child.stdout).text();

    return (await child.exited) === 0 ? output.trim() : null;
  } catch {
    return null;
  }
}

/** The Git adapter retains the established HEAD-to-working-tree capture path. */
export const gitVcsAdapter: VcsAdapter = {
  apiVersion: 1,
  id: "git",
  detect: gitRoot,
  captureWorkingDiff: workingTreeDiff,
  listChanges: workingChangeList,
  listFiles: async (root) => listProjectFiles(root),
};

interface VcsConfig {
  provider: string;
  extensions: string[];
}

const VcsConfigSchema = v.object({
  vcs: v.optional(
    v.object({
      provider: v.optional(v.string()),
      extensions: v.optional(v.array(v.string())),
    }),
  ),
});

const ExtensionModuleSchema = v.object({ default: v.function() });

function readVcsToml(path: string): Partial<VcsConfig> {
  if (!existsSync(path)) return {};
  try {
    const parsed = v.safeParse(VcsConfigSchema, parseToml(readFileSync(path, "utf8")));

    return parsed.success ? (parsed.output.vcs ?? {}) : {};
  } catch {
    return {};
  }
}

/** A selected adapter and the checkout root it owns. */
export interface SelectedVcsSource {
  adapter: VcsAdapter;
  repoRoot: string;
}

/** VCS extensions load only from personal config; repo config may select an installed adapter. */
export class VcsSourceManager {
  private readonly registry = new Registry();
  private loaded: Promise<void> | null = null;
  readonly extensionErrors: string[] = [];

  constructor(
    private readonly userConfigPath = process.env.CUELOOP_CONFIG ??
      join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cueloop", "config.toml"),
  ) {}

  private async adapters(): Promise<VcsAdapter[]> {
    if (!this.loaded) this.loaded = this.loadExtensions();
    await this.loaded;

    return [
      gitVcsAdapter,
      jjVcsAdapter,
      ...this.registry.extensions.flatMap((record) => [...record.vcsAdapters.values()]),
    ];
  }

  private async loadExtensions(): Promise<void> {
    const paths = readVcsToml(this.userConfigPath).extensions ?? [];

    for (const path of paths) {
      const absolute = isAbsolute(path) ? path : resolve(dirname(this.userConfigPath), path);
      try {
        const module: unknown = await import(pathToFileURL(absolute).href);
        const parsed = v.safeParse(ExtensionModuleSchema, module);

        if (!parsed.success) throw new Error("VCS extension must export a default factory");
        const factory: ExtensionFactory = async (api) => {
          await parsed.output.default(api);
        };
        const record = await this.registry.load(absolute, factory);

        for (const error of record.errors)
          this.extensionErrors.push(`VCS extension ${absolute}: ${error}`);
      } catch (error) {
        this.extensionErrors.push(`VCS extension load failed: ${absolute}: ${String(error)}`);
      }
    }
  }

  /** Auto chooses the nearest checkout, preferring jj over Git at one root. */
  async select(cwd: string, pinnedProvider?: string): Promise<SelectedVcsSource> {
    const adapters = await this.adapters();
    const detected = (
      await Promise.all(
        adapters.map(async (adapter) => ({
          adapter,
          repoRoot: await adapter.detect(cwd),
        })),
      )
    ).filter((item): item is SelectedVcsSource => item.repoRoot !== null);
    const nearest = detected.toSorted((a, b) => b.repoRoot.length - a.repoRoot.length)[0];
    const repoConfig = nearest
      ? readVcsToml(join(nearest.repoRoot, ".cueloop", "config.toml"))
      : {};
    const requested =
      pinnedProvider ??
      process.env.CUELOOP_VCS ??
      repoConfig.provider ??
      readVcsToml(this.userConfigPath).provider ??
      "auto";

    if (requested !== "auto") {
      const selected = detected.find(({ adapter }) => adapter.id === requested);

      if (!selected && requested === "git" && detected.length === 0)
        return { adapter: gitVcsAdapter, repoRoot: cwd };
      if (!selected)
        throw new Error(
          `VCS adapter unavailable: ${requested}${this.extensionErrors.length > 0 ? ` (${this.extensionErrors.join("; ")})` : ""}`,
        );

      return selected;
    }
    detected.sort((a, b) => {
      const rootDistance = b.repoRoot.length - a.repoRoot.length;

      if (rootDistance !== 0) return rootDistance;

      return (b.adapter.id === "jj" ? 1 : 0) - (a.adapter.id === "jj" ? 1 : 0);
    });
    const selected = detected[0];

    if (!selected) return { adapter: gitVcsAdapter, repoRoot: cwd };

    return selected;
  }

  /** Capture with the selected source and preserve its identity alongside the diff. */
  async capture(cwd: string, pinnedProvider?: string): Promise<VcsDiffSnapshot & { vcs: string }> {
    const selected = await this.select(cwd, pinnedProvider);
    const snapshot = v.parse(
      VcsDiffSnapshotSchema,
      await selected.adapter.captureWorkingDiff(selected.repoRoot),
    );

    return { ...snapshot, vcs: selected.adapter.id };
  }

  /** Resolve one logical change; ambiguous or unsupported identities fail explicitly. */
  async captureChange(
    cwd: string,
    provider: string,
    changeId: string,
  ): Promise<VcsDiffSnapshot & { vcs: string }> {
    const selected = await this.select(cwd, provider);

    if (!selected.adapter.captureChange)
      throw new Error(`VCS adapter ${provider} cannot follow a change ID`);
    const snapshot = v.parse(
      VcsDiffSnapshotSchema,
      await selected.adapter.captureChange(selected.repoRoot, changeId),
    );

    return { ...snapshot, vcs: selected.adapter.id };
  }
}

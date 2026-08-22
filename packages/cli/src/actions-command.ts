/**
 * `cueloop actions list` - print the quick-action vocabulary (the same presets a
 * human picks in the marker popover) so a review-side agent can reference one by
 * name or index via `session annotate --action`. Output is JSON on stdout.
 */

import { loadConfig } from "@cueloop/client/config";

export function actionsCommand(argv: string[]): number {
  const verb = argv[0] ?? "list";
  if (verb !== "list") {
    console.error("usage: cueloop actions list");
    return 2;
  }
  const actions = loadConfig({ repoRoot: process.cwd() }).actions;
  console.log(
    JSON.stringify(
      actions.map((action, index) => ({ index: index + 1, ...action })),
      null,
      2,
    ),
  );
  return 0;
}

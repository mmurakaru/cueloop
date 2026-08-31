/** Tiny flag parser: --key value, --key=value, boolean --flag, positionals. */

import * as v from "valibot";

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;

    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const equalsIndex = argument.indexOf("=");

    if (equalsIndex !== -1) {
      flags[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
    } else {
      const key = argument.slice(2);
      const next = argv[i + 1];

      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  return { positional, flags };
}

export function stringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const result = v.safeParse(v.string(), flags[key]);

  return result.success ? result.output : undefined;
}

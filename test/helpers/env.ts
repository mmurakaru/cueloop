import { isolatedUserConfigPath } from "../../packages/client/src/test-support";

/**
 * Environment overrides that make a spawned test subprocess hermetic against the
 * developer's own tooling session. Without them, a suite run from a supported
 * terminal can open real tabs during `cueloop session create` or hook tests.
 *
 * Spread AFTER `...process.env` so it wins over the inherited ambient, and BEFORE
 * any per-test env so a test can opt back in explicitly.
 */
export const HERMETIC_TERMINAL_ENV = {
  HERDR_ENV: "",
  HERDR_PANE_ID: "",
  HERDR_TAB_ID: "",
  HERDR_WORKSPACE_ID: "",
  HERDR_BIN_PATH: "",
  TERM_PROGRAM: "",
  GHOSTTY_RESOURCES_DIR: "",
} as const;

/**
 * The environment for a cueloop subprocess under test: the ambient env with the
 * terminal integration neutralized, CUELOOP_HOME pointed at the test home, the user
 * config isolated into that home, and no daemon idle exit. `overrides` win.
 */
export function hermeticCueloopEnvironment(
  home: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }

  return Object.assign(
    environment,
    HERMETIC_TERMINAL_ENV,
    {
      CUELOOP_HOME: home,
      CUELOOP_CONFIG: isolatedUserConfigPath(home),
      CUELOOP_IDLE_EXIT_MS: "0",
    },
    overrides,
  );
}

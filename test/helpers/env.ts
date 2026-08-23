/**
 * Environment overrides that make a spawned test subprocess hermetic against the
 * developer's own tooling session. Without them, a suite run from inside a herdr
 * pane inherits HERDR_ENV=1, so every `cueloop session create` and every hook
 * spawn calls the real `herdr tab create` and leaks tabs into the live session.
 * Emptying HERDR_ENV disables the whole integration (see `detectHerdr`), the same
 * way tests empty CLAUDE_CODE_MESSAGING_SOCKET to disable the ambient inbox.
 *
 * Spread AFTER `...process.env` so it wins over the inherited ambient, and BEFORE
 * any per-test env so a test can still opt back in by setting HERDR_ENV itself.
 */
export const HERMETIC_HERDR_ENV = {
  HERDR_ENV: "",
  HERDR_PANE_ID: "",
  HERDR_BIN_PATH: "",
} as const;

// Test preload (bunfig.toml [test].preload): runs once per test process before
// any test. It neutralizes ambient Herdr and Ghostty so in-process adapter
// tests cannot open real terminal surfaces. Subprocesses use the same overrides
// from test/helpers/env.ts; intentional integration tests opt back in.
import { HERMETIC_TERMINAL_ENV } from "./helpers/env";

Object.assign(process.env, HERMETIC_TERMINAL_ENV);

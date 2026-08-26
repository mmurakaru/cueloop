// Test preload (bunfig.toml [test].preload): runs once per test process before
// any test. It neutralizes the developer's ambient herdr session in process.env
// so IN-PROCESS code paths - e.g. runHook -> openHerdrPaneForReview, which reads
// process.env directly - never spawn a real `herdr tab create` and leak tabs
// into the live session. Subprocess spawns are covered separately by
// HERMETIC_HERDR_ENV (test/helpers/env.ts); this closes the in-process gap.
// Tests that exercise herdr on purpose still set HERDR_ENV + a stub HERDR_BIN_PATH
// themselves, which overrides this for the duration of that test.
import { HERMETIC_HERDR_ENV } from "./helpers/env";

Object.assign(process.env, HERMETIC_HERDR_ENV);

# Harness lifecycle proof experiment

Question: can checked laws protect the lifecycle shared by replaceable Thread agent harnesses?

The experiment models the daemon's idle, starting, running, and stopping phases. Starting carries the cancellation flag; readiness consumes it. Permissions, sockets, file writes, transcript rendering, and crashes are outside this small model.

Two proposed laws are in `LAWS.bend` for human review:

- Cancelling initialization and receiving readiness leaves the lifecycle able to start another turn, for either initial cancellation value.
- Receiving completion after Stop leaves every modeled phase able to start another turn.

`PROOF.bend` proves those laws by constructor cases. The daemon uses the equivalent TypeScript reducer in `packages/daemon/src/agent-turn.ts`.

Run:

```sh
bun run check:agent-laws
```

This optional command requires [Bend 2.0.35](https://bend-lang.com/) and, for its first independent verdict, Lean 4.34.0 on PATH or a prebuilt checker supplied through `BENDTT`. `BEND_BIN` can point to an isolated Bend executable. It is not required for `dev:watch`, normal tests, or CI.

The check does three things:

1. Runs the independent proof verdict and requires `ALL PROOFS CHECK`, rather than trusting an exit code alone.
2. Compiles the model to temporary JavaScript and compares all 20 distinct state/event transitions with the actual daemon reducer, repeated across 27,300 steps over traces up to six events from all five state values.
3. Copies the model and unchanged laws into a temporary directory, restores the stale initialization-cancellation bug, and requires the proof to reject it.

Verified result: both laws passed the independent verdict, generated JavaScript matched the daemon reducer, and the mutation was rejected. Temporary generated code is removed after the check.

This proves the Bend model's stated laws. The TypeScript comparison supplies executable evidence that the small reducer agrees; it is not a formal proof of the whole TypeScript daemon. Keep socket, real-harness, permission, and terminal tests.

The [official language guide](https://github.com/bendlang/bend/blob/v2.0.35/guide/GUIDE.md) documents the proof gate, JavaScript output, and the trusted translation boundary. The useful result here is a reviewable specification and a check that rejects a known bug. Adopting Bend in the application runtime remains a separate decision.

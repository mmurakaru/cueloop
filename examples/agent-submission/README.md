# Agent behavior laws

Bend checks the submission and input models before comparing generated JavaScript with the TypeScript reducers used by the daemon and client. Ten laws cover prompt/comment input routing, empty input, immutable accepted input, and locking through queueing, completion, failure, and retry. The companion [lifecycle model](../agent-lifecycle) proves two cancellation recovery laws.

```sh
CUELOOP_BEND_VERDICT=0 bun run check:agent-laws
```

Use Bend 2.0.35. The default command requests an independent Lean verdict; it requires the toolchain described by `bend guide`. CI sets `CUELOOP_BEND_VERDICT=0` to use Bend's proof checker without downloading Lean. Both modes compare generated JavaScript with 140,400 TypeScript transitions and reject three deliberately broken models.

These are proofs of the pure models. The comparison checks agreement with our reducers over bounded traces; it does not prove transport, rendering, persistence, or the entire TypeScript application. Socket, component, and PTY tests cover those boundaries. Bend is a development check, with no application runtime dependency.

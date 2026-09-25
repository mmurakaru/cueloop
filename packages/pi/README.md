# cueloop for pi

```bash
pi install npm:@cueloop/pi
```

The package opens cueloop Threads in the configured terminal surface and delivers Messages back into the active pi conversation.

Use `/cueloop:plan`, `/cueloop:diff`, `/cueloop:review`, `/cueloop:reply`, `/cueloop:prototype`, or `/cueloop:refine` to start a workflow. Each command loads the corresponding shared cueloop skill. The review skill uses the CLI to attach line anchored findings; the other workflow skills use `open_thread` when available.

Pi reports available package updates on startup. If cueloop reports a version mismatch, run `cueloop restart`, then update the older component if needed: `cueloop update` or `pi update npm:@cueloop/pi`.

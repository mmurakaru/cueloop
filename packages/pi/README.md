# cueloop for pi

Open cueloop Threads from pi and return review Messages to the active conversation.

## Install

```sh
pi install npm:@cueloop/pi
```

## Use

```text
/cueloop:plan
/cueloop:diff
/cueloop:pair
/cueloop:review
/cueloop:reply
/cueloop:prototype
/cueloop:refine
```

Each command loads a shared cueloop skill.
Review attaches findings to diff lines through the CLI.
Pair follows live workbench events.
Other workflows use `open_thread` when available.
Threads open in the configured terminal.

> [!NOTE]
> Pi checks for package updates at startup.
> If versions differ, run `cueloop restart`, then update the older component:

```sh
cueloop update
pi update npm:@cueloop/pi
```

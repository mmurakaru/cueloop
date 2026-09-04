---
"@cueloop/daemon": minor
"cueloop": minor
---

Every discussion action has its primitive.

- `cueloop session annotate --reply-to <comment-id>` replies on the root comment's anchor; `--selector <css>` anchors a prototype comment to an element.
- `cueloop session remove` removes a comment; a non-owner names the author it acts as and removes only that author's.
- `cueloop session name-self` registers the display name of an author.
- `cueloop session events` follows a session as one JSON line per change; every event names the history entry it appended.

---
"@cueloop/client": minor
---

Dialogs no longer paint a dim backdrop or a surface fill - an open dialog
floats as a bordered frame and the session stays visible behind it. Set
`[theme] backdrop` to a colour to restore the dimmed layer.

Theme tokens now use full names, and `[theme]` config keys follow suit:
`bg` is `background`, `cursorBg` is `cursorBackground`, `markCommentBg` is
`markCommentBackground`, `markSuggestionBg` is `markSuggestionBackground`,
`insFg` is `insertedForeground`, `delFg` is `deletedForeground`. Update any
overrides using the old keys.

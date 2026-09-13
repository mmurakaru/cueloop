---
"cueloop": minor
---

Make the `prototype` review a component design doc by default. `cueloop prototype <file.md>` opens a Markdown proposal - the component's prop API, how it composes from existing primitives, and the callstack it sits in - reviewed as text, so annotations anchor to lines the same way a plan or diff does. The prototype skill prompts the agent to author those three sections.

Rendering an HTML mockup as terminal pixels is now an opt-in experimental mode (`[experimental] prototype_pixels`); its renderer is code-split so none of the pixel/browser path loads into the runtime unless the flag is on. A closed right region now moves its reopen toggle into the header instead of leaving an empty gutter, and the landing page shots are refreshed to the current terminal UI.

Scrollbars are now overlays across every view: the bar appears while a surface is scrolling and hides once it goes idle, instead of sitting permanently on any overflowing pane. Reviewer decisions are no longer called "verdicts" in the copy.

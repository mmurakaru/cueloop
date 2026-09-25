import { describe, expect, test } from "bun:test";
import { renderAgentMarkdownDocument } from "../src/agent/mdx-markdown";
import { markdownRouteForDocsFile } from "./build-agent-markdown";

describe("renderAgentMarkdownDocument", () => {
  test("removes MDX-only syntax and keeps the public copy", () => {
    const markdown = renderAgentMarkdownDocument(`---
title: Install cueloop
lede: Install the CLI and connect an agent.
---

import InstallTabs from "./InstallTabs";

<InstallTabs client:load />

## Next step

Open a Thread.
`);

    expect(markdown).toStartWith("# Install cueloop\n\nInstall the CLI");
    expect(markdown).toContain("curl -fsSL https://cueloop.dev/install.sh | sh");
    expect(markdown).not.toContain("frontmatter");
    expect(markdown).not.toContain("import InstallTabs");
    expect(markdown).not.toContain("<InstallTabs");
  });

  test("preserves fenced and inline code exactly", () => {
    const markdown = renderAgentMarkdownDocument(`---
title: Code examples
lede: Copy these examples as written.
---

Use \`<code>literal</code>\` in a sentence.

\`\`\`tsx
import Example from "./Example";

<div><code>literal</code></div>
\`\`\`
`);

    expect(markdown).toContain("Use `<code>literal</code>` in a sentence.");
    expect(markdown).toContain(`\`\`\`tsx
import Example from "./Example";

<div><code>literal</code></div>
\`\`\``);
  });

  test("removes the email-obfuscation wrapper around SSH examples", () => {
    const markdown = renderAgentMarkdownDocument(`---
title: Share a Thread
---

import EmailObfuscationEscape from "./EmailObfuscationEscape.astro";

<EmailObfuscationEscape>

\`\`\`bash
ssh p_7f3k9x2q@cueloop.dev
\`\`\`

</EmailObfuscationEscape>
`);

    expect(markdown).toContain("ssh p_7f3k9x2q@cueloop.dev");
    expect(markdown).not.toContain("EmailObfuscationEscape");
    expect(markdown).not.toContain("email_off");
  });
});

describe("markdownRouteForDocsFile", () => {
  test("maps docs index and nested pages to stable routes", () => {
    const siteRoot = new URL("..", import.meta.url).pathname;

    expect(markdownRouteForDocsFile(`${siteRoot}src/pages/docs/index.mdx`)).toBe("docs");
    expect(markdownRouteForDocsFile(`${siteRoot}src/pages/docs/concepts/comments.mdx`)).toBe(
      "docs/concepts/comments",
    );
  });
});

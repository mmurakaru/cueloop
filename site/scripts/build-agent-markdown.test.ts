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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAgentMarkdownDocument } from "../src/agent/mdx-markdown";

const siteRoot = fileURLToPath(new URL("..", import.meta.url));
const docsRoot = join(siteRoot, "src/pages/docs");
const outputRoot = join(siteRoot, "dist");

interface MarkdownPage {
  route: string;
  markdown: string;
}

const standalonePages: MarkdownPage[] = [
  {
    route: "",
    markdown: `# plan, diff & review.

cueloop opens coding-agent work in your terminal. Comment on exact text and send a clear Message back to the same agent conversation.

## Install

\`\`\`bash
curl -fsSL https://cueloop.dev/install.sh | sh
\`\`\`

## What you can review

- Plans and agent replies
- Working-tree diffs
- Component design documents
- Pull requests

Read the [cueloop documentation](https://www.cueloop.dev/docs/index.md) to connect Claude Code, Codex, or pi.
`,
  },
  {
    route: "about",
    markdown: `# About cueloop

cueloop is an open-source review surface for developers who work with coding agents in a terminal. It keeps the work, comments, Messages, and revisions in one Thread.

Use cueloop when an agent should pause for a human review of a plan, reply, diff, prototype, or pull request. The source and issue tracker are available at https://github.com/mmurakaru/cueloop.
`,
  },
  {
    route: "contact",
    markdown: `# Contact cueloop

Read the [documentation](https://www.cueloop.dev/docs/index.md) for setup and usage help. Email [hello@cueloop.dev](mailto:hello@cueloop.dev) for private support or security reports. Use the [public issue tracker](https://github.com/mmurakaru/cueloop/issues) for reproducible bugs and feature requests.
`,
  },
  {
    route: "privacy",
    markdown: `# Privacy

cueloop runs locally by default. Plans, diffs, comments, and code stay on your machine unless you share a Thread.

Shared Threads pass through the hosted SSH gateway. They are encrypted before storage and expire after 30 days without an update. cueloop does not sell data, run advertising, or use third-party trackers.

Email [hello@cueloop.dev](mailto:hello@cueloop.dev) with privacy questions.
`,
  },
];

/** Maps a docs source file to its extension-stable public route. */
export function markdownRouteForDocsFile(filePath: string): string {
  const path = relative(docsRoot, filePath)
    .replaceAll("\\", "/")
    .replace(/\.mdx$/, "");

  return path === "index" ? "docs" : `docs/${path.replace(/\/index$/, "")}`;
}

function writeMarkdownPage(page: MarkdownPage): void {
  for (const prefix of ["_markdown", ""]) {
    const outputPath = join(outputRoot, prefix, page.route, "index.md");
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, page.markdown);
  }
}

export async function buildAgentMarkdownPages(): Promise<void> {
  const glob = new Bun.Glob("**/*.mdx");

  for await (const relativePath of glob.scan({ cwd: docsRoot })) {
    const filePath = join(docsRoot, relativePath);
    writeMarkdownPage({
      route: markdownRouteForDocsFile(filePath),
      markdown: renderAgentMarkdownDocument(readFileSync(filePath, "utf8")),
    });
  }

  standalonePages.forEach(writeMarkdownPage);
}

if (import.meta.main) await buildAgentMarkdownPages();

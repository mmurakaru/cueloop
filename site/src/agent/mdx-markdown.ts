function frontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));

  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

/** Converts a cueloop MDX source page into its agent-facing Markdown representation. */
export function renderAgentMarkdownDocument(source: string): string {
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const title = frontmatterValue(frontmatter, "title");
  const lede = frontmatterValue(frontmatter, "lede");
  const body = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/^import\s.+;\s*$/gm, "")
    .replace(
      /<InstallTabs[^>]*\/>/g,
      "```bash\ncurl -fsSL https://cueloop.dev/install.sh | sh\n```",
    )
    .replace(
      /<BenchTrend[^>]*\/>/g,
      "[View benchmark history](https://www.cueloop.dev/docs/reference/performance/)",
    )
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<\/?(?:div|span)(?:\s[^>]*)?>/g, "")
    .replace(/\{" "\}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return [`# ${title}`, lede, body].filter(Boolean).join("\n\n") + "\n";
}

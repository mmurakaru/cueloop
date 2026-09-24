function frontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));

  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

const fencedCodePattern = /^(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^\1[ \t]*$/gm;
const inlineCodePattern = /(`+)([^\r\n]*?)\1/g;

interface ProtectedCode {
  source: string;
  restore: (value: string) => string;
}

function protectCode(source: string): ProtectedCode {
  const segments: string[] = [];
  let sentinel = "CUELOOP_PROTECTED_CODE";
  while (source.includes(sentinel)) sentinel += "_UNIQUE";

  const protect = (value: string): string => {
    const index = segments.push(value) - 1;

    return `${sentinel}_${index}_END`;
  };
  const protectedSource = source
    .replace(fencedCodePattern, protect)
    .replace(inlineCodePattern, protect);

  return {
    source: protectedSource,
    restore: (value) =>
      value.replace(
        new RegExp(`${sentinel}_(\\d+)_END`, "g"),
        (_, index: string) => segments[Number(index)] ?? "",
      ),
  };
}

/** Converts a cueloop MDX source page into its agent-facing Markdown representation. */
export function renderAgentMarkdownDocument(source: string): string {
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const title = frontmatterValue(frontmatter, "title");
  const lede = frontmatterValue(frontmatter, "lede");
  const sourceWithoutFrontmatter = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const protectedCode = protectCode(sourceWithoutFrontmatter);
  const body = protectedCode
    .restore(
      protectedCode.source
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
        .trim(),
    )
    .trim();

  return [`# ${title}`, lede, body].filter(Boolean).join("\n\n") + "\n";
}

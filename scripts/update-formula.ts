#!/usr/bin/env bun
/**
 * Rewrite Formula/cueloop.rb's version and the four binary sha256 values from a
 * release's checksums.txt, so the tap formula never needs a hand bump.
 *   bun run scripts/update-formula.ts [version]
 * Version defaults to packages/cli/package.json; checksums are read from the
 * cueloop@<version> GitHub release (override with FORMULA_CHECKSUMS=<path>).
 */

const version = process.argv[2] ?? (await Bun.file("packages/cli/package.json").json()).version;
const tag = `cueloop@${version}`;

const checksumsText = process.env.FORMULA_CHECKSUMS
  ? await Bun.file(process.env.FORMULA_CHECKSUMS).text()
  : await fetch(`https://github.com/mmurakaru/cueloop/releases/download/${tag}/checksums.txt`).then(
      (response) => {
        if (!response.ok) throw new Error(`checksums.txt for ${tag}: ${response.status}`);

        return response.text();
      },
    );

// checksums.txt lines are "<sha256>  cueloop-<target>".
const shaByTarget = new Map<string, string>();

for (const line of checksumsText.trim().split("\n")) {
  const [sha, name] = line.trim().split(/\s+/);

  if (sha && name?.startsWith("cueloop-")) shaByTarget.set(name.replace("cueloop-", ""), sha);
}

const targets = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const missing = targets.filter((target) => !shaByTarget.has(target));

if (missing.length) throw new Error(`checksums.txt missing targets: ${missing.join(", ")}`);

const formulaPath = "Formula/cueloop.rb";
let currentTarget: string | undefined;
const updated = (await Bun.file(formulaPath).text())
  .split("\n")
  .map((line) => {
    const versionMatch = line.match(/^(\s*version )"[^"]*"/);

    if (versionMatch) return `${versionMatch[1]}"${version}"`;
    const urlMatch = line.match(/cueloop-(darwin-arm64|darwin-x64|linux-arm64|linux-x64)"/);

    if (urlMatch) currentTarget = urlMatch[1];
    const shaMatch = line.match(/^(\s*sha256 )"[^"]*"/);

    if (shaMatch && currentTarget) return `${shaMatch[1]}"${shaByTarget.get(currentTarget)}"`;

    return line;
  })
  .join("\n");

await Bun.write(formulaPath, updated);
console.log(`Formula/cueloop.rb -> ${version} (${targets.length} sha256 updated)`);

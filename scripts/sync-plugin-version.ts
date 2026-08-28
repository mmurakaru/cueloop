/**
 * Keep the Claude Code plugin manifest's version in lockstep with the npm
 * packages. Runs as part of `bun run version` (the changesets version step),
 * so the Release PR carries the plugin bump alongside the package bumps.
 */
const pkg = await Bun.file("packages/cli/package.json").json();
const manifestPath = ".claude-plugin/plugin.json";
const manifest = await Bun.file(manifestPath).json();

manifest.version = pkg.version;
await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const marketplacePath = ".claude-plugin/marketplace.json";
const marketplace = await Bun.file(marketplacePath).json();

for (const plugin of marketplace.plugins) plugin.version = pkg.version;
await Bun.write(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
console.log(`plugin.json + marketplace.json → ${pkg.version}`);

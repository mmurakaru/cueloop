const pkg = await Bun.file("packages/cli/package.json").json();
const manifestPath = ".claude-plugin/plugin.json";
const manifest = await Bun.file(manifestPath).json();

manifest.version = pkg.version;
await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

for (const path of ["plugin.json", ".codex-plugin/plugin.json"]) {
  const codexManifest = await Bun.file(path).json();

  codexManifest.version = pkg.version;
  await Bun.write(path, JSON.stringify(codexManifest, null, 2) + "\n");
}

const marketplacePath = ".claude-plugin/marketplace.json";
const marketplace = await Bun.file(marketplacePath).json();

for (const plugin of marketplace.plugins) plugin.version = pkg.version;
await Bun.write(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
console.log(`Claude and Codex plugin manifests → ${pkg.version}`);

const pkg = await Bun.file("packages/cli/package.json").json();
const manifestPath = ".claude-plugin/plugin.json";
const manifest = await Bun.file(manifestPath).json();

manifest.version = pkg.version;
await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const codexManifest = await Bun.file("plugin.json").json();

codexManifest.version = pkg.version;
await Bun.write("plugin.json", JSON.stringify(codexManifest, null, 2) + "\n");
const compatibilityManifest = {
  name: codexManifest.name,
  version: codexManifest.version,
  description: codexManifest.description,
  author: { name: codexManifest.author.name },
  skills: "./skills/",
  interface: codexManifest.extensions["com.openai"].interface,
};

await Bun.write(".codex-plugin/plugin.json", JSON.stringify(compatibilityManifest, null, 2) + "\n");

const marketplacePath = ".claude-plugin/marketplace.json";
const marketplace = await Bun.file(marketplacePath).json();

for (const plugin of marketplace.plugins) plugin.version = pkg.version;
await Bun.write(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
console.log(`Claude and Codex plugin manifests → ${pkg.version}`);

import { readdir, readFile, writeFile } from "node:fs/promises";

const directory = new URL("../migrations/", import.meta.url);
const names = (await readdir(directory))
  .filter((name) => /^\d{3}-[a-z-]+\.sql$/.test(name))
  .toSorted();
const resources = Object.fromEntries(
  await Promise.all(
    names.map(async (name) => [name, await readFile(new URL(name, directory), "utf8")] as const),
  ),
);

await writeFile(
  new URL("../src/sync-migration-resources.generated.json", import.meta.url),
  JSON.stringify(resources, null, 2) + "\n",
);

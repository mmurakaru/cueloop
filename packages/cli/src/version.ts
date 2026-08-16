/** The published CLI version, read from the package manifest at build time. */

import manifest from "../package.json" with { type: "json" };

export const CLI_VERSION: string = manifest.version;

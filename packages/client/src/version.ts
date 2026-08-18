/** The published client version, read from the package manifest. */

import manifest from "../package.json" with { type: "json" };

export const CLIENT_VERSION: string = manifest.version;

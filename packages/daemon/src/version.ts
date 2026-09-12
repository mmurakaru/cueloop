/** The daemon's build version, read from the package manifest - the handshake
 *  uses it so a client never keeps talking to a daemon from an earlier build. */

import manifest from "../package.json" with { type: "json" };

export const DAEMON_VERSION: string = manifest.version;

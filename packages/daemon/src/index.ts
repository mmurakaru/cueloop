/**
 * The daemon's public surface. Consumers reach the client and the review
 * helpers through the ./client and ./review subpaths; this barrel carries
 * only the two names imported bare: the server and the home-dir resolver.
 */

export { DaemonServer, type DaemonOptions } from "./server";
export { cueloopHome } from "./paths";

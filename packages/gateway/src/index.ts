/**
 * The gateway's public surface: start the server, and the pieces tests and
 * provisioning reach for (stores, key generation).
 */

export { startGateway, type GatewayOptions, type GatewayHandle } from "./server";
export { MemoryShareStore, R2ShareStore, r2StoreFromEnv, type ShareStore } from "./store";
export { generateMasterKey } from "./crypto";
export { mintShareId, isShareId, SHARE_UPLOAD_USER } from "./share-id";

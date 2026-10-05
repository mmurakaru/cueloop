import type { Thread } from "@cueloop/schema";
import { unpackSessionBlob } from "@cueloop/daemon/share-blob";

/** Open a stored share only when its sole link matches the storage key and names its owner. */
export function unpackGatewayShare(bytes: Uint8Array, shareId: string): Thread {
  const thread = unpackSessionBlob(bytes);
  const link = thread.shares?.[0];

  if (thread.shares?.length !== 1 || link?.id !== shareId || !link.owner)
    throw new Error("gateway share metadata does not match its storage key");

  return thread;
}

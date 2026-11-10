import * as v from "valibot";
import { utils as sshUtilities } from "ssh2";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import { sharePublicationView } from "@cueloop/schema";
import { startGateway, MemoryShareStore, generateMasterKey } from "@cueloop/gateway";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import type { DaemonClient } from "@cueloop/daemon/client";
import { ThreadRecordSchema } from "@cueloop/daemon/validate";
import { mergeFromShare } from "@cueloop/client";
import { execMirrorSsh, MirrorSshView } from "../gateway/mirror/mirror-ssh";
import { waitForMirrorCondition } from "../gateway/mirror/mirror-process";

export async function exerciseTestSyncThreadSharing(options: {
  client: DaemonClient;
  home: string;
  thread: Thread;
}) {
  const gateway = await startGateway({
    store: new MemoryShareStore(),
    masterKey: generateMasterKey(),
    hostKeyPath: join(options.home, "gateway-host-key"),
    port: 0,
    host: "127.0.0.1",
  });
  const shareOwner = {
    port: gateway.port,
    username: "share",
    privateKey: sshUtilities.generateKeyPairSync("ed25519").private,
  };
  const viewer = new MirrorSshView();

  try {
    const published = (
      await execMirrorSsh(
        shareOwner,
        "cueloop-share",
        packSessionBlob(
          sharePublicationView(options.thread, { requireAuth: false, allowlist: [] }),
        ),
      )
    ).toString();
    const shareIdentifier = published.match(/ssh (p_[A-Za-z0-9]{8})@/)?.[1];

    if (!shareIdentifier) throw new Error("Imported Thread must publish its SSH share");

    const pull = async () =>
      v.parse(
        ThreadRecordSchema,
        JSON.parse((await execMirrorSsh(shareOwner, "cueloop-pull", shareIdentifier)).toString()),
      );
    const remote = await pull();

    await options.client.sessionSetShares(options.thread.id, remote.shares ?? []);
    await viewer.open(
      {
        port: gateway.port,
        username: shareIdentifier,
        privateKey: sshUtilities.generateKeyPairSync("ed25519").private,
      },
      "Shared sync review",
    );
    await viewer.selectText("Retained");
    viewer.write("SSH feedback for the synced Thread");
    await viewer.waitForText("SSH feedback for the synced Thread");
    viewer.press(["alt", "enter"]);
    await waitForMirrorCondition("SSH share stores its collaborator feedback", async () =>
      (await pull()).annotations.some(
        (annotation) => annotation.body === "SSH feedback for the synced Thread",
      ),
    );
    const merged = await options.client.sessionMergeShared(
      options.thread.id,
      mergeFromShare(await pull()),
    );
    const sharedComment = merged.annotations.find(
      (annotation) => annotation.body === "SSH feedback for the synced Thread",
    );

    const republished = (
      await execMirrorSsh(
        shareOwner,
        "cueloop-share",
        packSessionBlob(sharePublicationView(merged, { requireAuth: false, allowlist: [] })),
      )
    ).toString();

    const republishedIdentifier = republished.match(/ssh (p_[A-Za-z0-9]{8})@/)?.[1];

    if (!republishedIdentifier)
      throw new Error("Committed Thread projection must publish a new SSH share");

    const republishedThread = v.parse(
      ThreadRecordSchema,
      JSON.parse(
        (await execMirrorSsh(shareOwner, "cueloop-pull", republishedIdentifier)).toString(),
      ),
    );

    return { merged, sharedComment, republishedThread };
  } finally {
    viewer.close();
    await gateway.close();
  }
}

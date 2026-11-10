import React, { useMemo } from "react";
import type { SyncPresencePeer, SyncPresenceSnapshot } from "@cueloop/sync/presence";
import { resolveSyncTextPositions } from "@cueloop/sync/text";
import type { Theme } from "../appearance/theme";

function describePresencePeer(
  peer: SyncPresencePeer,
  anchor: number | undefined,
  focus: number | undefined,
): string {
  const selection = peer.selection;
  let activity = peer.typing ? " typing" : "";

  if (selection) {
    if (
      anchor === undefined ||
      focus === undefined ||
      (anchor === focus && selection.anchor !== selection.focus)
    ) {
      activity += " selection unavailable";
    } else if (anchor === focus) {
      activity += ` cursor ${anchor + 1}`;
    } else {
      activity += ` selecting ${Math.min(anchor, focus) + 1}-${Math.max(anchor, focus)}`;
    }
  }

  return `${peer.actorIdentifier}${activity}`;
}

export function SyncPresenceIndicator({
  presence,
  textState,
  documentIdentifier,
  theme,
}: {
  presence: SyncPresenceSnapshot;
  textState: string;
  documentIdentifier?: string;
  theme: Theme;
}): React.ReactNode {
  const peers = presence.peers;
  const labels = useMemo(() => {
    const visible = presence.peers.slice(0, 2);
    const positions = visible.flatMap((peer) =>
      peer.selection && peer.selection.documentIdentifier === documentIdentifier
        ? [peer.selection.anchor, peer.selection.focus]
        : ["", ""],
    );
    const resolved = positions.some((position) => position.length > 0)
      ? resolveSyncTextPositions({ state: textState, positions })
      : [];

    return visible.map((peer, index) =>
      describePresencePeer(peer, resolved[index * 2], resolved[index * 2 + 1]),
    );
  }, [presence.peers, textState, documentIdentifier]);
  const label =
    presence.status !== "connected"
      ? "Presence unavailable"
      : peers.length
        ? labels.join(" · ") + (peers.length > 2 ? ` · +${peers.length - 2} more` : "")
        : "No other collaborators connected";

  return (
    <box style={{ height: 1, flexShrink: 0, paddingLeft: 2 }}>
      <text fg={theme.textMuted}>{label}</text>
    </box>
  );
}

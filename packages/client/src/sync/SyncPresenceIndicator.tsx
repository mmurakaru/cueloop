import React from "react";
import type { SyncPresencePeer, SyncPresenceSnapshot } from "@cueloop/sync/presence";
import { resolveSyncTextPosition } from "@cueloop/sync/text";
import type { Theme } from "../appearance/theme";

function describePresencePeer(
  peer: SyncPresencePeer,
  textState: string,
  documentIdentifier?: string,
): string {
  const selection = peer.selection;
  let activity = peer.typing ? " typing" : "";

  if (selection) {
    const anchor =
      selection.documentIdentifier === documentIdentifier
        ? resolveSyncTextPosition({ state: textState, position: selection.anchor })
        : undefined;
    const focus =
      selection.documentIdentifier === documentIdentifier
        ? resolveSyncTextPosition({ state: textState, position: selection.focus })
        : undefined;

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
  const labels = peers
    .slice(0, 2)
    .map((peer) => describePresencePeer(peer, textState, documentIdentifier));
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

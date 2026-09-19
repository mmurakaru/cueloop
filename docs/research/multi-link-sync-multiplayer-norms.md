# Multiple share links and live-sync: how multiplayer products do it

## Question

A cueloop thread can carry several share links.
Each link is its own end-to-end-encrypted blob, keyed by its share id, stored at a gateway and reached over SSH.
The owner publishes a frozen snapshot per link and can push updates per blob; collaborators annotate; the owner pulls those back or keeps a live `cueloop-watch` SSH stream open per link
(`packages/client/src/share.ts` - `publishShare`, `pullShare`, `watchShare`; one `cueloop-watch` stream per share id).

A live watch is one persistent SSH stream per link, so N open links on a thread means N persistent streams.
The owner cares about idle CPU and battery, so N streams per open thread is a real cost.

This note asks what established multiplayer and document-collaboration products do for the same shape: multiple ways to reach one item, and how many live connections that implies.
It then maps the norm back to cueloop.

---

## 1. How each product handles multiple links plus sync

### Google Docs / Drive

A document has one canonical link, and "who can open it" is a single switch on that link: "Restricted" (only named people) or "Anyone with the link".
Anyone with the link all get the same role (Viewer, Commenter, or Editor) - the link carries one access tier, not a per-recipient grant.
To give different people different access, you add per-person grants by email on the same document; you do not mint a second link.
So it is one document with one link plus an access-control list, never multiple independent link-copies.
Sources:
[Share files from Google Drive](https://support.google.com/docs/answer/2494822?hl=en&co=GENIE.Platform%3DDesktop),
[Google Drive Community: one link regardless of permissions](https://support.google.com/drive/thread/195894379/google-share-link-is-the-same-regardless-of-what-permissions-are-given?hl=en).

### Figma

A file has two link states: "Only invited people" or "Anyone with the link", plus per-person and per-team grants.
Whichever way you reach the file, you open the same file and join the same live session - the link is an access gate, not a separate copy.
Source: [Guide to sharing and permissions](https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions),
[Manage public link sharing and open sessions](https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions).

### Notion

Notion has several sharing surfaces - invite people, publish to web, share a teamspace, copy link with permissions - but a page has one public web link and one set of per-person/per-group grants, not many independent public links each with its own policy.
Publishing to the web sets view/comment/edit on that one public link.
Source: [Sharing and permissions settings in Notion](https://www.notion.com/help/sharing-and-permissions),
[Understanding Notion's sharing settings](https://www.notion.com/help/guides/understanding-notions-sharing-settings).

### Confluence

A page inherits space permissions and can carry page-level restrictions that name who can View and/or Edit that one page.
Access is modelled as restrictions layered on one page, not as distinct shareable copies.
Source: [Page restrictions (Atlassian)](https://confluence.atlassian.com/doc/page-restrictions-139414.html),
[Manage permissions at the content level (Confluence Cloud)](https://support.atlassian.com/confluence-cloud/docs/manage-permissions-on-the-page-level/).

The pattern is the same across all four: one canonical item, one link whose access is a switch (public vs restricted), and a per-recipient access-control list for finer grants.
None of them mint N independent per-link copies of the document.

## 2. The dominant architectural pattern

One authoritative document that any authorized viewer joins over one shared realtime session, regardless of which link or grant let them in.
Access is a grant layer in front of that single document; it is not a fork of the content.

Figma is explicit: "Figma's servers spin up a separate process for each multiplayer document which everyone editing that document connects to", and clients "talk with a cluster of servers over WebSockets", downloading one copy then syncing both directions over that connection.
Source: [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/),
[Multiplayer editing in Figma](https://www.figma.com/blog/multiplayer-editing-in-figma/).

Linear does the same at the account level: "Linear sends all modified model properties to all connected clients via a single WebSocket connection", bootstrapping local state then applying server-broadcast delta packets.
Source: [Rebuilding Linear's delta sync read path](https://linear.app/now/rebuilding-delta-sync-read-path),
[reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine).

The unit of the realtime connection is the document (Figma) or the workspace/account (Linear) - never the individual share link.
Many links collapse onto one live session, so live-sync cost scales with open documents, not with how many ways each document was shared.

## 3. Idle and connection-cost patterns

- One connection per open document, fanned out server-side to all participants; the server multiplexes, the client holds a single socket (Figma per-document process, Linear single socket).
- Close the live connection when the tab is hidden and reconnect on `visibilitychange`, because browsers do not throttle open WebSockets in background tabs, so an idle socket keeps costing.
  A documented result: closing after ~30s hidden then reconnecting on wake cut "stale dashboard" reports ~80%.
  Source: [OneUptime: WebSocket reconnection logic](https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view),
  [Home Assistant: close websocket when app in background](https://github.com/home-assistant/frontend/issues/5438).
- On reconnect, catch up by last-seen event id or timestamp rather than holding the stream open to avoid a gap (Linear's syncId delta packets; the general last-event-id pattern).
  Source: [How's Linear so fast](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown).

The throughline: the industry pays for at most one live connection per open item and drops even that when the view is idle or backgrounded, catching up on resume - the opposite of holding many always-on streams.

## 4. Recommendation for cueloop

cueloop is deliberately different from the shared-document norm: each link is its own encrypted blob keyed by its share id, so there is no single realtime document that all links collapse onto
(`packages/client/src/share.ts`, `packages/schema/src/share-links.ts`).
"One document, many grants" (option c) is the industry norm but a real architectural shift for cueloop, because it would trade per-share isolated blobs for one shared blob plus a grant layer - and per-link E2E-encrypted blobs are a security property, not an accident.
That is a separate, larger decision; do not fold it into multi-link sync.

For the near term, take option (b): keep N independent blobs but bound live cost so it does not scale with link count.
Concretely:

- Do not hold N persistent `cueloop-watch` streams for one open thread.
  Match the norm of one live channel per open item: either multiplex all of a thread's shares over a single gateway watch stream (server-side fan-in over the SSH connection, one stream carrying frames tagged by share id), or, if the gateway cannot fan in, keep watch off by default and pull.
- Gate any live watch on foreground and open-thread state, and tear it down when the thread view is not focused or the app is backgrounded, mirroring the `visibilitychange` close-and-reconnect pattern.
  This matches cueloop's existing zero-idle diff-watcher lifecycle, where a watcher exists only for a live diff session
  (`docs/research/working-tree-hot-reload-watching.md`).
- Prefer poll-on-demand over always-on watch for links that are not actively being reviewed: pull each blob on thread open and on an explicit refresh, and reserve a live stream for the one share the owner is watching now.

Reject option (a) - N always-on streams per open thread is exactly the always-on-per-share cost the norm avoids, and it scales the wrong way with link count on the owner's idle machine.

The key citation: real products run one shared realtime session per document that every link joins
([How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)),
and even that one connection is closed when idle or backgrounded
([OneUptime: WebSocket reconnection logic](https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view)).
Given cueloop keeps per-share blobs by design, bound the stream count to one live channel per open thread and drop it when idle, rather than fanning out one stream per link.

---

## Sources

- Google Docs/Drive sharing: <https://support.google.com/docs/answer/2494822?hl=en&co=GENIE.Platform%3DDesktop>
- Google Drive - one link regardless of permissions: <https://support.google.com/drive/thread/195894379/google-share-link-is-the-same-regardless-of-what-permissions-are-given?hl=en>
- Figma sharing and permissions: <https://help.figma.com/hc/en-us/articles/1500007609322-Guide-to-sharing-and-permissions>
- Figma public link sharing and open sessions: <https://help.figma.com/hc/en-us/articles/5726756336791-Manage-public-link-sharing-and-open-sessions>
- Figma multiplayer technology: <https://www.figma.com/blog/how-figmas-multiplayer-technology-works/>
- Figma multiplayer editing: <https://www.figma.com/blog/multiplayer-editing-in-figma/>
- Notion sharing and permissions: <https://www.notion.com/help/sharing-and-permissions>
- Notion sharing settings guide: <https://www.notion.com/help/guides/understanding-notions-sharing-settings>
- Confluence page restrictions: <https://confluence.atlassian.com/doc/page-restrictions-139414.html>
- Confluence content-level permissions: <https://support.atlassian.com/confluence-cloud/docs/manage-permissions-on-the-page-level/>
- Linear delta sync read path: <https://linear.app/now/rebuilding-delta-sync-read-path>
- Linear sync engine (reverse engineering): <https://github.com/wzhudev/reverse-linear-sync-engine>
- Linear performance breakdown: <https://performance.dev/how-is-linear-so-fast-a-technical-breakdown>
- WebSocket reconnection logic and visibility: <https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view>
- Close websocket when backgrounded (Home Assistant): <https://github.com/home-assistant/frontend/issues/5438>

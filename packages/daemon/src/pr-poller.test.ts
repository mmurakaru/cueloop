import { describe, expect, test } from "bun:test";
import { PrReviewPoller } from "./pr-poller";

/** Build a poller whose head sha is controllable, with the timer effectively disabled. */
function refs(baseSha: string, headSha: string) {
  return { baseSha, headSha };
}

function makePoller(initialRefs: ReturnType<typeof refs> | null) {
  let currentRefs = initialRefs;
  const advanced: Array<{ sessionId: string; refs: ReturnType<typeof refs> }> = [];
  const poller = new PrReviewPoller(
    (sessionId, nextRefs) => advanced.push({ sessionId, refs: nextRefs }),
    async () => currentRefs,
    1_000_000,
  );

  return {
    poller,
    advanced,
    setRefs: (next: ReturnType<typeof refs> | null) => {
      currentRefs = next;
    },
  };
}

describe("PrReviewPoller", () => {
  test("the first observation is a silent baseline", async () => {
    const { poller, advanced } = makePoller(refs("base1", "sha1"));

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    expect(advanced).toEqual([]);
    poller.close();
  });

  test("a moved head fires once; an unchanged head stays quiet", async () => {
    const { poller, advanced, setRefs } = makePoller(refs("base1", "sha1"));

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    setRefs(refs("base1", "sha2"));
    await poller.refreshHead("s1");
    await poller.refreshHead("s1");

    expect(advanced).toEqual([{ sessionId: "s1", refs: refs("base1", "sha2") }]);
    poller.close();
  });

  test("a persisted reviewed head exposes a move on the first check after restart", async () => {
    const { poller, advanced } = makePoller(refs("base1", "sha2"));

    poller.trackPr("s1", "https://github.com/org/repo/pull/1", refs("base1", "sha1"));
    await poller.refreshHead("s1");

    expect(advanced).toEqual([{ sessionId: "s1", refs: refs("base1", "sha2") }]);
    poller.close();
  });

  test("a failed head read never fires and keeps the last baseline", async () => {
    const { poller, advanced, setRefs } = makePoller(refs("base1", "sha1"));

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    setRefs(null);
    await poller.refreshHead("s1");
    setRefs(refs("base1", "sha2"));
    await poller.refreshHead("s1");

    expect(advanced).toEqual([{ sessionId: "s1", refs: refs("base1", "sha2") }]);
    poller.close();
  });

  test("untrack stops further checks", async () => {
    const { poller, advanced, setRefs } = makePoller(refs("base1", "sha1"));

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");
    poller.untrackPr("s1");

    setRefs(refs("base1", "sha2"));
    await poller.refreshHead("s1");

    expect(advanced).toEqual([]);
    poller.close();
  });

  test("a moved base fires while the head stays unchanged", async () => {
    const { poller, advanced, setRefs } = makePoller(refs("base1", "sha1"));

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");
    setRefs(refs("base2", "sha1"));
    await poller.refreshHead("s1");

    expect(advanced).toEqual([{ sessionId: "s1", refs: refs("base2", "sha1") }]);
    poller.close();
  });
});

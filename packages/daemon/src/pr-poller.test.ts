import { describe, expect, test } from "bun:test";
import { PrReviewPoller } from "./pr-poller";

/** Build a poller whose head sha is controllable, with the timer effectively disabled. */
function makePoller(initialSha: string | null) {
  let sha = initialSha;
  const advanced: string[] = [];
  const poller = new PrReviewPoller(
    (sessionId) => advanced.push(sessionId),
    async () => sha,
    1_000_000,
  );

  return {
    poller,
    advanced,
    setSha: (next: string | null) => {
      sha = next;
    },
  };
}

describe("PrReviewPoller", () => {
  test("the first observation is a silent baseline", async () => {
    const { poller, advanced } = makePoller("sha1");

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    expect(advanced).toEqual([]);
    poller.close();
  });

  test("a moved head fires once; an unchanged head stays quiet", async () => {
    const { poller, advanced, setSha } = makePoller("sha1");

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    setSha("sha2");
    await poller.refreshHead("s1");
    await poller.refreshHead("s1");

    expect(advanced).toEqual(["s1"]);
    poller.close();
  });

  test("a failed head read never fires and keeps the last baseline", async () => {
    const { poller, advanced, setSha } = makePoller("sha1");

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");

    setSha(null);
    await poller.refreshHead("s1");
    setSha("sha2");
    await poller.refreshHead("s1");

    expect(advanced).toEqual(["s1"]);
    poller.close();
  });

  test("untrack stops further checks", async () => {
    const { poller, advanced, setSha } = makePoller("sha1");

    poller.trackPr("s1", "org/repo#1");
    await poller.refreshHead("s1");
    poller.untrackPr("s1");

    setSha("sha2");
    await poller.refreshHead("s1");

    expect(advanced).toEqual([]);
    poller.close();
  });
});

import { expect, test } from "bun:test";
import { createLatestStatePublisher } from "./latest-state-publisher";

test("a slow transport coalesces a thousand streaming updates and sends the newest state", async () => {
  const blocked = Promise.withResolvers<void>();
  const sent: number[] = [];
  let revision = 0;
  const publish = createLatestStatePublisher(async () => {
    const current = revision;

    if (!current) await blocked.promise;
    sent.push(current);
  });
  const drained = publish();

  for (revision = 1; revision <= 1000; revision++) void publish();
  revision = 1000;
  blocked.resolve();
  await drained;
  expect(sent).toEqual([0, 1000]);
  revision = 1001;
  await publish();
  expect(sent.at(-1)).toBe(1001);
});

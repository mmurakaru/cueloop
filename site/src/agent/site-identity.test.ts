import { expect, test } from "bun:test";
import { cueloopIdentityGraph } from "./site-identity";

test("publishes canonical software and project identity", () => {
  expect(cueloopIdentityGraph["@context"]).toBe("https://schema.org");
  expect(cueloopIdentityGraph["@graph"].map((entry) => entry["@type"])).toEqual([
    "SoftwareApplication",
    "Organization",
  ]);
  expect(cueloopIdentityGraph["@graph"][0].url).toBe("https://www.cueloop.dev/");
});

/**
 * The release a gate compares against: the newest published cueloop release
 * whose version is strictly lower than the head version. Ordered by version,
 * not by GitHub's prerelease flag, which the release flow does not set.
 */

import * as v from "valibot";

export const RELEASE_TAG_PREFIX = "cueloop@";

const ReleaseListSchema = v.array(v.object({ tagName: v.string(), isDraft: v.boolean() }));

type ReleaseList = v.InferOutput<typeof ReleaseListSchema>;

/** The `cueloop@<version>` tag of the newest published release below `headVersion`, or null. */
export function previousReleaseTag(releases: ReleaseList, headVersion: string): string | null {
  const candidates = releases
    .filter((release) => !release.isDraft && release.tagName.startsWith(RELEASE_TAG_PREFIX))
    .map((release) => release.tagName.slice(RELEASE_TAG_PREFIX.length))
    .filter((version) => Bun.semver.order(version, headVersion) < 0)
    .toSorted((left, right) => Bun.semver.order(right, left));

  return candidates.length > 0 ? `${RELEASE_TAG_PREFIX}${candidates[0]}` : null;
}

/** The `cueloop@<version>` tag of the newest published release, or null when none. */
export function latestReleaseTag(releases: ReleaseList): string | null {
  const candidates = releases
    .filter((release) => !release.isDraft && release.tagName.startsWith(RELEASE_TAG_PREFIX))
    .map((release) => release.tagName.slice(RELEASE_TAG_PREFIX.length))
    .toSorted((left, right) => Bun.semver.order(right, left));

  return candidates.length > 0 ? `${RELEASE_TAG_PREFIX}${candidates[0]}` : null;
}

/** Ask GitHub for the published release list, newest first is not assumed. */
export async function fetchReleaseList(): Promise<ReleaseList> {
  const proc = Bun.spawn(["gh", "release", "list", "--limit", "100", "--json", "tagName,isDraft"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  if (code !== 0) throw new Error("previous-release: gh release list failed");

  return v.parse(ReleaseListSchema, JSON.parse(stdout));
}

/** Ask GitHub for the release list and pick the previous release; throws when there is none. */
export async function resolvePreviousReleaseTag(headVersion: string): Promise<string> {
  const tag = previousReleaseTag(await fetchReleaseList(), headVersion);

  if (tag === null) {
    throw new Error(`previous-release: no published cueloop release below ${headVersion}`);
  }

  return tag;
}

/** Ask GitHub for the release list and pick the newest published release; throws when none. */
export async function resolveLatestReleaseTag(): Promise<string> {
  const tag = latestReleaseTag(await fetchReleaseList());

  if (tag === null) throw new Error("previous-release: no published cueloop release found");

  return tag;
}

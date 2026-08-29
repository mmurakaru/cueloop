/**
 * Create the cueloop gateway's uptime monitors in Better Stack (issue #167,
 * Layer 1). Config-as-code so the monitors are reproducible and reviewed here
 * rather than living only in a dashboard. Idempotent: a monitor whose name is
 * already present is left untouched, so re-running is safe.
 *
 * One-time setup a human must do (kept out of this repo on purpose):
 *   1. Create a Better Stack account and point its alert email at
 *      hello@cueloop.dev (Team - notifications). The address lives in Better
 *      Stack, never in git.
 *   2. Mint an Uptime API token (Settings - API tokens).
 *   3. Run: BETTERSTACK_API_TOKEN=<token> bun run scripts/setup-betterstack.ts
 *      Add --dry-run first to see what it would create.
 */

import * as v from "valibot";

const MONITORS_ENDPOINT = "https://uptime.betterstack.com/api/v2/monitors";
const dryRun = process.argv.includes("--dry-run");

interface MonitorSpecification {
  pronounceable_name: string;
  monitor_type: "tcp" | "status";
  url: string;
  port?: string;
  ssl_expiration?: number;
}

// The two Layer 1 signals: the gateway's SSH port answers, and the site serves
// HTTPS with a certificate that is not about to lapse. The gateway is DNS-only
// SSH, so it is a plain TCP reachability check with no certificate to inspect.
const MONITORS: MonitorSpecification[] = [
  {
    pronounceable_name: "cueloop gateway (SSH :22)",
    monitor_type: "tcp",
    url: "cueloop.dev",
    port: "22",
  },
  {
    pronounceable_name: "cueloop site (HTTPS)",
    monitor_type: "status",
    url: "https://www.cueloop.dev",
    ssl_expiration: 14,
  },
];

// The API is a network trust boundary, so its shape is validated before use.
const MonitorListSchema = v.object({
  data: v.array(v.object({ attributes: v.object({ pronounceable_name: v.string() }) })),
  pagination: v.optional(v.object({ next: v.nullable(v.string()) })),
});

function readToken(): string {
  const value = process.env.BETTERSTACK_API_TOKEN;

  if (!value) throw new Error("set BETTERSTACK_API_TOKEN (Better Stack - Settings - API tokens)");

  return value;
}

async function existingNames(bearer: string): Promise<Set<string>> {
  const names = new Set<string>();
  let next: string | null = MONITORS_ENDPOINT;

  while (next) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${bearer}` } });

    if (!response.ok) throw new Error(`listing monitors failed: HTTP ${response.status}`);
    const page = v.parse(MonitorListSchema, await response.json());

    for (const monitor of page.data) names.add(monitor.attributes.pronounceable_name);
    next = page.pagination?.next ?? null;
  }

  return names;
}

async function create(bearer: string, monitorSpecification: MonitorSpecification): Promise<void> {
  const response = await fetch(MONITORS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    // email: alerts go to the account's configured contact (hello@cueloop.dev),
    // set once in the dashboard. check_frequency is a safe 3 min; the free tier
    // allows down to 30s if tighter detection is wanted later.
    body: JSON.stringify({ ...monitorSpecification, email: true, check_frequency: 180 }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `creating "${monitorSpecification.pronounceable_name}" failed: HTTP ${response.status} ${detail}`,
    );
  }
}

if (dryRun) {
  console.log("dry run - would ensure these Better Stack monitors:");
  for (const monitorSpecification of MONITORS) {
    console.log(
      `  - ${monitorSpecification.pronounceable_name} (${monitorSpecification.monitor_type})`,
    );
  }
  process.exit(0);
}

const bearer = readToken();
const present = await existingNames(bearer);
let created = 0;

for (const monitorSpecification of MONITORS) {
  if (present.has(monitorSpecification.pronounceable_name)) {
    console.log(`exists, skipping: ${monitorSpecification.pronounceable_name}`);
    continue;
  }

  await create(bearer, monitorSpecification);
  console.log(`created: ${monitorSpecification.pronounceable_name}`);
  created++;
}

console.log(`done - ${created} created, ${MONITORS.length - created} already present`);

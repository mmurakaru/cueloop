/**
 * The install-matrix host: run each POSIX install scenario, then aggregate the
 * facts it recorded into one verdict. A scenario is a pure `sh` script (so it
 * runs unchanged in a Bun-less container) that installs the product some way
 * and appends tab-separated assertions to a file; this host reads them and
 * writes result.json plus a JUnit report, exiting non-zero on any failure. Each
 * scenario declares its required evidence with `expect` in lib.sh, so a skipped
 * assertion becomes a recorded failure that both this host and run.sh catch.
 *
 * With `--assets <dir>` it serves an offline release from that directory tree
 * (`<dir>/<tag>/<asset>`), pointing the installer at it through the CUELOOP_*
 * overrides, so the same scenarios gate a freshly built release before publish.
 * Without it the scenarios hit the real public release.
 *
 *   bun run test/install/matrix/run.ts --out dist/install-matrix curl-clean npm
 *   bun run test/install/matrix/run.ts --assets dist/release \
 *     --version 0.1.0-alpha.70 --previous 0.1.0-alpha.69 --out dist/install-matrix
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import { RELEASE_TAG_PREFIX } from "../../../scripts/benchmarks/previous-release";

const HOST_DIR = import.meta.dir;
const REPO_ROOT = join(HOST_DIR, "..", "..", "..");
const DEFAULT_INSTALLER = join(REPO_ROOT, "site", "public", "install.sh");

const ScenarioSpecSchema = v.object({
  name: v.string(),
  description: v.string(),
});

const ScenariosSchema = v.array(ScenarioSpecSchema);

type ScenarioSpec = v.InferOutput<typeof ScenarioSpecSchema>;

/** One recorded fact from a scenario: an evidence id and whether it held. */
export interface ScenarioAssertion {
  id: string;
  passed: boolean;
  detail: string;
}

/** The outcome of one scenario: its recorded assertions and the verdict. */
export interface ScenarioResult {
  name: string;
  description: string;
  exitCode: number;
  assertions: ScenarioAssertion[];
  passed: boolean;
}

/** The whole matrix run on one machine. */
export interface MatrixResult {
  platform: string;
  passed: boolean;
  scenarios: ScenarioResult[];
}

/** Options for one matrix run; `assetsDir` switches on the offline release server. */
export interface MatrixOptions {
  scenarioNames: string[];
  installerPath: string;
  repoRoot: string;
  platform: string;
  assetsDir: string;
  version: string;
  previousVersion: string;
}

let scenarioSpecsCache: ScenarioSpec[] | null = null;

/** Read and validate the scenario manifest that sits next to this host, once. */
export function loadScenarioSpecs(): ScenarioSpec[] {
  if (scenarioSpecsCache !== null) return scenarioSpecsCache;
  const text = readFileSync(join(HOST_DIR, "scenarios.json"), "utf8");

  scenarioSpecsCache = v.parse(ScenariosSchema, JSON.parse(text));

  return scenarioSpecsCache;
}

/** Parse the tab-separated rows a scenario appended: "<id>\t<pass|fail>\t<detail>". */
export function parseAssertions(text: string): ScenarioAssertion[] {
  const assertions: ScenarioAssertion[] = [];

  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [id, status, detail = ""] = line.split("\t");

    if (id === undefined || status === undefined) continue;

    assertions.push({ id, passed: status === "pass", detail });
  }

  return assertions;
}

/** The version part of a `cueloop@<version>` tag. */
function versionOfTag(tag: string): string {
  return tag.slice(RELEASE_TAG_PREFIX.length);
}

/** The install-matrix tags in `assetsDir`, newest version first. */
function releaseTagsInAssets(assetsDir: string): string[] {
  return readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(RELEASE_TAG_PREFIX))
    .map((entry) => entry.name)
    .toSorted((left, right) => Bun.semver.order(versionOfTag(right), versionOfTag(left)));
}

/**
 * Serve `<assetsDir>/<tag>/<asset>` as a GitHub-shaped release, or null when no
 * dir. A `/download` request answers with a 302 to a separate `/objects` path
 * that serves the bytes, mirroring GitHub redirecting release downloads to
 * signed object-store URLs. That keeps the installer's redirect-following
 * (`curl -L`) on the tested path, so dropping it would fail the gate here rather
 * than only in the post-publish weekly run.
 */
function startReleaseServer(assetsDir: string) {
  if (assetsDir === "") return null;

  const tags = releaseTagsInAssets(assetsDir);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;

      if (pathname === "/releases") {
        return Response.json(tags.map((tag) => ({ tag_name: tag })));
      }
      const requestUrl = new URL(request.url);
      const download = /^\/download\/([^/]+)\/([^/]+)$/.exec(pathname);

      if (download) {
        const target = `${requestUrl.origin}/objects/${download[1]}/${download[2]}`;

        return Response.redirect(target, 302);
      }
      const object = /^\/objects\/([^/]+)\/([^/]+)$/.exec(pathname);

      if (!object) return new Response("not found", { status: 404 });
      const [, tag, asset] = object;

      if (tag === undefined || asset === undefined) {
        return new Response("bad path", { status: 400 });
      }
      if (tag.includes("..") || asset.includes("..")) {
        return new Response("bad path", { status: 400 });
      }
      const file = Bun.file(join(assetsDir, tag, asset));

      return (await file.exists())
        ? new Response(file)
        : new Response("not found", { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;

  return { origin, stop: () => server.stop(true) };
}

/** Run one scenario script and read back the assertions it recorded. */
async function runScenario(
  spec: ScenarioSpec,
  options: MatrixOptions,
  release: ReturnType<typeof startReleaseServer>,
): Promise<ScenarioResult> {
  const sandbox = mkdtempSync(join(tmpdir(), `install-matrix-${spec.name}-`));
  const assertionsPath = join(sandbox, "assertions.tsv");

  writeFileSync(assertionsPath, "");
  const script = join(HOST_DIR, "scenarios", `${spec.name}.sh`);
  const child = Bun.spawn(["sh", script], {
    cwd: options.repoRoot,
    env: {
      ...Bun.env,
      MATRIX_ASSERTIONS: assertionsPath,
      MATRIX_INSTALLER: options.installerPath,
      MATRIX_SANDBOX: sandbox,
      MATRIX_REPO_ROOT: options.repoRoot,
      CUELOOP_DOWNLOAD_BASE: release ? `${release.origin}/download` : "",
      CUELOOP_RELEASES_API: release ? `${release.origin}/releases` : "",
      CUELOOP_VERSION: options.version,
      CUELOOP_MATRIX_PREVIOUS_VERSION: options.previousVersion,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  const assertions = parseAssertions(readFileSync(assertionsPath, "utf8"));
  // a scenario that recorded nothing aborted before its `expect` finalizer ran
  const passed =
    exitCode === 0 && assertions.length > 0 && assertions.every((assertion) => assertion.passed);

  rmSync(sandbox, { recursive: true, force: true });

  return {
    name: spec.name,
    description: spec.description,
    exitCode,
    assertions,
    passed,
  };
}

/** Run the requested scenarios and return the aggregate verdict. */
export async function runMatrix(options: MatrixOptions): Promise<MatrixResult> {
  const specs = loadScenarioSpecs();
  const selected = options.scenarioNames.map((name) => {
    const spec = specs.find((candidate) => candidate.name === name);

    if (spec === undefined) throw new Error(`install-matrix: unknown scenario '${name}'`);

    return spec;
  });
  const release = startReleaseServer(options.assetsDir);

  try {
    const scenarios: ScenarioResult[] = [];

    // one at a time on purpose: scenarios install into shared paths and share
    // one release server, so concurrent runs would contend and interleave output
    for (const spec of selected) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design, see above
      scenarios.push(await runScenario(spec, options, release));
    }
    const passed = scenarios.every((scenario) => scenario.passed);

    return { platform: options.platform, passed, scenarios };
  } finally {
    release?.stop();
  }
}

/** Escape a string for an XML attribute or text node. */
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The reasons a scenario failed, one line each, for a JUnit failure body. */
function scenarioFailureLines(scenario: ScenarioResult): string[] {
  const lines: string[] = [];

  if (scenario.exitCode !== 0) lines.push(`script exited ${scenario.exitCode}`);
  if (scenario.assertions.length === 0) lines.push("scenario recorded no assertions");
  for (const assertion of scenario.assertions) {
    if (!assertion.passed) lines.push(`${assertion.id}: ${assertion.detail}`);
  }

  return lines;
}

/** Render the matrix result as a JUnit report a CI test-summary can ingest. */
export function toJUnitXml(result: MatrixResult): string {
  const failures = result.scenarios.filter((scenario) => !scenario.passed).length;
  const cases = result.scenarios
    .map((scenario) => {
      const open = `    <testcase name="${escapeXml(scenario.name)}" classname="${escapeXml(result.platform)}">`;

      if (scenario.passed) return `${open}</testcase>`;
      const body = escapeXml(scenarioFailureLines(scenario).join("\n"));

      return `${open}\n      <failure message="scenario failed">${body}</failure>\n    </testcase>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<testsuites>",
    `  <testsuite name="install-matrix ${escapeXml(result.platform)}" tests="${result.scenarios.length}" failures="${failures}">`,
    cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
}

/** Print a one-line-per-scenario summary of the run. */
function printSummary(result: MatrixResult): void {
  console.log(`\ninstall-matrix on ${result.platform}:`);
  for (const scenario of result.scenarios) {
    const mark = scenario.passed ? "PASS" : "FAIL";

    console.log(`  ${mark}  ${scenario.name}  ${scenario.description}`);
    if (!scenario.passed) {
      for (const line of scenarioFailureLines(scenario)) console.log(`          ${line}`);
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      assets: { type: "string", default: "" },
      out: { type: "string", default: "" },
      version: { type: "string", default: "" },
      previous: { type: "string", default: "" },
      installer: { type: "string", default: DEFAULT_INSTALLER },
      platform: { type: "string", default: `${process.platform}-${process.arch}` },
      scenarios: { type: "string", default: "" },
    },
  });
  const specs = loadScenarioSpecs();
  const listed = parsed.values.scenarios === "" ? [] : parsed.values.scenarios.split(",");
  const names = [...parsed.positionals, ...listed];
  const scenarioNames = names.length > 0 ? names : specs.map((spec) => spec.name);
  const result = await runMatrix({
    scenarioNames,
    installerPath: parsed.values.installer,
    repoRoot: REPO_ROOT,
    platform: parsed.values.platform,
    assetsDir: parsed.values.assets,
    version: parsed.values.version,
    previousVersion: parsed.values.previous,
  });

  printSummary(result);
  if (parsed.values.out !== "") {
    mkdirSync(parsed.values.out, { recursive: true });
    writeFileSync(join(parsed.values.out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(parsed.values.out, "junit.xml"), toJUnitXml(result));
  }

  process.exit(result.passed ? 0 : 1);
}

if (import.meta.main) await main();

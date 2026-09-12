/**
 * The install-vm host: boot a fresh Firecracker microVM per scenario and run the
 * real installer inside it, so bugs that only show on a clean machine (no node
 * or bun, empty PATH, unset HOME, a daemon left running, no network) are caught.
 *
 * This host stays on the CI runner. It preflights KVM, stages an offline release
 * the guests reach through the installer's CUELOOP_* overrides, builds a pinned
 * controller image, and hands the whole run to controller.sh inside a container
 * with `/dev/kvm`. Each guest appends assertions to a file; this host aggregates
 * them into result.json and a JUnit report, reusing the install-matrix format.
 *
 *   bun run test/install/vm/runner.ts --out tmp/install-vm
 *   bun run test/install/vm/runner.ts --scenario clean-machine
 *   bun run test/install/vm/runner.ts --update-pins        # fill pins.json sha256
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import {
  RELEASE_TAG_PREFIX,
  resolvePreviousReleaseTag,
} from "../../../scripts/benchmarks/previous-release";
import { type MatrixResult, parseAssertions, type ScenarioResult, toJUnitXml } from "../matrix/run";

const HOST_DIR = import.meta.dir;
const REPO_ROOT = join(HOST_DIR, "..", "..", "..");
const PINS_PATH = join(HOST_DIR, "pins.json");
const INSTALLER = join(REPO_ROOT, "site", "public", "install.sh");
const MATRIX_LIB = join(REPO_ROOT, "test", "install", "matrix", "lib.sh");

/** The minimum free space the VM disks and rootfs need, in bytes. */
const MIN_FREE_BYTES = 6 * 1024 * 1024 * 1024;

const ScenarioSpecSchema = v.object({ name: v.string(), description: v.string() });
const ScenariosSchema = v.array(ScenarioSpecSchema);
type ScenarioSpec = v.InferOutput<typeof ScenarioSpecSchema>;

/** The linux release arch for the current machine, as the installer names it. */
export function currentReleaseArch(): "x64" | "arm64" {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  throw new Error(
    `install-vm: unsupported arch '${process.arch}', only x64 and arm64 boot Linux guests`,
  );
}

/** The release version tags the fixture serves for one run. */
export interface FixtureVersions {
  good: string;
  previous: string;
  badChecksum: string;
  truncated: string;
  missingAsset: string;
}

/** The synthetic version tags the fixture serves, derived from the target version. */
export function fixtureVersions(targetVersion: string, previousVersion: string): FixtureVersions {
  return {
    good: targetVersion,
    previous: previousVersion,
    badChecksum: `${targetVersion}-badchecksum`,
    truncated: `${targetVersion}-truncated`,
    missingAsset: `${targetVersion}-missingasset`,
  };
}

/** Read and validate the scenario manifest. */
function loadScenarioSpecs(): ScenarioSpec[] {
  return v.parse(
    ScenariosSchema,
    JSON.parse(readFileSync(join(HOST_DIR, "scenarios.json"), "utf8")),
  );
}

/** Run a command, inheriting stdio, and return its exit code. */
async function run(command: string[], cwd = REPO_ROOT): Promise<number> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });

  return child.exited;
}

/** Run a command and capture stdout; throws on a non-zero exit. */
async function capture(command: string[], cwd = REPO_ROOT): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (code !== 0) throw new Error(`install-vm: command failed: ${command.join(" ")}`);

  return stdout.trim();
}

/** The free bytes on the filesystem holding `path`, via POSIX `df`. */
async function freeBytes(path: string): Promise<number> {
  const output = await capture(["df", "-Pk", path]);
  const dataLine = output.split("\n").at(-1) ?? "";
  const availableKilobytes = Number(dataLine.split(/\s+/)[3]);

  if (Number.isNaN(availableKilobytes)) throw new Error("install-vm: could not parse df output");

  return availableKilobytes * 1024;
}

/** Hard-fail unless KVM, the tun device, docker, and enough disk are all present. */
export async function preflight(): Promise<void> {
  const problems: string[] = [];

  if (!existsSync("/dev/kvm")) {
    problems.push(
      "/dev/kvm is missing; run `sudo chmod a+rw /dev/kvm` on a KVM-capable Linux host",
    );
  }
  if (!existsSync("/dev/net/tun")) problems.push("/dev/net/tun is missing");
  if ((await run(["docker", "info"])) !== 0) problems.push("docker is not available");
  try {
    if ((await freeBytes(REPO_ROOT)) < MIN_FREE_BYTES) problems.push("less than 6 GB free");
  } catch {
    problems.push("could not check free disk space");
  }

  if (problems.length > 0) {
    throw new Error(`install-vm preflight failed:\n  - ${problems.join("\n  - ")}`);
  }
}

/** The sha256 of a file, in hex. */
async function sha256OfFile(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();

  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Write one release into the fixture tree: the asset, and checksums.txt unless suppressed. */
async function writeFixtureRelease(
  fixturesDir: string,
  version: string,
  assetName: string,
  assetPath: string,
  checksumMode: "correct" | "wrong" | "none",
): Promise<void> {
  const releaseDir = join(fixturesDir, `${RELEASE_TAG_PREFIX}${version}`);

  mkdirSync(releaseDir, { recursive: true });
  await Bun.write(join(releaseDir, assetName), Bun.file(assetPath));
  if (checksumMode === "none") return;
  const hash =
    checksumMode === "wrong" ? "0".repeat(64) : await sha256OfFile(join(releaseDir, assetName));

  writeFileSync(join(releaseDir, "checksums.txt"), `${hash}  ${assetName}\n`);
}

/**
 * Stage an offline release tree the guests download from. The target binary is
 * the freshly built one; the previous release, when there is one, is pulled from
 * GitHub so the upgrade path uses two real binaries. Bad-checksum, truncated, and
 * missing-asset variants exercise the installer's refuse-and-preserve behavior.
 */
export async function stageFixtures(fixturesDir: string): Promise<FixtureVersions> {
  const arch = currentReleaseArch();
  const assetName = `cueloop-linux-${arch}`;

  rmSync(fixturesDir, { recursive: true, force: true });
  mkdirSync(fixturesDir, { recursive: true });

  // build the target binary for this arch
  await run(["bun", "run", "build:binary"], join(REPO_ROOT, "packages", "cli"));
  const builtBinary = join(REPO_ROOT, "packages", "cli", "dist", "cueloop");
  const targetVersion = await capture([
    "jq",
    "-r",
    ".version",
    join(REPO_ROOT, "packages", "cli", "package.json"),
  ]);

  let previousVersion = "";

  try {
    previousVersion = (await resolvePreviousReleaseTag(targetVersion)).slice(
      RELEASE_TAG_PREFIX.length,
    );
  } catch {
    previousVersion = "";
  }
  const versions = fixtureVersions(targetVersion, previousVersion);

  await writeFixtureRelease(fixturesDir, versions.good, assetName, builtBinary, "correct");
  await writeFixtureRelease(fixturesDir, versions.badChecksum, assetName, builtBinary, "wrong");

  // truncated: half the bytes, but checksums.txt claims the full binary's hash
  const truncatedDir = join(fixturesDir, `${RELEASE_TAG_PREFIX}${versions.truncated}`);

  mkdirSync(truncatedDir, { recursive: true });
  const fullBytes = await Bun.file(builtBinary).bytes();

  await Bun.write(
    join(truncatedDir, assetName),
    fullBytes.subarray(0, Math.floor(fullBytes.length / 2)),
  );
  writeFileSync(
    join(truncatedDir, "checksums.txt"),
    `${await sha256OfFile(builtBinary)}  ${assetName}\n`,
  );

  // missing-asset: listed but no file uploaded
  mkdirSync(join(fixturesDir, `${RELEASE_TAG_PREFIX}${versions.missingAsset}`), {
    recursive: true,
  });

  if (previousVersion !== "") {
    const previousDir = join(fixturesDir, `${RELEASE_TAG_PREFIX}${previousVersion}`);

    mkdirSync(previousDir, { recursive: true });
    await run([
      "gh",
      "release",
      "download",
      `${RELEASE_TAG_PREFIX}${previousVersion}`,
      "--pattern",
      assetName,
      "--dir",
      previousDir,
    ]);
    if (existsSync(join(previousDir, assetName))) {
      const hash = await sha256OfFile(join(previousDir, assetName));

      writeFileSync(join(previousDir, "checksums.txt"), `${hash}  ${assetName}\n`);
    } else {
      versions.previous = "";
    }
  }

  // the releases listing the installer reads when no version is pinned
  const tags = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ tag_name: entry.name }));

  writeFileSync(join(fixturesDir, "releases.json"), JSON.stringify(tags));

  return versions;
}

/** Aggregate each guest's assertions.tsv under `runsDir` into one verdict. */
export function aggregate(runsDir: string, specs: ScenarioSpec[], platform: string): MatrixResult {
  const scenarios: ScenarioResult[] = specs.map((spec) => {
    const assertionsPath = join(runsDir, spec.name, "assertions.tsv");
    const assertions = existsSync(assertionsPath)
      ? parseAssertions(readFileSync(assertionsPath, "utf8"))
      : [];
    // the real guest exit is not carried back across the SSH boundary; the
    // expect-contract in lib.sh turns a mid-scenario abort into a failing row,
    // so a missing assertions file (nothing ran) is the only exit signal here
    const exitCode = existsSync(assertionsPath) ? 0 : 1;
    const passed = assertions.length > 0 && assertions.every((assertion) => assertion.passed);

    return { name: spec.name, description: spec.description, exitCode, assertions, passed };
  });
  const passed = scenarios.every((scenario) => scenario.passed);

  return { suite: "install-vm", platform, passed, scenarios };
}

/** The controller image tag. CI runners are fresh, so a content hash buys no
 *  cache hit; Docker's own layer invalidation covers local iteration. */
const CONTROLLER_IMAGE_TAG = "cueloop-install-vm:local";

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      scenario: { type: "string", default: "" },
      out: { type: "string", default: join(REPO_ROOT, "tmp", "install-vm") },
      "update-pins": { type: "boolean", default: false },
    },
  });
  const arch = currentReleaseArch();

  if (parsed.values["update-pins"]) {
    // the prep script defaults its paths to /work (the container); on the host
    // point it at repo-local paths and pins.json so it can record hashes
    const pinWork = join(REPO_ROOT, "tmp", "install-vm", "pins");

    mkdirSync(join(pinWork, "cache"), { recursive: true });
    const child = Bun.spawn(
      ["sh", join(HOST_DIR, "prepare-base-image.sh"), "--update-pins", arch],
      {
        cwd: REPO_ROOT,
        env: { ...Bun.env, WORK: pinWork, CACHE_DIR: join(pinWork, "cache"), PINS: PINS_PATH },
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    await child.exited;

    return;
  }

  await preflight();
  const specs = loadScenarioSpecs();
  const selected =
    parsed.values.scenario === ""
      ? specs
      : specs.filter((spec) => spec.name === parsed.values.scenario);

  if (selected.length === 0)
    throw new Error(`install-vm: unknown scenario '${parsed.values.scenario}'`);
  const outDir = parsed.values.out;
  const fixturesDir = join(outDir, "fixtures");
  const runsDir = join(outDir, "runs");

  rmSync(runsDir, { recursive: true, force: true });
  mkdirSync(runsDir, { recursive: true });
  const versions = await stageFixtures(fixturesDir);

  // the upgrade scenario needs a real previous release; skip it when there is none
  const runnable =
    versions.previous === "" ? selected.filter((spec) => spec.name !== "upgrade") : selected;

  if (runnable.length < selected.length) {
    console.log("skipping upgrade: no previous published release to upgrade from");
  }
  if (runnable.length === 0) {
    console.log("install-vm: nothing to run");

    return;
  }

  await run([
    "docker",
    "build",
    "-t",
    CONTROLLER_IMAGE_TAG,
    "-f",
    join(HOST_DIR, "Dockerfile"),
    HOST_DIR,
  ]);

  const dockerRun = [
    "docker",
    "run",
    "--rm",
    "--cap-drop=ALL",
    "--cap-add=NET_ADMIN",
    "--cap-add=CHOWN",
    "--cap-add=DAC_OVERRIDE",
    "--device=/dev/kvm",
    "--device=/dev/net/tun",
    "-v",
    `${fixturesDir}:/work/fixtures:ro`,
    "-v",
    `${runsDir}:/work/runs`,
    "-v",
    `${INSTALLER}:/work/install.sh:ro`,
    "-v",
    `${MATRIX_LIB}:/work/lib.sh:ro`,
    "-v",
    `${join(HOST_DIR, "scenarios")}:/work/scenarios:ro`,
    "-v",
    `${PINS_PATH}:/work/pins.json:ro`,
    "-e",
    `INSTALL_VM_ARCH=${arch}`,
    "-e",
    `INSTALL_VM_SCENARIOS=${runnable.map((spec) => spec.name).join(" ")}`,
    "-e",
    `CUELOOP_VM_GOOD_VERSION=${versions.good}`,
    "-e",
    `CUELOOP_VM_PREVIOUS_VERSION=${versions.previous}`,
    "-e",
    `CUELOOP_VM_BAD_CHECKSUM_VERSION=${versions.badChecksum}`,
    "-e",
    `CUELOOP_VM_TRUNCATED_VERSION=${versions.truncated}`,
    "-e",
    `CUELOOP_VM_MISSING_ASSET_VERSION=${versions.missingAsset}`,
    CONTROLLER_IMAGE_TAG,
  ];
  const controllerCode = await run(dockerRun);
  const result = aggregate(runsDir, runnable, `linux-${arch}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(outDir, "junit.xml"), toJUnitXml(result));
  for (const scenario of result.scenarios) {
    console.log(
      `  ${scenario.passed ? "PASS" : "FAIL"}  ${scenario.name}  ${scenario.description}`,
    );
  }

  process.exit(result.passed && controllerCode === 0 ? 0 : 1);
}

if (import.meta.main) await main();

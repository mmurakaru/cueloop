import { BOMBADIL_SCENARIOS, type BombadilScenario } from "./fixture-contract.ts";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import * as v from "valibot";
import { createTestBombadilReview } from "../helpers/bombadil-review.ts";
import {
  bombadilPropertiesPassed,
  compressBombadilTrace,
  summarizeBombadilTrace,
} from "./trace-report.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    duration: { type: "string", default: "30" },
    output: { type: "string" },
    scenario: { type: "string" },
    reproduce: { type: "string" },
  },
  strict: true,
});
const durationSeconds = v.parse(
  v.pipe(
    v.string(),
    v.regex(/^\d+$/),
    v.transform(Number),
    v.integer(),
    v.minValue(5),
    v.maxValue(300),
  ),
  values.duration,
);
const scenarios = values.scenario
  ? [v.parse(v.picklist(BOMBADIL_SCENARIOS), values.scenario)]
  : [...BOMBADIL_SCENARIOS];
const output = resolve(
  values.output ?? join("tmp", "bombadil", new Date().toISOString().replaceAll(/[:.]/g, "-")),
);

if (values.reproduce && scenarios.length !== 1)
  throw new Error("Bombadil reproduction requires exactly one --scenario");

if (existsSync(output) && readdirSync(output).length > 0)
  throw new Error("Bombadil output directory must be empty");

mkdirSync(output, { recursive: true });

async function runScenario(scenario: BombadilScenario) {
  const directory = join(output, scenario);

  mkdirSync(directory);
  const specification = resolve(
    `test/bombadil/${scenario === "draft" ? "draft" : "navigation"}.bombadil.ts`,
  );
  const commandArguments = [
    "terminal",
    "test",
    "--specification",
    specification,
    "--time-limit",
    `${durationSeconds}s`,
    "--columns",
    "120",
    "--rows",
    "32",
    "--quiescence-timeout-ms",
    "50",
    "--scrollback-lines-max",
    "0",
    "--output-path",
    join(directory, "trace"),
    "--exit-on-violation",
  ];

  if (values.reproduce) {
    let reproduction = resolve(values.reproduce);

    if (reproduction.endsWith(".gz")) {
      const expanded = join(directory, "reproduce.jsonl");

      await pipeline(createReadStream(reproduction), createGunzip(), createWriteStream(expanded));
      reproduction = expanded;
    }

    commandArguments.push("--reproduce", reproduction);
  }

  const fixture = await createTestBombadilReview(scenario);
  const command = [
    process.execPath,
    resolve("node_modules/.bin/bombadil"),
    ...commandArguments,
    "--",
    ...fixture.command,
  ];
  let readySignalObserved = false;
  let dataUnchanged = false;
  let bombadilExitCode: number | null = null;
  let errorMessage: string | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;

  try {
    child = Bun.spawn(command, {
      cwd: fixture.directory,
      env: fixture.environment,
      stdout: "ignore",
      stderr: Bun.file(join(directory, "bombadil.log")),
      signal: AbortSignal.timeout((durationSeconds + 30) * 1000),
    });
    const before = await Promise.race([
      fixture.arm(),
      child.exited.then((code) => {
        throw new Error(`Bombadil exited before review readiness: ${code}`);
      }),
    ]);

    readySignalObserved = true;
    bombadilExitCode = await child.exited;
    dataUnchanged = fixture.fingerprint() === before;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (child) {
      child.kill();
      await child.exited;
    }

    fixture.close();
  }

  const tracePath = join(directory, "trace", "trace.jsonl");
  const trace = existsSync(tracePath) ? await summarizeBombadilTrace(tracePath) : null;
  const compressed = trace ? await compressBombadilTrace(tracePath) : null;
  const expectedViolation = scenario === "negative-control" ? "noReplacementChars" : null;
  const propertiesPassed = bombadilPropertiesPassed(trace, scenario, bombadilExitCode);
  const passed = !errorMessage && readySignalObserved && dataUnchanged && propertiesPassed;
  const report = {
    scenario,
    passed,
    durationSeconds,
    readySignalObserved,
    dataUnchanged,
    bombadilExitCode,
    expectedViolation,
    errorMessage,
    trace,
    compressed,
  };

  writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");

  return report;
}

const versionCheck = Bun.spawnSync([
  process.execPath,
  resolve("node_modules/.bin/bombadil"),
  "--version",
]);

if (versionCheck.exitCode !== 0) throw new Error("Bombadil executable is unavailable");

const metadata = {
  bombadilVersion: versionCheck.stdout.toString().trim(),
  bunVersion: Bun.version,
  platform: process.platform,
  architecture: process.arch,
  sourceCommit: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(),
  workingTreeDirty:
    Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim().length > 0,
};
const reports = [];

for (const scenario of scenarios) reports.push(await runScenario(scenario));

const markdown = [
  "# Bombadil terminal evidence",
  "",
  `Tool: ${metadata.bombadilVersion}; Bun ${metadata.bunVersion}; ${metadata.platform}-${metadata.architecture}.`,
  `Source: ${metadata.sourceCommit}; working tree contains changes: ${metadata.workingTreeDirty}.`,
  "",
  "| Scenario | Result | States | Actions | Resizes | Clicks | Unicode inputs | Violations | Saved review unchanged |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ...reports.map(
    (report) =>
      `| ${report.scenario} | ${report.passed ? "pass" : "fail"} | ${report.trace?.states ?? 0} | ${report.trace?.actions ?? 0} | ${report.trace?.resizes ?? 0} | ${report.trace?.clicks ?? 0} | ${report.trace?.unicodeInputs ?? 0} | ${report.trace?.violations.join(", ") || "none"}${report.expectedViolation ? " (expected)" : ""} | ${report.dataUnchanged} |`,
  ),
  "",
  "The negative control deliberately renders a replacement character and must trigger noReplacementChars.",
  "Ordinary scenarios must have no violations, observe the ready-file signal, exercise at least ten actions, and leave persisted review data unchanged.",
  "",
  "## Reproduction",
  "",
  "```sh",
  `bun run test:bombadil --scenario plan --reproduce ${join(output, "plan", "trace", "trace.jsonl.gz")}`,
  "```",
  "",
  "Reproduction is best-effort; timing can cause action-tree divergence. Reports include compressed trace SHA-256 hashes.",
  "",
].join("\n");

writeFileSync(join(output, "summary.md"), markdown);
writeFileSync(join(output, "summary.json"), JSON.stringify({ metadata, reports }, null, 2) + "\n");
process.stdout.write(`Bombadil evidence: ${join(output, "summary.md")}\n`);

if (reports.some((report) => !report.passed)) process.exitCode = 1;

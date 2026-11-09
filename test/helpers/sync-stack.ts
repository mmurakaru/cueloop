import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import * as v from "valibot";

const POSTGRES_IMAGE =
  "postgres@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42";
const ZERO_IMAGE =
  "rocicorp/zero@sha256:da55baa417adf670d07dd882ec90b9d9591f274a13347205cd2f71956433c057";

export async function createTestSyncStack() {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-stack-"));
  const name = `cueloop-sync-test-${randomUUID()}`;
  const postgresName = `${name}-postgres`;
  const zeroName = `${name}-zero`;
  const password = randomBytes(24).toString("hex");
  const token = randomBytes(24).toString("hex");
  const userIdentifier = "sync_test_reader";
  let authority: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;

  function redact(output: string): string {
    return output.replaceAll(password, "[redacted]").replaceAll(token, "[redacted]");
  }

  async function docker(arguments_: string[], input?: string): Promise<string> {
    const child = Bun.spawn(["docker", ...arguments_], {
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(90000),
    });
    const [output, error, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (exitCode !== 0) throw new Error(`Sync test Docker command failed: ${redact(error)}`);

    return output.trim();
  }

  async function close() {
    authority?.kill("SIGTERM");
    await authority?.exited;
    await docker(["rm", "--force", zeroName]).catch(() => {});
    await docker(["rm", "--force", "--volumes", postgresName]).catch(() => {});
    await docker(["network", "rm", name]).catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }

  try {
    writeFileSync(
      join(directory, "postgres.env"),
      `POSTGRES_USER=sync_test\nPOSTGRES_DB=sync_test\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    await docker(["network", "create", name]);
    await docker([
      "run",
      "--detach",
      "--name",
      postgresName,
      "--network",
      name,
      "--env-file",
      join(directory, "postgres.env"),
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
      "-c",
      "wal_level=logical",
    ]);
    const port = await docker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      postgresName,
    ]);
    const deadline = Date.now() + 30000;

    for (;;) {
      try {
        await docker([
          "exec",
          postgresName,
          "pg_isready",
          "--host",
          "127.0.0.1",
          "-U",
          "sync_test",
          "-d",
          "sync_test",
        ]);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;

        await Bun.sleep(50);
      }
    }

    const migrationDirectory = new URL("../../examples/sync-workspace/", import.meta.url);

    for (const migration of readdirSync(migrationDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      await docker(
        [
          "exec",
          "-i",
          postgresName,
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "sync_test",
          "-d",
          "sync_test",
        ],
        readFileSync(new URL(migration, migrationDirectory), "utf8"),
      );
    }

    await docker(
      [
        "exec",
        "-i",
        postgresName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "sync_test",
        "-d",
        "sync_test",
      ],
      "INSERT INTO sync_workspace_member (workspace_identifier, user_identifier, role) SELECT workspace_identifier, 'sync_test_reader', 'owner' FROM shared_record LIMIT 1;",
    );
    const environment = {
      ...process.env,
      SYNC_DATABASE_URL: `postgres://sync_test:${password}@127.0.0.1:${port}/sync_test`,
      SYNC_AUTH_TOKEN: token,
      SYNC_USER_ID: userIdentifier,
      SYNC_STORAGE_KEY: name,
    };

    authority = Bun.spawn(
      [
        process.execPath,
        "packages/sync/bin/cueloop-sync.js",
        "serve",
        "--application",
        "examples/sync-workspace/authority.ts",
        "--host",
        "0.0.0.0",
        "--port",
        "0",
      ],
      { env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    const reader = authority.stdout.getReader();
    let startup = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) throw new Error("Sync test authority exited before readiness");

        startup += new TextDecoder().decode(value);

        if (startup.includes("\n")) break;
      }
    } finally {
      reader.releaseLock();
    }

    const ready = v.parse(
      v.object({ event: v.literal("sync.authority.ready"), port: v.number() }),
      JSON.parse(startup.trim()),
    );

    const upstream = `postgres://sync_test:${password}@${postgresName}:5432/sync_test`;
    const zeroEnvironment = [
      `ZERO_UPSTREAM_DB=${upstream}`,
      `ZERO_CVR_DB=${upstream}`,
      `ZERO_CHANGE_DB=${upstream}`,
      "ZERO_REPLICA_FILE=/data/zero.db",
      "ZERO_NUM_SYNC_WORKERS=1",
      "ZERO_ALLOW_LEGACY_QUERIES=false",
      "ZERO_ENABLE_CRUD_MUTATIONS=false",
      `ZERO_ADMIN_PASSWORD=${randomBytes(24).toString("hex")}`,
      `ZERO_QUERY_URL=http://host.docker.internal:${ready.port}/query`,
      `ZERO_MUTATE_URL=http://host.docker.internal:${ready.port}/mutate`,
    ].join("\n");

    writeFileSync(join(directory, "zero.env"), zeroEnvironment, { mode: 0o600 });
    await docker([
      "run",
      "--detach",
      "--name",
      zeroName,
      "--network",
      name,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--env-file",
      join(directory, "zero.env"),
      "--publish",
      "127.0.0.1::4848",
      "--tmpfs",
      "/data",
      ZERO_IMAGE,
    ]);
    const cachePort = await docker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "4848/tcp") 0).HostPort}}',
      zeroName,
    ]);
    const cacheURL = `http://127.0.0.1:${cachePort}`;
    const readyDeadline = Date.now() + 45000;

    // The dispatcher can pass health checks before its workers are ready.
    for (;;) {
      const logs = await docker(["logs", zeroName]);

      if (logs.includes('"message":"zero-cache ready (')) break;

      if (Date.now() >= readyDeadline)
        throw new Error("Sync test cache did not signal worker readiness");

      await Bun.sleep(50);
    }

    return {
      cacheURL,
      auth: token,
      userID: userIdentifier,
      storageKey: name,
      directory,
      environment: { ...environment, SYNC_CACHE_URL: cacheURL },
      close,
    };
  } catch (error) {
    await close();

    throw error;
  }
}

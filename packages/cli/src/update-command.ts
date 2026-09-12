const INSTALL_URL = "https://cueloop.dev/install.sh";

function defaultInstallDir(): string {
  return `${process.env.HOME ?? ""}/.local/bin`;
}

/** Re-run the published installer into the stable user bin directory. */
export async function updateCommand(): Promise<number> {
  const installDir = process.env.CUELOOP_INSTALL_DIR || defaultInstallDir();

  if (!installDir.startsWith("/")) {
    console.error("cueloop update: CUELOOP_INSTALL_DIR must be an absolute path");

    return 1;
  }
  console.error(`updating cueloop in ${installDir}...`);
  const response = await fetch(INSTALL_URL);

  if (!response.ok) {
    console.error(`cueloop update: failed to fetch installer (${response.status})`);

    return 1;
  }
  const installer = await response.text();
  const child = Bun.spawn(["sh"], {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, CUELOOP_INSTALL_DIR: installDir },
  });

  child.stdin.write(installer);
  child.stdin.end();

  return child.exited;
}

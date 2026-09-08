import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binaryContent = "#!/bin/sh\nprintf 'installed test binary\\n'\n";

// Keep installer tests offline and restrict installation to a temporary directory.
export function createTestInstaller() {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-install-test-"));
  const checksum = new Bun.CryptoHasher("sha256").update(binaryContent).digest("hex");

  writeFileSync(join(directory, "binary"), binaryContent);
  writeFileSync(
    join(directory, "curl"),
    `#!/bin/sh
set -eu
sleep 0.2
case "$4" in
  *'/releases?'*) printf '%s\\n' '{"tag_name":"cueloop@test"}' > "$3" ;;
  */checksums.txt) printf '${checksum} %s\\n' cueloop-darwin-arm64 cueloop-darwin-x64 cueloop-linux-arm64 cueloop-linux-x64 > "$3" ;;
  *) cp "$TEST_INSTALLER_DIRECTORY/binary" "$3" ;;
esac
`,
    { mode: 0o755 },
  );
  const environment = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    CUELOOP_INSTALL_DIR: directory,
    CUELOOP_VERSION: "",
    CUELOOP_NO_BANNER: "",
    TEST_INSTALLER_DIRECTORY: directory,
  };

  return { directory, environment, binaryContent };
}

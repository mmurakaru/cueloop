/**
 * An offline release server for installer tests: a local HTTP tree shaped like
 * GitHub's releases listing and download URLs, pointed at through the
 * installer's CUELOOP_RELEASES_API and CUELOOP_DOWNLOAD_BASE overrides. The
 * "binary" is a shell script that answers `--version`, so the whole flow runs
 * in milliseconds with no network. Synthetic versions cover each failure path.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermeticCueloopEnvironment } from "./env";

/** The release that installs cleanly. */
export const GOOD_VERSION = "900.0.1";
/** A release whose checksums.txt lists the wrong hash for every asset. */
export const BAD_CHECKSUM_VERSION = "900.0.2";
/** A release with binaries but no checksums.txt. */
export const NO_CHECKSUMS_VERSION = "900.0.3";
/** A release the listing names but whose assets were never uploaded. */
export const MISSING_ASSET_VERSION = "900.0.4";

/** The asset names the release workflow uploads. */
export const RELEASE_ASSETS = [
  "cueloop-darwin-arm64",
  "cueloop-darwin-x64",
  "cueloop-linux-arm64",
  "cueloop-linux-x64",
];

/** A stand-in binary: prints its version on `--version`, else a marker line. */
export function testBinaryScript(version: string): string {
  return `#!/bin/sh\ncase "\${1:-}" in --version) printf '%s\\n' '${version}' ;; *) printf 'installed test binary\\n' ;; esac\n`;
}

export interface TestReleaseServer {
  /** Request paths seen so far, in order. */
  requests: string[];
  /** A temp directory the test may install into. */
  installDir: string;
  /** Where the installer puts the binary inside `installDir`. */
  installedBinary: string;
  /**
   * An environment for `sh install.sh`: hermetic, pointed at this server,
   * installing into `installDir`, banner and rc edits off unless overridden.
   */
  environment(overrides?: Record<string, string>): Record<string, string>;
  close(): void;
}

/** checksums.txt in the release workflow's `sha256sum` format: two spaces between hash and name. */
function checksumsText(binary: string, corrupt: boolean): string {
  const hash = corrupt
    ? "0".repeat(64)
    : new Bun.CryptoHasher("sha256").update(binary).digest("hex");

  return RELEASE_ASSETS.map((asset) => `${hash}  ${asset}\n`).join("");
}

/** Serve a release tree whose newest listed tag is `cueloop@GOOD_VERSION`. */
export function startTestReleaseServer(): TestReleaseServer {
  const requests: string[] = [];
  const installDir = mkdtempSync(join(tmpdir(), "cueloop-install-"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;

      requests.push(path);
      if (path === "/releases") {
        return Response.json([{ tag_name: `cueloop@${GOOD_VERSION}` }]);
      }
      const download = /^\/download\/cueloop@([^/]+)\/([^/]+)$/.exec(path);

      if (!download) return new Response("not found", { status: 404 });
      const [, version, file] = download;

      if (version === MISSING_ASSET_VERSION) return new Response("not found", { status: 404 });
      const binary = testBinaryScript(version!);

      if (file === "checksums.txt") {
        if (version === NO_CHECKSUMS_VERSION) return new Response("not found", { status: 404 });

        return new Response(checksumsText(binary, version === BAD_CHECKSUM_VERSION));
      }
      if (RELEASE_ASSETS.includes(file!)) return new Response(binary);

      return new Response("not found", { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;

  return {
    requests,
    installDir,
    installedBinary: join(installDir, "cueloop"),
    environment(overrides = {}) {
      return hermeticCueloopEnvironment(installDir, {
        CUELOOP_RELEASES_API: `${origin}/releases`,
        CUELOOP_DOWNLOAD_BASE: `${origin}/download`,
        CUELOOP_INSTALL_DIR: installDir,
        CUELOOP_VERSION: "",
        CUELOOP_NO_BANNER: "",
        CUELOOP_NO_MODIFY_PATH: "1",
        // CI sets these in every job; a test opts in explicitly when it wants them
        GITHUB_PATH: "",
        XDG_CONFIG_HOME: "",
        ZDOTDIR: "",
        ...overrides,
      });
    },
    close() {
      server.stop(true);
      rmSync(installDir, { recursive: true, force: true });
    },
  };
}

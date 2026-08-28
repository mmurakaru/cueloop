#!/bin/sh
# cueloop installer. Downloads the self-contained cueloop binary (the Bun
# runtime is bundled in, so no Node and no separate Bun install are needed) from
# GitHub Releases and drops it on a stable PATH.
#
#   curl -fsSL https://cueloop.dev/install.sh | sh
#
# Overrides (environment variables):
#   CUELOOP_INSTALL_DIR   target directory (default: ~/.local/bin, else a
#                         writable system dir)
#   CUELOOP_VERSION       a release tag to pin (default: the newest release)
#
# The script is POSIX sh. pipefail is turned on where the shell supports it;
# every download lands in a temp file first, so a broken pipe cannot pass a
# truncated binary through undetected.
set -eu
if ( set -o pipefail 2>/dev/null ); then set -o pipefail; fi

REPO="mmurakaru/cueloop"
BINARY="cueloop"

RED=''
BOLD=''
DIM=''
ACCENT=''
RESET=''
if [ -t 2 ]; then
  RED="$(printf '\033[31m')"
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  ACCENT="$(printf '\033[38;5;141m')"
  RESET="$(printf '\033[0m')"
fi

# Progress spinner: a braille spinner while a step runs, replaced by a check when
# it finishes. Same colour as the message text. Only animates on a terminal; when
# stderr is piped or logged we just print the plain line, so logs stay clean.
SPINNER_FRAMES='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏'
CHECK_MARK='✓'
spinner_process_id=''

info() { printf '%s\n' "${DIM}cueloop:${RESET} $*" >&2; }

# spinner_start <message>: begin the spinner for a step. Animates only on a
# capable terminal; otherwise (piped output, or a dumb terminal without
# cursor control) it just prints the plain line so nothing gets garbled.
spinner_start() {
  spinner_message="$1"
  if [ -t 2 ] && [ "${TERM:-}" != "dumb" ]; then
    (
      while :; do
        for frame in $SPINNER_FRAMES; do
          printf '\r%scueloop:%s %s %s ' "$DIM" "$RESET" "$spinner_message" "$frame" >&2
          sleep 0.08 2>/dev/null || true
        done
      done
    ) &
    spinner_process_id=$!
  else
    info "$spinner_message"
  fi
}

# spinner_finish: stop the spinner and stamp the line with a check.
spinner_finish() {
  [ -n "$spinner_process_id" ] || return 0
  kill "$spinner_process_id" 2>/dev/null || true
  wait "$spinner_process_id" 2>/dev/null || true
  spinner_process_id=''
  printf '\r\033[K%scueloop:%s %s %s\n' "$DIM" "$RESET" "$spinner_message" "$CHECK_MARK" >&2
}

error() {
  if [ -n "${spinner_process_id:-}" ]; then
    kill "$spinner_process_id" 2>/dev/null || true
    wait "$spinner_process_id" 2>/dev/null || true
    spinner_process_id=''
    printf '\r\033[K' >&2
  fi
  printf '%s\n' "${RED}${BOLD}cueloop install failed:${RESET} $*" >&2
  exit 1
}

# The cueloop mark, rendered from the logo, revealed a line at a time in the
# accent colour. Purely cosmetic: skipped when stderr is not a terminal (piped
# or logged output) or when CUELOOP_NO_BANNER is set, so it never garbles logs.
LOGO='⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⣀⠀⣠⢤⣄⡸⢷⣲⢤⣀
⠀⠀⢀⡤⠖⠛⠉⠉⠀⠀⠈⠙⢎⢣⠀⠉⠙⠮⡙⢮⠑⢦⡀
⠀⢰⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⡎⣇⠀⠀⠀⠘⣆⢣⠀⠙⢆
⠀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢹⢸⠀⠀⠀⠀⠘⡌⡇⠀⠈⢧
⠀⢧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⢸⠀⠀⠀⠀⠀⣇⢳⠀⠀⠈⣇
⡷⣜⢦⡀⠀⠀⠀⠀⠀⠀⠀⠀⢠⢇⡏⠀⠀⠀⠀⠀⡕⢸⠀⠀⠀⢸
⢇⠈⠳⢭⣗⣶⠤⢤⣤⣤⠤⠴⣫⠞⠀⠀⠀⠀⠀⢀⡇⡎⠀⠀⠀⢸
⣈⢣⡀⠀⠀⠉⠉⠙⠛⠛⠋⠉⠁⠀⠀⠀⠀⠀⢀⠞⡼⠁⠀⠀⠀⢸
⢻⠓⢝⡢⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡴⣫⠞⠀⠀⠀⠀⢀⡏
⠈⢧⠀⠙⠲⢽⣲⠤⣤⣀⣀⣀⣀⣀⣠⠴⣫⠞⠁⠀⠀⠀⠀⢀⡞
⠀⠀⠳⣄⠀⠀⠈⠉⠓⠒⠺⠿⠿⠖⠒⠋⠀⠀⠀⠀⠀⠀⣠⠎
⠀⠀⠀⠈⠳⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⠞⠁
⠀⠀⠀⠀⠀⠀⠙⠲⠤⣄⣀⣀⣀⣀⣀⣀⣤⠴⠒⠋
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠁'

banner() {
  [ -t 2 ] || return 0
  [ "${CUELOOP_NO_BANNER:-}" = "" ] || return 0
  case "${TERM:-}" in dumb) return 0 ;; esac
  printf '\n' >&2
  printf '%s\n' "$LOGO" | while IFS= read -r line; do
    printf '  %s%s%s\n' "$ACCENT" "$line" "$RESET" >&2
    sleep 0.02 2>/dev/null || true
  done
  printf '\n  %s%scueloop%s  %sreview surface for coding agents%s\n\n' \
    "$BOLD" "$ACCENT" "$RESET" "$DIM" "$RESET" >&2
}

# --- prerequisites --------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD="wget -qO-"
else
  error "need curl or wget on PATH to download the release."
fi

fetch() {
  # fetch <url> -> stdout
  if [ "$DOWNLOAD" = "curl -fsSL" ]; then
    curl -fsSL "$1"
  else
    wget -qO- "$1"
  fi
}

fetch_to() {
  # fetch_to <url> <file>; fails on any HTTP error
  if [ "$DOWNLOAD" = "curl -fsSL" ]; then
    curl -fsSL -o "$2" "$1"
  else
    wget -qO "$2" "$1"
  fi
}

banner

# --- detect platform ------------------------------------------------------
operating_system="$(uname -s)"
architecture="$(uname -m)"

case "$operating_system" in
  Darwin) operating_system="darwin" ;;
  Linux) operating_system="linux" ;;
  *) error "unsupported operating system '$operating_system'. Install with npm instead: npm i -g cueloop" ;;
esac

case "$architecture" in
  x86_64 | amd64) architecture="x64" ;;
  arm64 | aarch64) architecture="arm64" ;;
  *) error "unsupported architecture '$architecture'. Install with npm instead: npm i -g cueloop" ;;
esac

asset="${BINARY}-${operating_system}-${architecture}"

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/cueloop.XXXXXX")"
trap 'rm -rf "$temporary_directory"; if [ -n "${spinner_process_id:-}" ]; then kill "$spinner_process_id" 2>/dev/null || true; fi' EXIT INT TERM

# --- resolve the release tag ----------------------------------------------
# The release train runs prereleases, which GitHub's /releases/latest endpoint
# skips, so read the releases list and take the newest matching tag unless one
# is pinned.
if [ "${CUELOOP_VERSION:-}" != "" ]; then
  tag="$CUELOOP_VERSION"
else
  spinner_start "finding the latest release"
  # The monorepo tags one release per published package; the CLI (with the
  # binaries attached) is the one tagged `cueloop@<version>`. Take the newest
  # such tag so a sibling package release never gets picked by mistake.
  fetch_to "https://api.github.com/repos/${REPO}/releases?per_page=100" "${temporary_directory}/releases.json" ||
    error "could not reach the GitHub releases API."
  tag="$(grep -m1 '"tag_name"[[:space:]]*:[[:space:]]*"cueloop@' "${temporary_directory}/releases.json" |
    sed -e 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//' -e 's/".*//')"
  [ "$tag" != "" ] || error "no cueloop release found for ${REPO} yet."
  spinner_finish
fi

base="https://github.com/${REPO}/releases/download/${tag}"

# --- download -------------------------------------------------------------
spinner_start "downloading ${BOLD}${asset}${RESET} (${tag})"
fetch_to "${base}/${asset}" "${temporary_directory}/${BINARY}" ||
  error "no binary '${asset}' in release ${tag}. Your platform may not have a prebuilt binary yet - install with npm instead: npm i -g cueloop"
spinner_finish

# --- verify checksum (required) -------------------------------------------
# Our releases always publish checksums.txt. Refuse to install a binary we
# cannot verify rather than trusting an unchecked `curl | sh` download: a
# missing checksum file, a missing entry, or the absence of a sha256 tool are
# all hard failures, not skipped steps.
spinner_start "verifying checksum"
fetch_to "${base}/checksums.txt" "${temporary_directory}/checksums.txt" 2>/dev/null ||
  error "release ${tag} has no checksums.txt; refusing to install an unverified binary."
expected="$(grep " ${asset}\$" "${temporary_directory}/checksums.txt" 2>/dev/null | awk '{print $1}' || true)"
[ "$expected" != "" ] ||
  error "no checksum for ${asset} in release ${tag}; refusing to install an unverified binary."
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${temporary_directory}/${BINARY}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${temporary_directory}/${BINARY}" | awk '{print $1}')"
else
  error "need sha256sum or shasum to verify the download; neither is on PATH."
fi
[ "$actual" = "$expected" ] ||
  error "checksum mismatch for ${asset}. Expected ${expected}, got ${actual}."
spinner_finish
chmod +x "${temporary_directory}/${BINARY}"

# --- choose an install directory ------------------------------------------
# Prefer a per-user dir that survives Node/Bun version switches. Fall back to a
# system dir only when it is already writable, so the install stays sudo-free.
if [ "${CUELOOP_INSTALL_DIR:-}" != "" ]; then
  install_dir="$CUELOOP_INSTALL_DIR"
elif [ -w "/usr/local/bin" ] && [ -d "/usr/local/bin" ]; then
  install_dir="/usr/local/bin"
else
  install_dir="${HOME}/.local/bin"
fi

target="${install_dir}/${BINARY}"
spinner_start "installing ${BOLD}${target}${RESET}"
mkdir -p "$install_dir" || error "cannot create ${install_dir}."
if mv "${temporary_directory}/${BINARY}" "$target" 2>/dev/null; then
  :
else
  error "cannot write ${target}. Re-run with CUELOOP_INSTALL_DIR set to a writable directory."
fi
spinner_finish
# --- PATH hint ------------------------------------------------------------
case ":${PATH}:" in
  *":${install_dir}:"*)
    info "Run ${BOLD}cueloop${RESET} to get started"
    ;;
  *)
    info "${install_dir} is not on your PATH. Add it:"
    printf '\n    export PATH="%s:$PATH"\n\n' "$install_dir" >&2
    info "Then run ${BOLD}cueloop${RESET} to get started"
    ;;
esac

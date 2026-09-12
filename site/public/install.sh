#!/bin/sh
# cueloop installer. Downloads the self-contained cueloop binary (the Bun
# runtime is bundled in, so no Node and no separate Bun install are needed) from
# GitHub Releases, verifies its checksum, and drops it on a stable PATH.
#
#   curl -fsSL https://cueloop.dev/install.sh | sh
#
# Flags:
#   --no-modify-path      print the PATH hint instead of editing your shell rc
#   --help                this text
#
# Overrides (environment variables):
#   CUELOOP_INSTALL_DIR     target directory (default: /usr/local/bin when it is
#                           writable, else ~/.local/bin)
#   CUELOOP_VERSION         a version or release tag to pin, e.g. 0.1.0 or
#                           cueloop@0.1.0 (default: the newest release)
#   CUELOOP_NO_MODIFY_PATH  same as --no-modify-path when set
#   CUELOOP_NO_BANNER       skip the logo
#   CUELOOP_RELEASES_API    the releases listing to read the newest tag from
#   CUELOOP_DOWNLOAD_BASE   the URL below which <tag>/<asset> lives
#
# The script is POSIX sh and runs nothing until the last line, so a truncated
# download dies on a parse error instead of running a prefix. pipefail is on
# where the shell supports it; every download lands in a temp file first.
set -eu
if ( set -o pipefail 2>/dev/null ); then set -o pipefail; fi

REPO="mmurakaru/cueloop"
BINARY="cueloop"
RELEASE_TAG_PREFIX="cueloop@"
RELEASES_API="${CUELOOP_RELEASES_API:-https://api.github.com/repos/${REPO}/releases?per_page=100}"
DOWNLOAD_BASE="${CUELOOP_DOWNLOAD_BASE:-https://github.com/${REPO}/releases/download}"

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
# it finishes. Only animates on a terminal; when stderr is piped or logged we
# print the plain line, so logs stay clean.
SPINNER_FRAMES='⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏'
CHECK_MARK='✓'
spinner_process_id=''
temporary_directory=''
downloader=''

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

# Reserve one terminal cell and a space for the status symbol after the banner indent.
info() { printf '    %s\n' "$*" >&2; }

# spinner_start <message>: begin the spinner for a step. Animates only on a
# capable terminal; otherwise (piped output, or a dumb terminal without
# cursor control) it just prints the plain line so nothing gets garbled.
spinner_start() {
  spinner_message="$1"
  if [ -t 2 ] && [ "${TERM:-}" != "dumb" ]; then
    (
      while :; do
        for frame in $SPINNER_FRAMES; do
          printf '\r  %s %s' "$frame" "$spinner_message" >&2
          sleep 0.08 2>/dev/null || true
        done
      done
    ) &
    spinner_process_id=$!
  else
    info "$spinner_message"
  fi
}

# spinner_stop: end the spinner if one runs and clear its line.
spinner_stop() {
  [ -n "${spinner_process_id:-}" ] || return 0
  kill "$spinner_process_id" 2>/dev/null || true
  wait "$spinner_process_id" 2>/dev/null || true
  spinner_process_id=''
  printf '\r\033[K' >&2
}

# spinner_finish: stop the spinner and stamp the line with a check.
spinner_finish() {
  [ -n "${spinner_process_id:-}" ] || return 0
  spinner_stop
  printf '  %s %s\n' "$CHECK_MARK" "$spinner_message" >&2
}

error() {
  spinner_stop
  printf '%s\n' "${RED}${BOLD}cueloop install failed:${RESET} $*" >&2
  exit 1
}

cleanup() {
  spinner_stop
  if [ -n "${temporary_directory:-}" ]; then rm -rf "$temporary_directory"; fi
}

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

usage() {
  cat >&2 <<'USAGE'
cueloop installer

  curl -fsSL https://cueloop.dev/install.sh | sh
  curl -fsSL https://cueloop.dev/install.sh | sh -s -- --no-modify-path

Flags:
  --no-modify-path        print the PATH line instead of editing your shell rc
  --help                  this text

Environment:
  CUELOOP_INSTALL_DIR     target directory (default: /usr/local/bin when it is
                          writable, else ~/.local/bin)
  CUELOOP_VERSION         a version or release tag to pin, e.g. 0.1.0 or
                          cueloop@0.1.0 (default: the newest release)
  CUELOOP_NO_MODIFY_PATH  same as --no-modify-path when set
  CUELOOP_NO_BANNER       skip the logo
  CUELOOP_RELEASES_API    the releases listing to read the newest tag from
  CUELOOP_DOWNLOAD_BASE   the URL below which <tag>/<asset> lives
USAGE
}

# --- downloads ------------------------------------------------------------
# require_downloader: pick curl or wget once; neither is a hard failure.
require_downloader() {
  if command -v curl >/dev/null 2>&1; then
    downloader=curl
  elif command -v wget >/dev/null 2>&1; then
    downloader=wget
  else
    error "need curl or wget on PATH to download the release."
  fi
}

# fetch_to <url> <file>: fails on any HTTP error.
fetch_to() {
  case "$downloader" in
    curl) curl -fsSL -o "$2" "$1" ;;
    wget) wget -qO "$2" "$1" ;;
  esac
}

# --- platform ---------------------------------------------------------------
# detect_platform: sets `asset` to the release asset name for this machine.
detect_platform() {
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
}

# --- release ----------------------------------------------------------------
# resolve_tag: sets `tag` to the pinned CUELOOP_VERSION or the newest release.
# The release train runs prereleases, which GitHub's /releases/latest endpoint
# skips, so read the releases list and take the newest tag of the CLI package.
resolve_tag() {
  if [ "${CUELOOP_VERSION:-}" != "" ]; then
    case "$CUELOOP_VERSION" in
      "$RELEASE_TAG_PREFIX"*) tag="$CUELOOP_VERSION" ;;
      *) tag="${RELEASE_TAG_PREFIX}${CUELOOP_VERSION}" ;;
    esac
    [ "${tag#"$RELEASE_TAG_PREFIX"}" != "" ] ||
      error "CUELOOP_VERSION must name a version, e.g. 0.1.0 or cueloop@0.1.0."
    return 0
  fi
  spinner_start "finding the latest release"
  fetch_to "$RELEASES_API" "${temporary_directory}/releases.json" ||
    error "could not reach the GitHub releases API."
  tag="$(grep -m1 "\"tag_name\"[[:space:]]*:[[:space:]]*\"${RELEASE_TAG_PREFIX}" "${temporary_directory}/releases.json" |
    sed -e 's/.*"tag_name"[[:space:]]*:[[:space:]]*"//' -e 's/".*//')"
  [ "$tag" != "" ] || error "no cueloop release found for ${REPO} yet."
  spinner_finish
}

# installed_version <binary>: what an existing binary reports, or nothing.
installed_version() {
  [ -x "$1" ] || return 0
  "$1" --version 2>/dev/null | head -n 1 || true
}

# --- install directory ------------------------------------------------------
# A system dir when it is already writable (no sudo, on every PATH), else a
# per-user dir that survives Node and Bun version switches.
choose_install_dir() {
  if [ "${CUELOOP_INSTALL_DIR:-}" != "" ]; then
    install_dir="$CUELOOP_INSTALL_DIR"
  elif [ -w "/usr/local/bin" ] && [ -d "/usr/local/bin" ]; then
    install_dir="/usr/local/bin"
  else
    install_dir="${HOME}/.local/bin"
  fi
}

# --- download and verify ----------------------------------------------------
download_binary() {
  spinner_start "downloading ${BOLD}${asset}${RESET} (${tag})"
  fetch_to "${DOWNLOAD_BASE}/${tag}/${asset}" "${temporary_directory}/${BINARY}" ||
    error "no binary '${asset}' in release ${tag}. Your platform may not have a prebuilt binary yet - install with npm instead: npm i -g cueloop"
  spinner_finish
}

# Our releases always publish checksums.txt. Refuse to install a binary we
# cannot verify rather than trusting an unchecked `curl | sh` download: a
# missing checksum file, a missing entry, or the absence of a sha256 tool are
# all hard failures, not skipped steps.
verify_checksum() {
  spinner_start "verifying checksum"
  fetch_to "${DOWNLOAD_BASE}/${tag}/checksums.txt" "${temporary_directory}/checksums.txt" 2>/dev/null ||
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
}

install_binary() {
  spinner_start "installing ${BOLD}${target}${RESET}"
  mkdir -p "$install_dir" || error "cannot create ${install_dir}."
  mv "${temporary_directory}/${BINARY}" "$target" 2>/dev/null ||
    error "cannot write ${target}. Re-run with CUELOOP_INSTALL_DIR set to a writable directory."
  spinner_finish
}

# --- PATH -------------------------------------------------------------------
# squote <text>: single-quote text for a shell rc line.
squote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# first_existing <file>...: the first path that exists, else the first given.
first_existing() {
  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  printf '%s' "$1"
}

# add_path_line <rc file> <line>: append once; a rerun finds the exact line.
add_path_line() {
  if [ -f "$1" ] && grep -qxF "$2" "$1"; then return 0; fi
  mkdir -p "$(dirname "$1")"
  printf '\n%s\n' "$2" >> "$1"
}

# modify_path: put the install dir on PATH for the user's login shell, once.
modify_path() {
  if [ -n "${GITHUB_PATH:-}" ]; then
    printf '%s\n' "$install_dir" >> "$GITHUB_PATH"
    info "Added ${install_dir} to GITHUB_PATH"
    return 0
  fi
  quoted="$(squote "$install_dir")"
  case "$(basename "${SHELL:-sh}")" in
    zsh)
      rc_file="${ZDOTDIR:-$HOME}/.zshrc"
      add_path_line "$rc_file" "export PATH=${quoted}:\"\$PATH\""
      ;;
    bash)
      rc_file="$(first_existing "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile")"
      add_path_line "$rc_file" "export PATH=${quoted}:\"\$PATH\""
      ;;
    fish)
      rc_file="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      add_path_line "$rc_file" "fish_add_path ${quoted}"
      ;;
    *)
      rc_file="$HOME/.profile"
      add_path_line "$rc_file" "export PATH=${quoted}:\"\$PATH\""
      ;;
  esac
  info "Added ${install_dir} to PATH in ${rc_file}; open a new shell, then run ${BOLD}cueloop${RESET}"
}

path_hint() {
  info "${install_dir} is not on your PATH. Add it:"
  printf '\n    export PATH="%s:$PATH"\n\n' "$install_dir" >&2
  info "Then run ${BOLD}cueloop${RESET} to get started"
}

finish_path() {
  case ":${PATH}:" in
    *":${install_dir}:"*) info "Run ${BOLD}cueloop${RESET} to get started" ;;
    *)
      if [ "$edit_rc" = "1" ]; then modify_path; else path_hint; fi
      ;;
  esac
}

main() {
  edit_rc=1
  if [ "${CUELOOP_NO_MODIFY_PATH:-}" != "" ]; then edit_rc=0; fi
  for argument in "$@"; do
    case "$argument" in
      --no-modify-path) edit_rc=0 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *) error "unknown flag '${argument}'. Run with --help for the options." ;;
    esac
  done

  [ -n "${HOME:-}" ] || error "HOME is not set; cannot choose an install directory."
  require_downloader
  banner
  detect_platform
  temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/cueloop.XXXXXX")"
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT
  trap 'cleanup; exit 143' TERM
  resolve_tag
  choose_install_dir
  target="${install_dir}/${BINARY}"

  version="${tag#"$RELEASE_TAG_PREFIX"}"
  if [ "$(installed_version "$target")" = "$version" ]; then
    info "cueloop ${version} is already installed at ${target}."
    finish_path
    return 0
  fi

  download_binary
  verify_checksum
  install_binary
  finish_path
}

main "$@"

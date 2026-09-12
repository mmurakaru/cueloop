#!/bin/sh
# shell-rc: the installer edits the right rc file for each login shell and does
# it once. For bash, zsh, and fish (all baked into the guest rootfs), install
# twice under a fresh HOME, then source that shell's rc and prove cueloop
# resolves and the PATH line appears exactly once.
set -u
. "$(dirname "$0")/lib.sh"

expect rc-bash rc-zsh rc-fish

# rc_case <evidence-id> <shell> <shell-path> <rc-file-rel> <resolve-cmd>
rc_case() {
  evidence="$1"
  shell_name="$2"
  shell_path="$3"
  rc_relative="$4"
  resolve_cmd="$5"

  if [ ! -x "$shell_path" ]; then
    bad "$evidence" "$shell_name is not installed in the guest"
    return
  fi

  home="$MATRIX_SANDBOX/rc-$shell_name-home"
  install_dir="$MATRIX_SANDBOX/rc-$shell_name-bin"
  rm -rf "$home" "$install_dir"
  mkdir -p "$home"

  MATRIX_HOME="$home"
  MATRIX_INSTALL_DIR="$install_dir"
  MATRIX_SHELL="$shell_path"
  MATRIX_NO_MODIFY_PATH=""
  run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/rc-$shell_name-1.log"
  run_installer "${CUELOOP_VERSION:-}" "$MATRIX_SANDBOX/rc-$shell_name-2.log"

  rc_file="$home/$rc_relative"
  count="$(grep -c "$install_dir" "$rc_file" 2>/dev/null || echo 0)"
  if HOME="$home" "$shell_path" -c "$resolve_cmd" >/dev/null 2>&1 && [ "$count" = "1" ]; then
    ok "$evidence"
  else
    bad "$evidence" "$shell_name: resolve or single-line check failed (count=$count)"
  fi
}

rc_case rc-bash bash /bin/bash ".bashrc" '. "$HOME/.bashrc" 2>/dev/null; command -v cueloop'
rc_case rc-zsh zsh /usr/bin/zsh ".zshrc" '. "$HOME/.zshrc" 2>/dev/null; command -v cueloop'
rc_case rc-fish fish /usr/bin/fish ".config/fish/config.fish" 'source $HOME/.config/fish/config.fish 2>/dev/null; type -q cueloop'

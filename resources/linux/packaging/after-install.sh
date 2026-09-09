#!/bin/bash
# Why: register the bundled `alicorn-ide` CLI on PATH at package-install time.
# The in-app "Install CLI" action (CliInstaller) can never run on a headless
# server, so without this symlink `alicorn-ide serve` is unreachable from the shell on
# the exact hosts that need it most. deb/rpm both run this after unpacking.
#
# The shim resolves the real app by walking up from its own location, so a
# symlink works. We discover the install dir instead of hardcoding /opt/Orca
# because electron-builder's directory name can vary by productName sanitization.
#
# Both command names are linked: `alicorn-ide` is the current one, `orca-ide` keeps shells
# and scripts written before the rebrand working for one release.
set -e

install_dirs="/opt/Alicorn /opt/alicorn-ide /opt/alicorn /opt/Orca /opt/orca-ide /opt/orca"
command_names="alicorn-ide orca-ide"

is_owned_link() {
  link=$1
  [ -L "$link" ] || return 1
  link_target="$(readlink -f -- "$link" 2>/dev/null || true)"
  [ -n "$link_target" ] || return 1
  for dir in $install_dirs; do
    for shim_name in $command_names; do
      candidate_target="$(readlink -f -- "$dir/resources/bin/$shim_name" 2>/dev/null || true)"
      if [ -n "$candidate_target" ] && [ "$link_target" = "$candidate_target" ]; then
        return 0
      fi
    done
  done
  return 1
}

for dir in $install_dirs; do
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    # Why: packaged Linux installs must leave Chromium's sandbox helper usable
    # on hosts where unprivileged user namespaces are unavailable.
    chmod 4755 "$sandbox" || true
  fi

  shim="$dir/resources/bin/alicorn-ide"
  if [ -x "$shim" ]; then
    for command_name in $command_names; do
      link="/usr/bin/$command_name"
      # Only manage our own symlink; never clobber an unrelated /usr/bin entry.
      if { [ ! -e "$link" ] && [ ! -L "$link" ]; } || is_owned_link "$link"; then
        ln -sfn -- "$shim" "$link"
      fi
    done
    break
  fi
done

exit 0

#!/bin/bash
# Why: remove the PATH symlinks that after-install.sh created, but only if they
# still point into one of our install dirs — never delete an unrelated
# /usr/bin/alicorn-ide or /usr/bin/orca-ide a user or other package may own.
set -e

# RPM passes an instance count; dpkg passes the package lifecycle action.
case "${1-}" in
  0 | remove | purge) ;;
  *) exit 0 ;;
esac

for command_name in alicorn-ide orca-ide; do
  link="/usr/bin/$command_name"
  [ -L "$link" ] || continue
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/Alicorn/*|/opt/alicorn-ide/*|/opt/alicorn/*|/opt/Orca/*|/opt/orca-ide/*|/opt/orca/*)
      rm -f "$link"
      ;;
  esac
done

exit 0

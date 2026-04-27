#!/usr/bin/env bash
# Open the Winnow web UI in an embedded Electron window (see: winnow ui --shell).
# Installed into ~/.local/bin by scripts/setup.sh (symlink) so you can run `winnow-ui` from any directory.

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

cd "$REPO_ROOT"
exec npm run ui -- --shell "$@"

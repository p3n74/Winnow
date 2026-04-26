#!/usr/bin/env bash
set -euo pipefail

TARGET_NODE_MAJOR=22

ensure_node_supported() {
  local current_major
  current_major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "${current_major}" -ge 20 ]; then
    return 0
  fi

  unset npm_config_prefix || true

  if command -v nvm >/dev/null 2>&1; then
    nvm install "${TARGET_NODE_MAJOR}" >/dev/null
    nvm use "${TARGET_NODE_MAJOR}" >/dev/null
    return 0
  fi

  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1090
    source "${HOME}/.nvm/nvm.sh" --no-use
    nvm install "${TARGET_NODE_MAJOR}" >/dev/null
    nvm use "${TARGET_NODE_MAJOR}" >/dev/null
    return 0
  fi

  if [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    mkdir -p "${NVM_DIR}"
    # shellcheck disable=SC1091
    source "/opt/homebrew/opt/nvm/nvm.sh" --no-use
    nvm install "${TARGET_NODE_MAJOR}" >/dev/null
    nvm use "${TARGET_NODE_MAJOR}" >/dev/null
    return 0
  fi

  echo "[winnow-ui] ERROR: Node $(node -v) is unsupported and nvm was not found."
  echo "[winnow-ui] Run: npm run setup"
  exit 1
}

ensure_node_supported

ensure_pty() {
  if node -e "import pty from 'node-pty'; try { const p=pty.spawn('/bin/zsh',['-c','exit'],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:process.env}); p.onExit(()=>process.exit(0)); } catch { process.exit(1); }" >/dev/null 2>&1; then
    return 0
  fi
  echo "[winnow-ui] Rebuilding node-pty for this system..."
  npm rebuild node-pty --build-from-source >/dev/null
  if ! node -e "import pty from 'node-pty'; try { const p=pty.spawn('/bin/zsh',['-c','exit'],{name:'xterm-256color',cols:80,rows:24,cwd:process.cwd(),env:process.env}); p.onExit(()=>process.exit(0)); } catch { process.exit(1); }" >/dev/null 2>&1; then
    echo "[winnow-ui] ERROR: node-pty still failed after rebuild."
    echo "[winnow-ui] Run: npm run setup"
    exit 1
  fi
}

ensure_pty
echo "[winnow-ui] using node $(node -v)"
exec npx tsx src/cli/index.ts ui "$@"

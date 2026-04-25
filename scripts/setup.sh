#!/usr/bin/env bash
set -euo pipefail

TARGET_NODE_MAJOR=22

echo "[winnow-setup] Starting setup..."
unset npm_config_prefix || true

if command -v nvm >/dev/null 2>&1; then
  echo "[winnow-setup] nvm detected. Installing/using Node ${TARGET_NODE_MAJOR}..."
  nvm install "${TARGET_NODE_MAJOR}"
  nvm use "${TARGET_NODE_MAJOR}"
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh" --no-use
  echo "[winnow-setup] nvm loaded from ~/.nvm. Installing/using Node ${TARGET_NODE_MAJOR}..."
  nvm install "${TARGET_NODE_MAJOR}"
  nvm use "${TARGET_NODE_MAJOR}"
elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  mkdir -p "${NVM_DIR}"
  # shellcheck disable=SC1091
  source "/opt/homebrew/opt/nvm/nvm.sh" --no-use
  echo "[winnow-setup] nvm loaded from Homebrew. Installing/using Node ${TARGET_NODE_MAJOR}..."
  nvm install "${TARGET_NODE_MAJOR}"
  nvm use "${TARGET_NODE_MAJOR}"
else
  current_major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "${current_major}" -lt 20 ] || [ "${current_major}" -ge 23 ]; then
    echo "[winnow-setup] ERROR: Node version $(node -v) is unsupported and nvm is not available."
    echo "[winnow-setup] Install nvm or switch to Node 22, then rerun setup."
    exit 1
  fi
fi

echo "[winnow-setup] Using node $(node -v)"
echo "[winnow-setup] Installing dependencies..."
npm install
echo "[winnow-setup] Rebuilding node-pty for local macOS toolchain..."
npm rebuild node-pty --build-from-source
echo "[winnow-setup] Setup complete."

#!/usr/bin/env bash
set -euo pipefail

TARGET_NODE_MAJOR=22

echo "[winnow-setup] Starting setup..."
unset npm_config_prefix || true

OS="$(uname -s)"

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  echo "[winnow-setup] ERROR: Homebrew is required to install system dependencies on macOS."
  echo "[winnow-setup] Install Homebrew from https://brew.sh then rerun setup."
  exit 1
}

ensure_brew_pkg() {
  local pkg="$1"
  if brew list --versions "${pkg}" >/dev/null 2>&1; then
    echo "[winnow-setup] ${pkg} already installed."
    return 0
  fi
  echo "[winnow-setup] Installing ${pkg}..."
  brew install "${pkg}"
}

ensure_brew_cask() {
  local cask="$1"
  if brew list --cask --versions "${cask}" >/dev/null 2>&1; then
    echo "[winnow-setup] ${cask} already installed."
    return 0
  fi
  echo "[winnow-setup] Installing ${cask}..."
  brew install --cask "${cask}"
}

install_system_dependencies() {
  echo "[winnow-setup] Installing system dependencies..."
  case "${OS}" in
    Darwin)
      ensure_homebrew
      ensure_brew_pkg "ranger"
      ensure_brew_pkg "htop"
      ensure_brew_pkg "netwatch"
      ensure_brew_cask "cursor"
      ;;
    *)
      echo "[winnow-setup] WARNING: Auto-install for ${OS} is not configured."
      echo "[winnow-setup] Please install these manually and rerun setup if needed:"
      echo "  - ranger"
      echo "  - htop"
      echo "  - netwatch"
      echo "  - cursor"
      ;;
  esac
}

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
install_system_dependencies
echo "[winnow-setup] Installing dependencies..."
npm install
echo "[winnow-setup] Rebuilding node-pty for local macOS toolchain..."
npm rebuild node-pty --build-from-source
echo "[winnow-setup] Setup complete."

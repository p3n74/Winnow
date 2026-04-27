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

install_system_dependencies() {
  echo "[winnow-setup] Installing system dependencies..."
  case "${OS}" in
    Darwin)
      ensure_homebrew
      ensure_brew_pkg "ranger"
      ensure_brew_pkg "htop"
      ;;
    *)
      echo "[winnow-setup] WARNING: Auto-install for ${OS} is not configured."
      echo "[winnow-setup] Please install these manually and rerun setup if needed:"
      echo "  - ranger"
      echo "  - htop"
      echo "  - Cursor Agent CLI: https://cursor.com/docs/cli/overview"
      ;;
  esac
}

ensure_cursor_agent_cli() {
  export PATH="${HOME}/.local/bin:${PATH}"
  if command -v cursor-agent >/dev/null 2>&1; then
    echo "[winnow-setup] cursor-agent already on PATH ($(command -v cursor-agent))."
    return 0
  fi
  case "${OS}" in
    Darwin|Linux)
      echo "[winnow-setup] Installing Cursor Agent CLI (cursor-agent) from cursor.com…"
      curl -fsSL https://cursor.com/install | bash
      export PATH="${HOME}/.local/bin:${PATH}"
      if command -v cursor-agent >/dev/null 2>&1; then
        echo "[winnow-setup] cursor-agent is available ($(command -v cursor-agent))."
        return 0
      fi
      echo "[winnow-setup] WARNING: cursor-agent not on PATH after install. Add ~/.local/bin to PATH (see installer output) and open a new terminal."
      ;;
    *)
      echo "[winnow-setup] WARNING: Cursor Agent CLI auto-install is only wired for macOS and Linux."
      echo "[winnow-setup] Install manually: https://cursor.com/docs/cli/overview"
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
  if [ "${current_major}" -lt 20 ]; then
    echo "[winnow-setup] ERROR: Node version $(node -v) is unsupported and nvm is not available."
    echo "[winnow-setup] Install nvm or upgrade to Node 20+, then rerun setup."
    exit 1
  fi
fi

echo "[winnow-setup] Using node $(node -v)"
install_system_dependencies
ensure_cursor_agent_cli
echo "[winnow-setup] Installing dependencies..."
npm install
echo "[winnow-setup] Rebuilding node-pty for local macOS toolchain..."
npm rebuild node-pty --build-from-source

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_winnow_ui_launcher() {
  local bin_dir="${HOME}/.local/bin"
  local target_script="${REPO_ROOT}/scripts/winnow-ui.sh"
  local link_path="${bin_dir}/winnow-ui"
  mkdir -p "${bin_dir}"
  chmod +x "${target_script}" 2>/dev/null || true
  if ln -sf "${target_script}" "${link_path}" 2>/dev/null; then
    echo "[winnow-setup] Installed UI launcher: ${link_path} -> scripts/winnow-ui.sh"
    echo "[winnow-setup] Run: winnow-ui   (Electron window; same as: npm run ui -- --shell)"
  else
    echo "[winnow-setup] WARNING: could not symlink winnow-ui into ${bin_dir}."
  fi
  if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
    echo "[winnow-setup] Add ${bin_dir} to PATH (Cursor CLI uses the same layout), for example in ~/.zprofile:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
}

install_winnow_ui_launcher

echo "[winnow-setup] Setup complete."

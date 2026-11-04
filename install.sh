#!/usr/bin/env bash
#
# AXION AI Agents CLI - installer
# Works on Termux and Unix-like systems.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh | bash
#
set -euo pipefail

REPO_URL="https://github.com/azrielspace852-wq/axion-ai-agents-cli"
BRANCH="main"
APP_DIR="${AXION_INSTALL_DIR:-$HOME/.axion/app}"

c_red=$'\033[31m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_cyan=$'\033[36m'; c_reset=$'\033[0m'
info()  { printf "%s[INFO]%s %s\n" "$c_cyan"   "$c_reset" "$*"; }
ok()    { printf "%s[ OK ]%s %s\n" "$c_green"  "$c_reset" "$*"; }
warn()  { printf "%s[WARN]%s %s\n" "$c_yellow" "$c_reset" "$*"; }
fail()  { printf "%s[FAIL]%s %s\n" "$c_red"    "$c_reset" "$*"; exit 1; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

info "AXION AI Agents CLI installer"

# --- 1. Dependencies -------------------------------------------------------
command_exists node || fail "Node.js is required. Install it first (e.g. 'pkg install nodejs' on Termux)."
command_exists npm  || fail "npm is required."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js >= 18 (LTS) is required. Found: $(node -v)"
fi
ok "Node.js $(node -v) and npm $(npm -v) detected"

# --- 2. Obtain source ------------------------------------------------------
SRC_DIR=""
if [ -f "package.json" ] && grep -q "axion-ai-agents-cli" package.json 2>/dev/null; then
  SRC_DIR="$(pwd)"
  info "Using current directory as source: $SRC_DIR"
else
  info "Downloading source from $REPO_URL ($BRANCH)..."
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  if command_exists git; then
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/axion" || fail "git clone failed"
  else
    TARBALL="$TMP_DIR/axion.tar.gz"
    curl -fsSL "$REPO_URL/archive/refs/heads/$BRANCH.tar.gz" -o "$TARBALL" || fail "download failed"
    mkdir -p "$TMP_DIR/axion"
    tar -xzf "$TARBALL" -C "$TMP_DIR/axion" --strip-components=1 || fail "extract failed"
  fi
  SRC_DIR="$APP_DIR"
  mkdir -p "$(dirname "$SRC_DIR")"
  rm -rf "$SRC_DIR"
  cp -R "$TMP_DIR/axion" "$SRC_DIR"
  ok "Source placed at $SRC_DIR"
fi

# --- 3. Install & build ----------------------------------------------------
cd "$SRC_DIR"
info "Installing dependencies (npm install)..."
npm install --no-audit --no-fund || fail "npm install failed"

info "Compiling TypeScript (npm run build)..."
npm run build || fail "build failed"

chmod +x "$SRC_DIR/dist/index.js"
ok "Build complete"

# --- 4. Link binary into PATH ---------------------------------------------
pick_bin_dir() {
  if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ]; then echo "$PREFIX/bin"; return; fi  # Termux
  if [ -d "$HOME/.local/bin" ]; then echo "$HOME/.local/bin"; return; fi
  if [ -w "/usr/local/bin" ]; then echo "/usr/local/bin"; return; fi
  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

BIN_DIR="$(pick_bin_dir)"
mkdir -p "$BIN_DIR"
ln -sf "$SRC_DIR/dist/index.js" "$BIN_DIR/axion-cli"
ok "Linked axion-cli -> $BIN_DIR/axion-cli"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not in your PATH. Add: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

echo
ok "AXION AI Agents CLI installed successfully!"
info "Run it with: axion-cli"
info "Config & data live in ~/.axn-cli"
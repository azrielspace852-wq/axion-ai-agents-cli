#!/usr/bin/env bash
# AXION AI Agents CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh | bash

set -Eeuo pipefail

REPO_URL="https://github.com/azrielspace852-wq/axion-ai-agents-cli"
BRANCH="main"
APP_DIR="${AXION_INSTALL_DIR:-$HOME/.axion/app}"

c_red=$'\033[31m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_cyan=$'\033[36m'; c_reset=$'\033[0m'
info() { printf '%s[INFO]%s %s\n' "$c_cyan" "$c_reset" "$*"; }
ok()   { printf '%s[ OK ]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$c_yellow" "$c_reset" "$*"; }
fail() { printf '%s[FAIL]%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

info "AXION AI Agents CLI installer"

# --- 1. Validate prerequisites ---------------------------------------------
command_exists node || fail "Node.js is required. Install Node.js 18.17 or newer first (for example: pkg install nodejs on Termux)."
command_exists npm || fail "npm is required but was not found. Install the npm package that matches your Node.js installation."
command_exists tar || fail "tar is required to unpack the project source."

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 18 ] || { [ "$NODE_MAJOR" -eq 18 ] && [ "$NODE_MINOR" -lt 17 ]; }; then
  fail "Node.js >= 18.17.0 is required. Found: v$NODE_VERSION"
fi
ok "Node.js v$NODE_VERSION and npm $(npm -v) detected"

# Normalize the installation path and refuse dangerous targets.
case "$APP_DIR" in
  /*) ;;
  *) APP_DIR="$PWD/$APP_DIR" ;;
esac
APP_PARENT="$(dirname "$APP_DIR")"
APP_NAME="$(basename "$APP_DIR")"
[ -n "$APP_NAME" ] && [ "$APP_NAME" != "." ] && [ "$APP_NAME" != ".." ] || fail "Invalid AXION_INSTALL_DIR: $APP_DIR"
mkdir -p "$APP_PARENT" || fail "Cannot create install parent directory: $APP_PARENT"
APP_PARENT="$(cd "$APP_PARENT" && pwd -P)"
APP_DIR="$APP_PARENT/$APP_NAME"
[ "$APP_DIR" != "/" ] || fail "Refusing to install to filesystem root."
[ "$APP_DIR" != "$(cd "$HOME" && pwd -P)" ] || fail "Refusing to use the home directory itself as the application directory."

# Work only in a temporary directory until install and build checks succeed.
TMP_DIR="$(mktemp -d)" || fail "Could not create a temporary directory."
STAGE_DIR="$APP_PARENT/.${APP_NAME}.stage.$$"
BACKUP_DIR="$APP_PARENT/.${APP_NAME}.backup.$$"
cleanup() {
  rm -rf -- "$TMP_DIR" "$STAGE_DIR"
}
trap cleanup EXIT

# --- 2. Obtain source -------------------------------------------------------
SOURCE_DIR=""
if [ -f "$PWD/package.json" ] && grep -q '"name"[[:space:]]*:[[:space:]]*"axion-ai-agents-cli"' "$PWD/package.json" && [ -f "$PWD/src/index.ts" ]; then
  SOURCE_DIR="$PWD"
  info "Using project source from: $SOURCE_DIR"
else
  info "Downloading source from $REPO_URL ($BRANCH)..."
  if command_exists curl; then
    if curl -fsSL --retry 2 --connect-timeout 15 "$REPO_URL/archive/refs/heads/$BRANCH.tar.gz" -o "$TMP_DIR/source.tar.gz"; then
      mkdir -p "$TMP_DIR/source"
      tar -xzf "$TMP_DIR/source.tar.gz" -C "$TMP_DIR/source" --strip-components=1 || fail "Could not extract the source archive."
    elif command_exists git; then
      warn "Source archive download failed; trying a shallow Git clone as a fallback."
      git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/source" || fail "Source download failed. Check the network connection and repository access."
    else
      fail "Source download failed and git is not available as a fallback."
    fi
  elif command_exists git; then
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/source" || fail "Git clone failed. Check the repository URL, branch, and network connection."
  else
    fail "Neither curl nor git is available to download the project."
  fi
  SOURCE_DIR="$TMP_DIR/source"
fi

[ -f "$SOURCE_DIR/package.json" ] && [ -f "$SOURCE_DIR/src/index.ts" ] || fail "The downloaded source does not look like an AXION AI Agents CLI project."

# Copy without carrying over local build artifacts or installed dependencies.
mkdir -p "$STAGE_DIR"
tar -C "$SOURCE_DIR" \
  --exclude='./.git' --exclude='./node_modules' --exclude='./dist' \
  -cf - . | tar -C "$STAGE_DIR" -xf -

# --- 3. Install dependencies and build in staging --------------------------
cd "$STAGE_DIR"
if [ -f package-lock.json ]; then
  info "Installing locked dependencies (npm ci)..."
  npm ci --no-audit --no-fund || fail "Dependency installation failed (npm ci)."
else
  info "Installing dependencies (npm install)..."
  npm install --no-audit --no-fund || fail "Dependency installation failed (npm install)."
fi

info "Building and running regression tests (npm test)..."
npm test || fail "Build or regression tests failed. The previous installation has been left untouched."
[ -f "$STAGE_DIR/dist/index.js" ] || fail "Build completed without producing dist/index.js."
chmod +x "$STAGE_DIR/dist/index.js"
node "$STAGE_DIR/dist/index.js" --version >/dev/null || fail "CLI smoke test failed after build."
ok "Dependencies installed, build/tests completed, and CLI smoke test passed"

# --- 4. Preflight command destination ---------------------------------------
pick_bin_dir() {
  if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ] && [ -w "$PREFIX/bin" ]; then
    printf '%s\n' "$PREFIX/bin"; return
  fi
  if [ -d "$HOME/.local/bin" ] && [ -w "$HOME/.local/bin" ]; then
    printf '%s\n' "$HOME/.local/bin"; return
  fi
  if [ -w "/usr/local/bin" ]; then
    printf '%s\n' "/usr/local/bin"; return
  fi
  mkdir -p "$HOME/.local/bin" || fail "Could not create $HOME/.local/bin."
  [ -w "$HOME/.local/bin" ] || fail "No writable directory is available for the axion-cli command."
  printf '%s\n' "$HOME/.local/bin"
}

BIN_DIR="$(pick_bin_dir)"
COMMAND_LINK="$BIN_DIR/axion-cli"
if [ -e "$COMMAND_LINK" ] && [ ! -L "$COMMAND_LINK" ]; then
  fail "Refusing to overwrite an existing non-symlink command: $COMMAND_LINK"
fi

# --- 5. Replace application directory safely -------------------------------
if [ -e "$APP_DIR" ] || [ -L "$APP_DIR" ]; then
  mv "$APP_DIR" "$BACKUP_DIR" || fail "Could not move the previous installation aside. It has not been deleted."
fi
if ! mv "$STAGE_DIR" "$APP_DIR"; then
  if [ -e "$BACKUP_DIR" ]; then mv "$BACKUP_DIR" "$APP_DIR" || warn "Automatic rollback failed; previous installation remains at $BACKUP_DIR"; fi
  fail "Could not activate the new installation."
fi

# --- 6. Create command link -------------------------------------------------
ln -sfn "$APP_DIR/dist/index.js" "$COMMAND_LINK" || fail "Could not create command link at $COMMAND_LINK"
ok "Command linked: $COMMAND_LINK"

if [ -e "$BACKUP_DIR" ]; then
  warn "Previous application files were retained at: $BACKUP_DIR"
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not in PATH. Add this line to your shell profile: export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

printf '\n'
ok "AXION AI Agents CLI installed successfully."
info "Run: axion-cli"
info "Application: $APP_DIR"
info "Configuration and user data: $HOME/.axn-cli"

#!/usr/bin/env bash
# AXION AI CLI — npmjs installer
# Usage: bash install.sh

set -Eeuo pipefail

PACKAGE_NAME='@axion-neuralis/axion-ai-cli'
REGISTRY_URL='https://registry.npmjs.org/'

info() { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[ OK ] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail 'Node.js 18.17 or newer is required.'
command -v npm >/dev/null 2>&1 || fail 'npm is required. Install the npm package that matches your Node.js installation.'

NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(printf '%s' "$NODE_VERSION" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 18 ] || { [ "$NODE_MAJOR" -eq 18 ] && [ "$NODE_MINOR" -lt 17 ]; }; then
  fail "Node.js >= 18.17.0 is required. Found: v$NODE_VERSION"
fi

info "Installing ${PACKAGE_NAME}@latest from npmjs..."
npm install --global "${PACKAGE_NAME}@latest" --registry "$REGISTRY_URL" || fail 'npm installation failed. Check registry access and your npm global install permissions.'

if command -v axion-ai-cli >/dev/null 2>&1; then
  VERSION="$(axion-ai-cli --version 2>/dev/null || true)"
  ok "AXION AI CLI installed${VERSION:+ (version ${VERSION})}."
  info 'Run: axion-ai-cli'
else
  ok 'npm completed installation.'
  info 'The global npm bin directory may not be on PATH. Run `npm bin -g` (or inspect `npm prefix -g`) and update PATH.'
fi
info "Package: ${PACKAGE_NAME}"
info "Registry: ${REGISTRY_URL}"
info 'Existing user data in ~/.axn-cli is not modified by npm package installation.'

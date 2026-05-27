#!/usr/bin/env bash
set -euo pipefail

NVM_VERSION="${NVM_VERSION:-v0.40.3}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  command -v curl >/dev/null 2>&1 || {
    echo "curl is required to install nvm" >&2
    exit 1
  }
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
fi

. "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
node --version
npm install -g pnpm@11
pnpm --version
echo "READY"

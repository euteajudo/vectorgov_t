#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found. Run apps/web-ui/scripts/wsl-setup-node.sh first." >&2
  exit 1
fi
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null || nvm install 22

SRC="${SRC:-$REPO_ROOT}"
DEST="${DEST:-$HOME/vectorgov-t-build}"

echo "=== Copiando source pra $DEST (excluindo node_modules/.next/.git) ==="
mkdir -p "$DEST"
rsync -a --delete \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.open-next \
  --exclude=.git \
  --exclude=.turbo \
  --exclude=.wrangler \
  --exclude=dist \
  --exclude=coverage \
  "$SRC/" "$DEST/"

cd "$DEST"

echo "=== Instalando deps (Linux) ==="
pnpm install --frozen-lockfile

cd apps/web-ui

echo "=== Build OpenNext ==="
NEXT_PUBLIC_MCP_BASE_URL=https://vectorgov-t-mcp.souzat19.workers.dev \
NEXT_PUBLIC_MCP_WORKER_URL=https://vectorgov-t-mcp.souzat19.workers.dev \
pnpm pages:build

echo "=== Copiando .open-next de volta pro Windows ==="
rm -rf "$SRC/apps/web-ui/.open-next"
cp -r .open-next "$SRC/apps/web-ui/.open-next"

echo "DONE — agora rode 'pnpm pages:deploy' do Windows"

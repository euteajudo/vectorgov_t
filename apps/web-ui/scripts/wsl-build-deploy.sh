#!/usr/bin/env bash
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

SRC=/mnt/d/2026/vectorgov-t
DEST=~/vectorgov-t-build

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

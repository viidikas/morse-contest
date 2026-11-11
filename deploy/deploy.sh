#!/bin/sh
# Run on the server, from the repository folder: fetches the latest version,
# builds it and restarts the app. Running sessions are lost on restart.
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

git pull --ff-only
cd app
npm ci --no-audit --no-fund
npm run build
cd ..
sh deploy/stop.sh
sh deploy/start.sh

#!/bin/sh
# Starts the app on the hosting account if it is not already running.
# Safe to call repeatedly, so it can also be run from cron as a watchdog.
#
# Settings (port, secret, session timing) are read from ~/morse-contest.env,
# which lives only on the server and is never committed.

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/morse-contest.env"
PID_FILE="$HOME/morse-contest.pid"
LOG_FILE="$HOME/morse-contest.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  exit 0
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

cd "$APP_DIR/app" || exit 1
nohup node dist/server/main.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "started, pid $(cat "$PID_FILE")"

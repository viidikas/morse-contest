#!/bin/sh
# Stops the app started by start.sh. Only the recorded process is touched.

PID_FILE="$HOME/morse-contest.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "not running (no pid file)"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped pid $PID"
else
  echo "not running (stale pid $PID)"
fi
rm -f "$PID_FILE"

#!/bin/bash
PIDFILE=".dev.pid"
if [ ! -f "$PIDFILE" ]; then
  echo "No .dev.pid file found — dev server not running?"
  exit 0
fi
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  echo "Stopping dev server (PID $PID)..."
  kill -- -"$PID" 2>/dev/null
  rm -f "$PIDFILE"
  echo "Stopped."
else
  echo "Process $PID not running — cleaning up stale pidfile."
  rm -f "$PIDFILE"
fi

#!/bin/bash
# Dev server launcher with PID tracking for clean shutdown.
# Kills any previous dev server, writes PID file, runs server+client,
# and cleans up on exit.

PIDFILE=".dev.pid"

# Kill previous instance if running
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Killing previous dev server (PID $OLD_PID)..."
    kill -- -"$OLD_PID" 2>/dev/null
    sleep 1
  fi
  rm -f "$PIDFILE"
fi

# Write our PID (process group leader)
echo $$ > "$PIDFILE"

# Clean up on exit
cleanup() {
  rm -f "$PIDFILE"
  kill 0 2>/dev/null  # kill all processes in our group
}
trap cleanup EXIT INT TERM

# Start server and client
npm run dev:server &
npm run dev:client &

# Wait for both
wait

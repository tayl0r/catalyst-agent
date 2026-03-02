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
    # Wait for process to actually exit (up to 5s)
    for _ in $(seq 1 10); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.5
    done
  fi
  rm -f "$PIDFILE"
fi

# Write our PID (process group leader)
echo $$ > "$PIDFILE"

# Clean up on exit
cleanup() {
  rm -f "$PIDFILE"
  # Kill all processes in our group (the backgrounded pnpm processes)
  kill -- -$$ 2>/dev/null
}
trap cleanup EXIT INT TERM

# Start server and client (redirect stdin to prevent SIGTTIN from job control)
pnpm run dev:server </dev/null &
pnpm run dev:client </dev/null &

# Wait for both
wait

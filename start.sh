#!/bin/bash
# Dev server start script for cc-web.
# Uses __PORT_N__ template variables — replaced with real port numbers
# in start.local.sh (auto-generated per worktree).
#
# Delegates to scripts/dev.sh for PID tracking and clean shutdown.

export CATAGENT_SERVER_PORT=__PORT_1__
export CATAGENT_CLIENT_PORT=__PORT_2__

exec bash scripts/dev.sh

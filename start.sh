#!/bin/bash
# Dev server start script for cc-web.
# Uses __PORT_N__ template variables — replaced with real port numbers
# in start.local.sh (auto-generated per worktree).

set -m

export CATAGENT_SERVER_PORT=__PORT_1__
export CATAGENT_CLIENT_PORT=__PORT_2__

npm run dev:server &
npm run dev:client &

wait

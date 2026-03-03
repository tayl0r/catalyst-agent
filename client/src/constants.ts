// Note: The CLAUDE.md section below references "PORTS.LOCAL" which is also
// used as a dedup marker in server/port-allocator.ts — keep them in sync.
export const SETUP_PROMPT = `Set up this project for Catalyst Agent. Analyze the project structure and create these files at the project root:

1. \`start.sh\` — A bash script that starts the dev server. Use \`__PORT_1__\`, \`__PORT_2__\`, etc. as port template variables (replaced with real ports in the auto-generated \`start.local.sh\`). Examine the project's package.json, Makefile, or existing scripts to determine the right start command. Make the file executable.

2. \`PORTS\` — Document each \`__PORT_N__\` variable and what service uses it.

3. Add \`start.local.sh\`, \`PORTS.LOCAL\`, and \`.claude/\` to \`.gitignore\` (create the file if it doesn't exist).

4. Append a "Catalyst Agent" section to \`CLAUDE.md\` with this content:

# Catalyst Agent

This project is managed by Catalyst Agent. Your dev server ports are defined in
PORTS.LOCAL (auto-generated per worktree). Start the server with start.local.sh.
If you need to change how the server is started, edit both start.sh (using __PORT_N__
template vars) and start.local.sh (using real port numbers).
If you need additional ports while making changes, add another entry to PORTS
and PORTS.LOCAL.

Commit the changes when done.`;

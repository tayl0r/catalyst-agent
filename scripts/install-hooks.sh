#!/bin/sh
# Install git hooks (worktree-safe)
# Called automatically via pnpm prepare script

# Skip if not in a git repo (e.g. CI tarball installs)
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Not a git repository, skipping hook install"
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-common-dir)/hooks"

mkdir -p "$HOOKS_DIR"

# Don't overwrite an existing pre-commit hook unless it's ours
if [ -f "$HOOKS_DIR/pre-commit" ]; then
  if ! grep -q "# cc-web auto-version" "$HOOKS_DIR/pre-commit" 2>/dev/null; then
    echo "WARNING: existing pre-commit hook found, skipping install"
    echo "  To install manually: cp $REPO_ROOT/scripts/pre-commit $HOOKS_DIR/pre-commit"
    exit 0
  fi
fi

cp "$REPO_ROOT/scripts/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "Git hooks installed to $HOOKS_DIR"

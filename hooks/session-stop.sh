#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(pwd)")"

# Find current session ID — check cwd and parents for matching project dir
SESSION_ID=""
DIR="$(pwd)"
while [ "$DIR" != "/" ]; do
  ENCODED=$(echo -n "$DIR" | sed 's|[/.]|-|g')
  PROJECT_DIR="$HOME/.claude/projects/$ENCODED"
  if [ -d "$PROJECT_DIR" ]; then
    LATEST=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      SESSION_ID=$(basename "$LATEST" .jsonl)
      break
    fi
  fi
  DIR=$(dirname "$DIR")
done

echo "SESSION_STOP: If there's unfinished work, create a poke reminder."
echo "Use poke_create with:"
echo "  summary: actionable next steps"
echo "  repoPath: $REPO_ROOT"
if [ -n "$SESSION_ID" ]; then
  echo "  sessionId: $SESSION_ID"
fi

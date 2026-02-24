#!/bin/bash
# poke-managed v2
set -euo pipefail

DB="$HOME/.claude/poke.db"
CHECKPOINT_DIR="$HOME/.claude/poke-checkpoints"
THROTTLE_SECONDS=300

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

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Throttle: skip if checkpoint modified < 5min ago
mkdir -p "$CHECKPOINT_DIR"
CHECKPOINT_FILE="$CHECKPOINT_DIR/$SESSION_ID"
if [ -f "$CHECKPOINT_FILE" ]; then
  LAST_MOD=$(stat -f %m "$CHECKPOINT_FILE" 2>/dev/null || stat -c %Y "$CHECKPOINT_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if [ $((NOW - LAST_MOD)) -lt $THROTTLE_SECONDS ]; then
    exit 0
  fi
fi

# Detect repo
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(pwd)")"
REPO_NAME="$(basename "$REPO_ROOT")"

# Build summary from repo + branch
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ] && [ "$BRANCH" != "HEAD" ]; then
  SUMMARY="$REPO_NAME ($BRANCH)"
else
  SUMMARY="Session in $REPO_NAME"
fi

# SQLite upsert — insert or just bump expires_at (preserve Claude's summary)
EXPIRES_AT="$(date -u -v+7d '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%S.000Z')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

sqlite3 "$DB" <<SQL
INSERT INTO reminders (id, session_id, repo_path, summary, status, created_at, expires_at)
VALUES ('$ID', '$SESSION_ID', '$REPO_ROOT', '$SUMMARY', 'active', '$NOW_ISO', '$EXPIRES_AT')
ON CONFLICT(session_id) WHERE session_id IS NOT NULL AND status IN ('active', 'snoozed', 'in_progress')
DO UPDATE SET expires_at = '$EXPIRES_AT';
SQL

# Touch checkpoint
touch "$CHECKPOINT_FILE"

# Prompt Claude to improve the summary via upsert
echo "If there's unfinished work, use poke_create to save a better summary."
echo "  sessionId: $SESSION_ID"
echo "  repoPath: $REPO_ROOT"

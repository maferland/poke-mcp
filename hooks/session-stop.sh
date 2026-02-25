#!/bin/bash
# poke-managed v2
set -euo pipefail

DB="$HOME/.claude/poke.db"
CHECKPOINT_DIR="$HOME/.claude/poke-checkpoints"
THROTTLE_SECONDS=60

# Find current session ID — check cwd and parents for matching project dir
# Only consider files modified in the last 60s (active session)
SESSION_ID=""
DIR="$(pwd)"
while [ "$DIR" != "/" ]; do
  ENCODED=$(echo -n "$DIR" | sed 's|[/.]|-|g')
  PROJECT_DIR="$HOME/.claude/projects/$ENCODED"
  if [ -d "$PROJECT_DIR" ]; then
    LATEST=$(find "$PROJECT_DIR" -name "*.jsonl" -mmin -1 -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
    # Fallback to most recent if no file modified in last minute
    [ -z "$LATEST" ] && LATEST=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)
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

# For worktrees, resolve the main repo name for consistent grouping
GIT_COMMON="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON" ] && [ "$GIT_COMMON" != ".git" ]; then
  MAIN_REPO="$(cd "$GIT_COMMON/.." 2>/dev/null && pwd || true)"
  [ -n "$MAIN_REPO" ] && REPO_NAME="$(basename "$MAIN_REPO")"
fi

# Build summary from session transcript
ENCODED_DIR=$(echo -n "$REPO_ROOT" | sed 's|[/.]|-|g')
SESSION_FILE="$HOME/.claude/projects/$ENCODED_DIR/$SESSION_ID.jsonl"

SUMMARY=""
if [ -f "$SESSION_FILE" ]; then
  # Extract last user text message from transcript (skip tool results, images, system tags)
  SUMMARY=$(python3 -c "
import json, sys, re
last = ''
with open(sys.argv[1]) as f:
    for line in f:
        try:
            obj = json.loads(line)
        except: continue
        if obj.get('type') != 'user': continue
        msg = obj.get('message', {})
        content = msg.get('content', []) if isinstance(msg, dict) else []
        for part in (content if isinstance(content, list) else []):
            if isinstance(part, dict) and part.get('type') == 'text':
                text = part['text'].strip()
                # Strip system-reminder tags, image refs, command tags
                text = re.sub(r'<system-reminder>.*?</system-reminder>', '', text, flags=re.DOTALL).strip()
                text = re.sub(r'<local-command.*?</local-command-stdout>', '', text, flags=re.DOTALL).strip()
                text = re.sub(r'\[Image:.*?\]', '', text).strip()
                text = re.sub(r'\[image\]', '', text, flags=re.IGNORECASE).strip()
                if text and len(text) > 5:
                    last = text
print(last[:120])
" "$SESSION_FILE" 2>/dev/null)
fi

# Fallback to repo + branch
if [ -z "$SUMMARY" ]; then
  SUMMARY="Session in $REPO_NAME"
fi

# Detect branch
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
[ "$BRANCH" = "HEAD" ] && BRANCH=""

# Escape single quotes for SQL
SUMMARY_SQL=$(echo "$SUMMARY" | sed "s/'/''/g")
BRANCH_SQL=$(echo "$BRANCH" | sed "s/'/''/g")

# Ensure branch column exists (migration)
sqlite3 "$DB" "ALTER TABLE reminders ADD COLUMN branch TEXT;" 2>/dev/null || true

# SQLite upsert — insert or update summary + expires_at + branch
EXPIRES_AT="$(date -u -v+7d '+%Y-%m-%dT%H:%M:%S.000Z' 2>/dev/null || date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%S.000Z')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
REPO_ROOT_SQL=$(echo "$REPO_ROOT" | sed "s/'/''/g")

sqlite3 "$DB" <<SQL
-- Auto-dismiss stale reminders for same repo when session changes
UPDATE reminders SET status = 'dismissed'
WHERE repo_path = '$REPO_ROOT_SQL' AND session_id != '$SESSION_ID'
  AND status IN ('active', 'snoozed', 'in_progress');

INSERT INTO reminders (id, session_id, repo_path, branch, summary, status, created_at, expires_at)
VALUES ('$ID', '$SESSION_ID', '$REPO_ROOT', nullif('$BRANCH_SQL',''), '$SUMMARY_SQL', 'active', '$NOW_ISO', '$EXPIRES_AT')
ON CONFLICT(session_id) WHERE session_id IS NOT NULL AND status IN ('active', 'snoozed', 'in_progress')
DO UPDATE SET summary = '$SUMMARY_SQL', branch = nullif('$BRANCH_SQL',''), expires_at = '$EXPIRES_AT', created_at = '$NOW_ISO';
SQL

# Touch checkpoint
touch "$CHECKPOINT_FILE"

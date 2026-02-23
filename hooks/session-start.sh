#!/bin/bash
set -euo pipefail

DB="$HOME/.claude/poke.db"
[ -f "$DB" ] || exit 0

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"

# Expire stale reminders
sqlite3 "$DB" "UPDATE reminders SET status = 'expired' WHERE status IN ('active', 'snoozed') AND expires_at < datetime('now');" 2>/dev/null || true

# Unsnooze due reminders
sqlite3 "$DB" "UPDATE reminders SET status = 'active', snoozed_until = NULL WHERE status = 'snoozed' AND snoozed_until < datetime('now');" 2>/dev/null || true

# Get active reminders — filter by repo if in a git repo, otherwise show all
if [ -n "$REPO_ROOT" ]; then
  REMINDERS=$(sqlite3 -separator '|' "$DB" "SELECT id, summary, session_id, repo_path FROM reminders WHERE status = 'active' AND repo_path = '$REPO_ROOT' ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || true)
else
  REMINDERS=$(sqlite3 -separator '|' "$DB" "SELECT id, summary, session_id, repo_path FROM reminders WHERE status = 'active' ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || true)
fi

[ -z "$REMINDERS" ] && exit 0

echo "POKE: Active reminders for this repo:"
while IFS='|' read -r id summary session_id repo_path; do
  echo "  - [$id] $summary"
  if [ -n "$session_id" ]; then
    echo "    session: $session_id"
  fi
done <<< "$REMINDERS"
echo ""
echo "Use poke_resume to resume a reminder, or poke_list for all reminders."

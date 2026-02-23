#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$HOME/.claude/settings.json"
HOOKS_DIR="$HOME/.claude/hooks/poke"
BUN="$(which bun 2>/dev/null || echo "bun")"
INDEX="$SCRIPT_DIR/src/index.ts"

# Resolve absolute bun path
if [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
fi

echo "=== Poke MCP Installer ==="
echo ""

# 1. Install deps
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "[1/3] Installing dependencies..."
  cd "$SCRIPT_DIR" && "$BUN" install --frozen-lockfile 2>/dev/null || "$BUN" install
else
  echo "[1/3] Dependencies already installed."
fi

# 2. Register MCP server via claude CLI
echo "[2/3] Registering MCP server..."
if claude mcp list 2>/dev/null | grep -q "^poke:"; then
  echo "  MCP server already registered."
else
  claude mcp add poke -s user -- "$BUN" "$INDEX"
  echo "  Registered poke MCP server (user scope)."
fi

# 3. Install hooks
echo "[3/3] Installing hooks..."
mkdir -p "$HOOKS_DIR"
cp "$SCRIPT_DIR/hooks/session-start.sh" "$HOOKS_DIR/"
cp "$SCRIPT_DIR/hooks/session-stop.sh" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR"/*.sh

if command -v jq &>/dev/null; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  [ -f "$SETTINGS_FILE" ] || echo '{}' > "$SETTINGS_FILE"

  # Session-start hook
  START_CMD="$HOOKS_DIR/session-start.sh"
  if jq -e ".hooks.SessionStart[]?.hooks[]? | select(.command == \"$START_CMD\")" "$SETTINGS_FILE" >/dev/null 2>&1; then
    echo "  SessionStart hook already registered."
  else
    jq --arg cmd "$START_CMD" '
      .hooks.SessionStart = (.hooks.SessionStart // []) + [{"matcher":"","hooks":[{"type":"command","command":$cmd,"timeout":5}]}]
    ' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
    mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
    echo "  Added SessionStart hook to $SETTINGS_FILE"
  fi

  # Session-stop hook
  STOP_CMD="$HOOKS_DIR/session-stop.sh"
  if jq -e ".hooks.Stop[]?.hooks[]? | select(.command == \"$STOP_CMD\")" "$SETTINGS_FILE" >/dev/null 2>&1; then
    echo "  Stop hook already registered."
  else
    jq --arg cmd "$STOP_CMD" '
      .hooks.Stop = (.hooks.Stop // []) + [{"matcher":"","hooks":[{"type":"command","command":$cmd,"timeout":5}]}]
    ' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
    mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
    echo "  Added Stop hook to $SETTINGS_FILE"
  fi
else
  echo "  jq not found — add hooks manually to $SETTINGS_FILE"
fi

echo ""
echo "Done. Restart Claude for changes to take effect."
echo "Tools: poke_create, poke_list, poke_snooze, poke_dismiss, poke_update, poke_resume"
echo "Hooks: session-start (shows pending reminders), session-stop (prompts to create)"

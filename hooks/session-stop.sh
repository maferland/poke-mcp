#!/bin/bash
# poke-managed v3
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bun "$SCRIPT_DIR/../src/cli.ts" checkpoint-session 2>/dev/null || true

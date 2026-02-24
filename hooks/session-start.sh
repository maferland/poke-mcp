#!/bin/bash
# poke-managed v3
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bun "$SCRIPT_DIR/../src/cli.ts" expire 2>/dev/null || true
bun "$SCRIPT_DIR/../src/cli.ts" list 2>/dev/null || true

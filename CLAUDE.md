# Poke MCP

Ephemeral reminder system for Claude Code sessions.

## Dev

- Runtime: bun (not node)
- Tests: `bun run test` (uses `bunx --bun vitest`)
- No build step — bun runs TS directly
- SQLite via `bun:sqlite` (not better-sqlite3)
- DB: `~/.claude/poke.db` (WAL mode, shared with SwiftUI app)

## Tools

6 MCP tools: `poke_create`, `poke_list`, `poke_snooze`, `poke_dismiss`, `poke_update`, `poke_resume`

## Architecture

- `store.ts` — ReminderStore class (SQLite CRUD, expiry, unsnooze)
- `date-parser.ts` — Parse relative times ("2h", "tomorrow 9am") using date-fns
- `tools.ts` — MCP tool registration with zod schemas
- `index.ts` — Stdio entry point

# Poke MCP

MCP server for ephemeral Claude Code session reminders. Reminders persist in SQLite at `~/.claude/poke.db`.

Pair with the [Poke menu bar app](https://github.com/maferland/poke) for a visual interface.

## Install

### Homebrew

```bash
brew install maferland/tap/poke-mcp
$(brew --prefix poke-mcp)/libexec/install.sh
```

### From source

Requires [Bun](https://bun.sh) and [jq](https://jqlang.github.io/jq/).

```bash
git clone https://github.com/maferland/poke-mcp.git
cd poke-mcp
./install.sh
```

Registers the MCP server, installs session hooks, and configures `~/.claude/settings.json`. Restart Claude after install.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `poke_create` | Create/update reminder. `summary` required; `sessionId`, `repoPath`, `branch`, `dueAt` optional |
| `poke_list` | List reminders. Optional `status` filter |
| `poke_snooze` | Snooze by id + until (relative or absolute) |
| `poke_dismiss` | Mark as done |
| `poke_update` | Update summary or dueAt |
| `poke_resume` | Get resume command. Sets status to in_progress |

`dueAt` and `until` accept ISO8601 or relative formats: `2h`, `30m`, `tomorrow 9am`, `monday`.

## Hooks

- **SessionStart** — expires old reminders, shows active ones
- **Stop** — auto-checkpoints to SQLite with repo, branch, and last user message as summary

### Auto-checkpoint

Every session stop writes a reminder to SQLite — no reliance on Claude remembering to save. Stale reminders are auto-dismissed when a new session starts in the same repo. Checkpoints throttled to once per 60s per session.

### Deduplication

Reminders are deduplicated by `session_id`. Calling `poke_create` twice in the same session updates the existing reminder. IDs support prefix matching (e.g. `poke_update c813ff6a`).

## Upgrading

Re-run `./install.sh`. Hooks with the `# poke-managed` marker are overwritten safely. Custom hooks without the marker are skipped with a warning.

## Support

If Poke helps you stay on track, consider buying me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/maferland)

## License

MIT — see [LICENSE](LICENSE)

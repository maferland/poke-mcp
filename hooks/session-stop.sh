#!/bin/bash
set -euo pipefail

# Prompt Claude to consider creating a poke reminder on session exit
echo "SESSION_STOP: Consider creating a poke reminder if there's unfinished work."
echo "Use poke_create with a summary of what's next, your session_id, and repo_path."

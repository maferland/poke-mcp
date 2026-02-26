#!/bin/bash
set -euo pipefail

VERSION="${1:?Usage: update_homebrew_tap.sh VERSION}"
FORMULA_VERSION="${VERSION#v}"

echo "Updating homebrew tap: version=$FORMULA_VERSION"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

gh repo clone maferland/homebrew-tap "$WORK_DIR" -- --depth 1

if [ -n "${GH_TOKEN:-}" ]; then
    git -C "$WORK_DIR" remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/maferland/homebrew-tap.git"
fi

FORMULA_FILE="$WORK_DIR/Formula/poke-mcp.rb"

cat > "$FORMULA_FILE" << FORMULA
class PokeMcp < Formula
  desc "MCP server for ephemeral Claude Code session reminders"
  homepage "https://github.com/maferland/poke-mcp"
  url "https://github.com/maferland/poke-mcp.git", tag: "v$FORMULA_VERSION"
  license "MIT"

  depends_on "oven-sh/bun/bun"
  depends_on "jq"

  def install
    system "bun", "install", "--frozen-lockfile"
    libexec.install Dir["*"]
  end

  def post_install
    system libexec/"install.sh"
  end

  def caveats
    <<~EOS
      Restart Claude Code for the MCP server and hooks to take effect.

      Tools: poke_create, poke_list, poke_snooze, poke_dismiss, poke_update, poke_resume
    EOS
  end

  test do
    cd libexec do
      system "bun", "run", "test"
    end
  end
end
FORMULA

cd "$WORK_DIR"
git add Formula/poke-mcp.rb
git commit -m "Update poke-mcp to $VERSION"
git push

echo "Homebrew tap updated"

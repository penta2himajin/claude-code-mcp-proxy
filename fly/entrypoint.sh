#!/bin/bash
# Ensure mise-managed tools (node, claude, tsx, etc.) are on PATH.
# entrypoint.sh runs as a non-interactive script, so .bashrc is NOT sourced.
export PATH="/home/claude/.local/bin:/home/claude/.local/share/mise/shims:$PATH"

# Fix volume ownership (fly.io mounts as root)
if [ -d /workspace ] && [ "$(stat -c '%U' /workspace)" = "root" ]; then
  sudo chown -R claude:claude /workspace
fi

# Persist ~/.claude config in the volume (survives machine stop/start)
mkdir -p /workspace/.claude-config
ln -sfn /workspace/.claude-config "$HOME/.claude"

# Restore .claude.json from backup if lost (atomic write breaks symlink)
if [ ! -f /workspace/.claude-config/.claude.json ]; then
  LATEST=$(ls -t /workspace/.claude-config/backups/.claude.json.backup.* 2>/dev/null | head -1)
  [ -n "$LATEST" ] && cp "$LATEST" /workspace/.claude-config/.claude.json
fi

# ~/.claude.json is stored outside ~/.claude/ — symlink it into the volume too
if [ ! -L "$HOME/.claude.json" ]; then
  # If a real file exists, move it into the volume first
  [ -f "$HOME/.claude.json" ] && mv "$HOME/.claude.json" /workspace/.claude-config/.claude.json
  ln -sf /workspace/.claude-config/.claude.json "$HOME/.claude.json"
fi

# Persist gh CLI config in volume (auth tokens survive restarts)
mkdir -p /workspace/.claude-config/gh
mkdir -p "$HOME/.config"
ln -sfn /workspace/.claude-config/gh "$HOME/.config/gh"

# Auto-login with GH_TOKEN if set and not already authenticated
if [ -n "$GH_TOKEN" ] && ! gh auth status >/dev/null 2>&1; then
  echo "$GH_TOKEN" | gh auth login --with-token
fi

# Lock only auth-critical files (defense-in-depth with managed-settings deny rules).
# DO NOT lock the entire config dir — Claude Code needs to write to ~/.claude/ at startup
# (sessions, cache, history, etc.). Locking everything causes Claude Code to freeze.
chmod a-w /workspace/.claude-config/.credentials.json 2>/dev/null || true
chmod a-w /workspace/.claude-config/.claude.json 2>/dev/null || true
[ -f /workspace/.claude-config/gh/hosts.yml ] && chmod a-w /workspace/.claude-config/gh/hosts.yml 2>/dev/null || true

# Persist mise data in volume (toolchain installs, shims, cache survive restarts)
MISE_DATA="$HOME/.local/share/mise"
MISE_CACHE="/workspace/.mise"
if [ ! -L "$MISE_DATA" ]; then
  mkdir -p "$MISE_CACHE"
  # First run: seed volume with build-time node install, then symlink
  cp -a "$MISE_DATA/"* "$MISE_CACHE/" 2>/dev/null || true
  rm -rf "$MISE_DATA"
  ln -sfn "$MISE_CACHE" "$MISE_DATA"
fi

# Install language toolchains from MISE_TOOLS (set via Fly.io Secrets dashboard)
MISE_TOOLS="${MISE_TOOLS:-node@22 bun@latest rust@latest dotnet@latest}"
echo "Ensuring tools: $MISE_TOOLS"
mise use --global $MISE_TOOLS

# Auto-start Claude Code in tmux (MCP startClaude will reuse if already running)
tmux new-session -d -s claude -x 220 -y 50
tmux send-keys -t claude "cd /workspace && claude --dangerously-skip-permissions --rc" C-m

exec tsx src/server.ts

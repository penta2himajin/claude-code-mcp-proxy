#!/bin/bash
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

# Lock config dir after setup (defense-in-depth with managed-settings deny rules)
chmod -R a-w /workspace/.claude-config/ 2>/dev/null || true

# Auto-start Claude Code in tmux (MCP startClaude will reuse if already running)
tmux new-session -d -s claude -x 220 -y 50
tmux send-keys -t claude "cd /workspace && claude --dangerously-skip-permissions --rc" C-m

exec tsx src/server.ts

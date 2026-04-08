#!/bin/bash
# Fix volume ownership (fly.io mounts as root)
if [ -d /workspace ] && [ "$(stat -c '%U' /workspace)" = "root" ]; then
  sudo chown -R claude:claude /workspace
fi

# Persist ~/.claude config in the volume (survives machine stop/start)
mkdir -p /workspace/.claude-config
ln -sfn /workspace/.claude-config "$HOME/.claude"

# ~/.claude.json is stored outside ~/.claude/ — symlink it into the volume too
if [ ! -L "$HOME/.claude.json" ]; then
  # If a real file exists, move it into the volume first
  [ -f "$HOME/.claude.json" ] && mv "$HOME/.claude.json" /workspace/.claude-config/.claude.json
  ln -sf /workspace/.claude-config/.claude.json "$HOME/.claude.json"
fi

exec tsx src/server.ts

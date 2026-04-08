#!/bin/bash
# Fix volume ownership (fly.io mounts as root)
if [ -d /workspace ] && [ "$(stat -c '%U' /workspace)" = "root" ]; then
  sudo chown -R claude:claude /workspace
fi

# Persist ~/.claude config in the volume (survives machine stop/start)
mkdir -p /workspace/.claude-config
ln -sfn /workspace/.claude-config "$HOME/.claude"

exec tsx src/server.ts

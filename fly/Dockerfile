FROM node:22-slim

RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI and tsx (TypeScript runner)
RUN npm install -g @anthropic-ai/claude-code tsx

# Create non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /workspace /app && \
    chown -R claude:claude /workspace /app && \
    echo "claude ALL=(ALL) NOPASSWD: /bin/chown" >> /etc/sudoers.d/claude

WORKDIR /app
COPY --chown=claude:claude package.json .
COPY --chown=claude:claude src/ src/
COPY --chown=claude:claude entrypoint.sh .
RUN chmod +x entrypoint.sh

USER claude
EXPOSE 8080

CMD ["./entrypoint.sh"]

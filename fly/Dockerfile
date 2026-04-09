FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    sudo \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (claude --dangerously-skip-permissions refuses root)
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /workspace /app && \
    chown -R claude:claude /workspace /app && \
    echo "claude ALL=(ALL) NOPASSWD: /bin/chown" >> /etc/sudoers.d/claude

# Install mise (language toolchains are configured at runtime via MISE_TOOLS env var)
USER claude
RUN curl https://mise.run | sh
ENV PATH="/home/claude/.local/bin:/home/claude/.local/share/mise/shims:${PATH}"

# Install Node.js via mise (required for claude-code and tsx at build time)
RUN mise use --global node@22

# Activate mise in interactive shells (for Claude Code sessions)
RUN echo 'export PATH="/home/claude/.local/bin:/home/claude/.local/share/mise/shims:$PATH"' >> /home/claude/.bashrc && \
    echo 'eval "$(mise activate bash)"' >> /home/claude/.bashrc

# Install Claude Code CLI and tsx (TypeScript runner)
RUN npm install -g @anthropic-ai/claude-code tsx

# Deploy managed settings (highest priority, cannot be overridden by user/project)
USER root
RUN mkdir -p /etc/claude-code
COPY managed-settings.json /etc/claude-code/managed-settings.json

WORKDIR /app
COPY --chown=claude:claude package.json .
COPY --chown=claude:claude src/ src/
COPY --chown=claude:claude entrypoint.sh .
RUN chmod +x entrypoint.sh

USER claude
EXPOSE 8080

CMD ["./entrypoint.sh"]

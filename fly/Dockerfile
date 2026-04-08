FROM node:22-slim

RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create workspace
RUN mkdir -p /workspace /app

WORKDIR /app
COPY package.json .
COPY src/ src/

EXPOSE 8080

CMD ["node", "src/server.mjs"]

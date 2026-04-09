import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TmuxManager } from "./tmux-manager.ts";

const tmux = new TmuxManager();
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("API_KEY environment variable is required");
  process.exit(1);
}

// Restore Claude subscription credentials from env var if present.
// This is a fallback — entrypoint.sh handles symlinks and chown first,
// but credentials may be missing (deleted, expired, first run).
const CLAUDE_CREDENTIALS = process.env.CLAUDE_CREDENTIALS;
if (CLAUDE_CREDENTIALS) {
  const claudeDir = join(homedir(), ".claude");
  const credPath = join(claudeDir, ".credentials.json");
  if (!existsSync(credPath)) {
    try {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(credPath, CLAUDE_CREDENTIALS, { mode: 0o600 });
      console.log("Restored Claude credentials from CLAUDE_CREDENTIALS env var");
    } catch (e: unknown) {
      // Non-fatal: Claude Code will enter login flow if credentials are missing
      console.warn("Could not restore credentials:", e instanceof Error ? e.message : e);
    }
  }
}

/** Parse JSON body from request */
function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: string) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Send JSON response */
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Parse query string */
function parseQuery(url: string): Record<string, string> {
  const q: Record<string, string> = {};
  const idx = url.indexOf("?");
  if (idx >= 0) {
    for (const pair of url.slice(idx + 1).split("&")) {
      const [k, v] = pair.split("=");
      q[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return q;
}

const server = createServer(async (req, res) => {
  // Auth check
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${API_KEY}`) {
    return json(res, { error: "Unauthorized" }, 401);
  }

  const path = req.url!.split("?")[0];

  try {
    // GET /status - health + session status
    if (req.method === "GET" && path === "/status") {
      const status = await tmux.getStatus();
      return json(res, { ok: true, ...status });
    }

    // GET /keepalive - activity check for Worker keepalive polling
    if (req.method === "GET" && path === "/keepalive") {
      const activity = await tmux.isActive();
      return json(res, activity);
    }

    // POST /session/start - start Claude in tmux
    if (req.method === "POST" && path === "/session/start") {
      const body = await parseBody(req);
      const result = await tmux.startClaude({
        prompt: body.prompt as string | undefined,
        workdir: body.workdir as string | undefined,
      });
      return json(res, result);
    }

    // POST /session/stop - kill tmux session
    if (req.method === "POST" && path === "/session/stop") {
      const result = await tmux.stopClaude();
      return json(res, result);
    }

    // POST /session/send - send keys to tmux
    if (req.method === "POST" && path === "/session/send") {
      const body = await parseBody(req);
      if (!body.text) {
        return json(res, { error: "text is required" }, 400);
      }
      const result = await tmux.sendKeys(body.text as string, (body.enter as boolean) ?? true);
      return json(res, result);
    }

    // GET /session/output - capture tmux pane
    if (req.method === "GET" && path === "/session/output") {
      const query = parseQuery(req.url!);
      const lines = parseInt(query.lines) || 100;
      const output = await tmux.capturePane(lines);
      return json(res, { output });
    }

    json(res, { error: "Not Found" }, 404);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Request error:", e);
    json(res, { error: message }, 500);
  }
});

const PORT = parseInt(process.env.PORT || "8080");
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

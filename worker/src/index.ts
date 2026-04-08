import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";

type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

// ─── Fly.io Machine API Client ───

const FLY_API = "https://api.machines.dev/v1";

async function flyRequest(env: Env, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${FLY_API}/apps/${env.FLY_APP_NAME}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.FLY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fly API ${method} ${path}: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getFirstMachineId(env: Env): Promise<string> {
  const machines = (await flyRequest(env, "/machines")) as Array<{ id: string }>;
  if (machines.length === 0) throw new Error("No machines found in app");
  return machines[0].id;
}

// ─── Machine HTTP API Client ───

async function machineRequest(env: Env, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://${env.FLY_APP_NAME}.fly.dev${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.MACHINE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Machine API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

async function waitForMachineReady(env: Env, maxSeconds: number) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      await machineRequest(env, "/status");
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error("Machine HTTP server did not become ready in time");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── MCP Server ───

export class ClaudeCodeMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Claude Code Remote",
    version: "1.0.0",
  });

  async init() {
    const allowedUsers = (this.env.ALLOWED_USERS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedUsers.length > 0 && !allowedUsers.includes(this.props!.login)) {
      return;
    }

    this.server.tool(
      "start_machine",
      "Start the fly.io machine and Claude Code session. Use this first before sending commands.",
      {
        prompt: z
          .string()
          .optional()
          .describe("Optional initial prompt for Claude Code (one-shot mode). Omit for interactive session."),
        workdir: z.string().optional().describe("Working directory inside the machine (default: /workspace)"),
      },
      async ({ prompt, workdir }) => {
        try {
          const machineId = await getFirstMachineId(this.env);
          const info = (await flyRequest(this.env, `/machines/${machineId}`)) as {
            state: string;
            region: string;
          };

          if (info.state !== "started") {
            await flyRequest(this.env, `/machines/${machineId}/start`, "POST");
            await flyRequest(this.env, `/machines/${machineId}/wait?state=started&timeout=60`);
            await sleep(3000);
          }

          await waitForMachineReady(this.env, 30);

          const result = await machineRequest(this.env, "/session/start", "POST", { prompt, workdir });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { machine: { id: machineId, state: "started", region: info.region }, session: result },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      },
    );

    this.server.tool("stop_machine", "Stop the Claude Code session and fly.io machine.", {}, async () => {
      try {
        const machineId = await getFirstMachineId(this.env);
        try {
          await machineRequest(this.env, "/session/stop", "POST");
        } catch {
          /* machine might be stopped already */
        }
        await flyRequest(this.env, `/machines/${machineId}/stop`, "POST");
        return { content: [{ type: "text", text: JSON.stringify({ status: "stopped", machineId }) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    });

    this.server.tool(
      "send_command",
      "Send text input to the Claude Code session via tmux. Use this to send prompts or answer questions.",
      {
        text: z.string().describe("Text to send to Claude Code"),
        enter: z.boolean().optional().default(true).describe("Whether to press Enter after the text"),
      },
      async ({ text, enter }) => {
        try {
          const result = (await machineRequest(this.env, "/session/send", "POST", { text, enter })) as Record<string, unknown>;
          await sleep(2000);
          const output = (await machineRequest(this.env, "/session/output?lines=50")) as { output: string };
          return {
            content: [{ type: "text", text: JSON.stringify({ ...result, recentOutput: output.output }, null, 2) }],
          };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      },
    );

    this.server.tool(
      "get_output",
      "Get the current terminal output from Claude Code. Use to check progress or read responses.",
      {
        lines: z.number().optional().default(100).describe("Number of lines to capture"),
      },
      async ({ lines }) => {
        try {
          const result = (await machineRequest(this.env, `/session/output?lines=${lines}`)) as { output: string };
          return { content: [{ type: "text", text: result.output }] };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      },
    );

    this.server.tool(
      "get_status",
      "Get the current status of the fly.io machine and Claude Code session.",
      {},
      async () => {
        try {
          const machineId = await getFirstMachineId(this.env);
          const info = (await flyRequest(this.env, `/machines/${machineId}`)) as {
            state: string;
            region: string;
          };
          let sessionStatus: Record<string, unknown> = { session: "unknown" };

          if (info.state === "started") {
            try {
              sessionStatus = (await machineRequest(this.env, "/status")) as Record<string, unknown>;
            } catch {
              sessionStatus = { session: "unreachable" };
            }
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { machine: { id: machineId, state: info.state, region: info.region }, ...sessionStatus },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (e: unknown) {
          return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
        }
      },
    );
  }
}

export default new OAuthProvider({
  apiHandler: ClaudeCodeMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});

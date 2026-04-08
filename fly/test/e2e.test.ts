import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// E2E test: actually runs Claude Code with --dangerously-skip-permissions in tmux.
// Requires: tmux, claude CLI installed, CLAUDE_CREDENTIALS env var set.

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasClaude(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasCredentials(): boolean {
  return !!process.env.CLAUDE_CREDENTIALS;
}

const SKIP = !hasTmux() || !hasClaude() || !hasCredentials();

describe.skipIf(SKIP)("E2E: Claude Code with --dangerously-skip-permissions", () => {
  let TmuxManager: any;

  beforeAll(async () => {
    // Set up credentials
    const creds = process.env.CLAUDE_CREDENTIALS!;
    const claudeDir = join(homedir(), ".claude");
    const credPath = join(claudeDir, ".credentials.json");
    if (!existsSync(credPath)) {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(credPath, creds, { mode: 0o600 });
    }

    const mod = await import("../src/tmux-manager.ts");
    TmuxManager = mod.TmuxManager;
  });

  afterAll(() => {
    try {
      execSync("tmux kill-session -t claude 2>/dev/null");
    } catch {}
  });

  it("should start claude with --dangerously-skip-permissions --rc without hanging", async () => {
    const tmux = new TmuxManager();

    // Start Claude Code - using /tmp as workdir since /workspace may not exist in CI
    const result = await tmux.startClaude({ workdir: "/tmp" });
    expect(result.status).toBe("started");

    // Wait for Claude to initialize (cold start can take a while)
    await sleep(15_000);

    // Capture output
    const output = await tmux.capturePane(50);

    // Should NOT contain permission/approval prompts
    expect(output).not.toContain("Do you want to proceed?");
    expect(output).not.toContain("Yes, and don't ask again");
    expect(output).not.toContain("Would you like to trust");

    console.log("=== Claude output after start (--dangerously-skip-permissions --rc) ===");
    console.log(output);
    console.log("=== End output ===");

    // Check if --rc and --dangerously-skip-permissions can coexist:
    // - If RC works: output may contain an RC URL (https://...)
    // - If they conflict: output may contain an error message about incompatibility
    // - Either way, it shouldn't hang on permission prompts
    const hasRcUrl = /https?:\/\//.test(output);
    const hasError = /error|cannot|incompatible|not supported/i.test(output);
    const isRunning = (await tmux.getStatus()).session === "running";

    console.log(`RC URL found: ${hasRcUrl}, Error detected: ${hasError}, Session running: ${isRunning}`);

    // The session should at least be running (not crashed)
    expect(isRunning).toBe(true);
  }, 30_000);

  it("should accept a simple prompt via -p flag and produce output", async () => {
    const tmux = new TmuxManager();

    // Kill any existing session
    await tmux.stopClaude();
    await sleep(1000);

    // Start with a simple one-shot prompt
    execSync("tmux new-session -d -s claude -x 220 -y 50");
    execSync(
      `tmux send-keys -t claude 'cd /tmp && claude --dangerously-skip-permissions -p "echo hello"' C-m`,
    );

    // Wait for claude to process (this is a real API call)
    await sleep(20_000);

    const output = await tmux.capturePane(50);
    console.log("=== One-shot prompt output ===");
    console.log(output);
    console.log("=== End output ===");

    // Should have produced some output (not empty, not stuck on prompt)
    const lines = output.trim().split("\n").filter((l: string) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(1);

    await tmux.stopClaude();
  }, 45_000);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

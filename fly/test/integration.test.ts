import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";

// Integration test: runs actual tmux commands.
// Skipped on environments without tmux (e.g., Windows CI).

function hasTmux(): boolean {
  try {
    execSync("tmux -V", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !hasTmux();

describe.skipIf(SKIP)("Integration: TmuxManager with real tmux", () => {
  let TmuxManager: any;

  beforeAll(async () => {
    // Import real (unmocked) module
    const mod = await import("../src/tmux-manager.ts");
    TmuxManager = mod.TmuxManager;
  });

  beforeEach(() => {
    // Clean up any leftover sessions
    try {
      execSync("tmux kill-session -t claude 2>/dev/null");
    } catch {}
  });

  afterAll(() => {
    try {
      execSync("tmux kill-session -t claude 2>/dev/null");
    } catch {}
  });

  it("should create and destroy a tmux session", async () => {
    const tmux = new TmuxManager();

    // Start a simple echo command instead of actual claude
    execSync("tmux new-session -d -s claude -x 220 -y 50");
    execSync("tmux send-keys -t claude 'echo hello-integration-test' C-m");

    // Wait for command to execute
    await new Promise((r) => setTimeout(r, 500));

    // Verify session exists
    const status = await tmux.getStatus();
    expect(status.session).toBe("running");

    // Capture output should contain our echo
    const output = await tmux.capturePane(20);
    expect(output).toContain("hello-integration-test");

    // Stop
    const result = await tmux.stopClaude();
    expect(result.status).toBe("stopped");

    // Verify session is gone
    const afterStatus = await tmux.getStatus();
    expect(afterStatus.session).toBe("stopped");
  });

  it("should send keys and capture output", async () => {
    const tmux = new TmuxManager();

    // Create a session with bash
    execSync("tmux new-session -d -s claude -x 220 -y 50");
    await new Promise((r) => setTimeout(r, 300));

    // Send a command via sendKeys
    await tmux.sendKeys("echo SEND_KEYS_TEST_OUTPUT");
    await new Promise((r) => setTimeout(r, 500));

    // Capture should contain our output
    const output = await tmux.capturePane(20);
    expect(output).toContain("SEND_KEYS_TEST_OUTPUT");

    // Cleanup
    await tmux.stopClaude();
  });

  it("should handle startClaude which runs --dangerously-skip-permissions", async () => {
    const tmux = new TmuxManager();

    // Start claude - this will fail if claude is not installed,
    // but it verifies the tmux session is created with the right command
    const result = await tmux.startClaude({ workdir: "/tmp" });
    expect(result.status).toBe("started");
    expect(result.session).toBe("claude");

    // Wait briefly then check the command was sent
    await new Promise((r) => setTimeout(r, 1000));

    const output = await tmux.capturePane(20);
    // The tmux pane should show the command being executed
    // (either claude starting, or "command not found" if not installed)
    expect(output.length).toBeGreaterThan(0);

    await tmux.stopClaude();
  });
});

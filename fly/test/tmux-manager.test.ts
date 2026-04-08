import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

// We test the TmuxManager by mocking child_process to verify
// the correct shell commands are constructed.

// Dynamic import so we can mock before loading
let TmuxManager: any;

// Capture all execSync calls
const execSyncCalls: string[] = [];
const execFileCalls: { cmd: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    execSyncCalls.push(cmd);
    return Buffer.from("");
  }),
  execFile: vi.fn(
    (
      cmd: string,
      args: string[],
      cb: (err: Error | null, result: { stdout: string }) => void,
    ) => {
      execFileCalls.push({ cmd, args });
      cb(null, { stdout: "captured output\n" });
    },
  ),
}));

beforeEach(async () => {
  execSyncCalls.length = 0;
  execFileCalls.length = 0;
  // Re-import to get fresh instance with mocks applied
  const mod = await import("../src/tmux-manager.ts");
  TmuxManager = mod.TmuxManager;
});

describe("TmuxManager", () => {
  describe("startClaude", () => {
    it("should kill existing session, create new one, and send claude command", async () => {
      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result).toEqual({ status: "started", session: "claude" });

      // Should attempt to kill existing session
      expect(execSyncCalls[0]).toContain("tmux kill-session -t claude");

      // Should create new tmux session
      expect(execSyncCalls[1]).toBe(
        "tmux new-session -d -s claude -x 220 -y 50",
      );

      // Should send claude command with --dangerously-skip-permissions and --rc
      const sendKeysCmd = execSyncCalls[2];
      expect(sendKeysCmd).toContain("tmux send-keys -t claude");
      expect(sendKeysCmd).toContain("--dangerously-skip-permissions");
      expect(sendKeysCmd).toContain("--rc");
      expect(sendKeysCmd).toContain("cd /workspace");
      expect(sendKeysCmd).toContain("C-m");
    });

    it("should include -p flag with prompt when provided", async () => {
      const tmux = new TmuxManager();
      await tmux.startClaude({ prompt: "fix the bug" });

      const sendKeysCmd = execSyncCalls[2];
      expect(sendKeysCmd).toContain("--dangerously-skip-permissions");
      expect(sendKeysCmd).toContain("-p");
      expect(sendKeysCmd).toContain("fix the bug");
    });

    it("should use custom workdir when provided", async () => {
      const tmux = new TmuxManager();
      await tmux.startClaude({ workdir: "/project" });

      const sendKeysCmd = execSyncCalls[2];
      expect(sendKeysCmd).toContain("cd /project");
    });

    it("should shell-escape prompt with single quotes", async () => {
      const tmux = new TmuxManager();
      await tmux.startClaude({ prompt: "it's a test" });

      const sendKeysCmd = execSyncCalls[2];
      // The prompt is nested inside the cd+claude command which is also shell-escaped
      // Verify the prompt content is present and -p flag is used
      expect(sendKeysCmd).toContain("-p");
      expect(sendKeysCmd).toContain("it");
      expect(sendKeysCmd).toContain("s a test");
      // Verify no unescaped single quotes would break the command
      // The outer shellEscape wraps the whole "cd ... && claude ... -p 'prompt'" string
      expect(sendKeysCmd).toMatch(/^tmux send-keys -t claude '.*' C-m$/);
    });
  });

  describe("stopClaude", () => {
    it("should kill the tmux session", async () => {
      const tmux = new TmuxManager();
      const result = await tmux.stopClaude();

      expect(result).toEqual({ status: "stopped" });
      expect(execSyncCalls[0]).toContain("tmux kill-session -t claude");
    });

    it("should return not_running if session does not exist", async () => {
      // Make execSync throw for kill-session
      const { execSync: mockExecSync } = await import("node:child_process");
      vi.mocked(mockExecSync).mockImplementationOnce(() => {
        throw new Error("session not found");
      });

      const tmux = new TmuxManager();
      const result = await tmux.stopClaude();

      expect(result).toEqual({ status: "not_running" });
    });
  });

  describe("sendKeys", () => {
    it("should send text with literal flag and Enter", async () => {
      const tmux = new TmuxManager();
      const result = await tmux.sendKeys("hello world");

      expect(result).toEqual({ status: "sent" });
      expect(execSyncCalls[0]).toContain("tmux send-keys -t claude -l");
      expect(execSyncCalls[0]).toContain("hello world");
      // Should also send Enter
      expect(execSyncCalls[1]).toBe("tmux send-keys -t claude C-m");
    });

    it("should not send Enter when enter=false", async () => {
      const tmux = new TmuxManager();
      await tmux.sendKeys("partial", false);

      expect(execSyncCalls).toHaveLength(1);
      expect(execSyncCalls[0]).toContain("tmux send-keys -t claude -l");
      expect(execSyncCalls[0]).toContain("partial");
    });

    it("should return error status when tmux command fails", async () => {
      const { execSync: mockExecSync } = await import("node:child_process");
      vi.mocked(mockExecSync).mockImplementationOnce(() => {
        throw new Error("no session");
      });

      const tmux = new TmuxManager();
      const result = await tmux.sendKeys("test");

      expect(result.status).toBe("error");
      expect(result.error).toContain("no session");
    });
  });

  describe("capturePane", () => {
    it("should call tmux capture-pane with correct args", async () => {
      const tmux = new TmuxManager();
      const output = await tmux.capturePane(50);

      expect(output).toBe("captured output\n");
      expect(execFileCalls[0]).toEqual({
        cmd: "tmux",
        args: ["capture-pane", "-t", "claude", "-p", "-S", "-50"],
      });
    });

    it("should default to 100 lines", async () => {
      const tmux = new TmuxManager();
      await tmux.capturePane();

      expect(execFileCalls[0].args).toContain("-100");
    });
  });

  describe("getStatus", () => {
    it("should return running with last lines when session exists", async () => {
      const tmux = new TmuxManager();
      const status = await tmux.getStatus();

      expect(status.session).toBe("running");
      expect(status.lastLines).toContain("captured output");
    });

    it("should return stopped when session does not exist", async () => {
      const { execSync: mockExecSync } = await import("node:child_process");
      vi.mocked(mockExecSync).mockImplementationOnce(() => {
        throw new Error("no session");
      });

      const tmux = new TmuxManager();
      const status = await tmux.getStatus();

      expect(status).toEqual({ session: "stopped", lastLines: [] });
    });
  });
});

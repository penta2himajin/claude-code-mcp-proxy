import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the TmuxManager by mocking child_process to verify
// the correct shell commands are constructed.

let TmuxManager: any;

// Capture all execSync calls
const execSyncCalls: string[] = [];
const execFileCalls: { cmd: string; args: string[] }[] = [];

// Default capture-pane output (makes handleSetup detect "ready" immediately)
let captureOutput = "Remote Control active\n";

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
      cb(null, { stdout: captureOutput });
    },
  ),
}));

beforeEach(async () => {
  execSyncCalls.length = 0;
  execFileCalls.length = 0;
  captureOutput = "Remote Control active\n";
  // Reset mocks to default implementation (important after handleSetup tests override them)
  const cp = await import("node:child_process");
  vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
    execSyncCalls.push(cmd);
    return Buffer.from("");
  });
  vi.mocked(cp.execFile).mockImplementation(
    ((cmd: string, args: string[], cb: (err: Error | null, result: { stdout: string }) => void) => {
      execFileCalls.push({ cmd, args });
      cb(null, { stdout: captureOutput });
    }) as any,
  );
  const mod = await import("../src/tmux-manager.ts");
  TmuxManager = mod.TmuxManager;
});

describe("TmuxManager", () => {
  describe("startClaude", () => {
    // startClaude tests default to "no existing session" (has-session throws)
    beforeEach(async () => {
      const cp = await import("node:child_process");
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        execSyncCalls.push(cmd);
        if (typeof cmd === "string" && cmd.includes("has-session")) {
          throw new Error("session not found");
        }
        return Buffer.from("");
      });
    });

    it("should check for existing session, create new one if none, and send claude command", async () => {
      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.status).toBe("started");
      expect(result.session).toBe("claude");
      expect(result.ready).toBe(true);

      // Should check for existing session (fails → creates new one)
      expect(execSyncCalls[0]).toContain("tmux has-session -t claude");

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

    it("should reuse existing session when one is already running", async () => {
      const { execSync: mockExecSync } = await import("node:child_process");
      vi.mocked(mockExecSync).mockImplementation((cmd: string) => {
        execSyncCalls.push(cmd);
        // has-session succeeds → session exists
        return Buffer.from("");
      });

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.status).toBe("started");
      expect(result.ready).toBe(true);
      // Should only call has-session, not new-session or send-keys
      expect(execSyncCalls[0]).toContain("tmux has-session -t claude");
      expect(execSyncCalls.find((c) => c.includes("new-session"))).toBeUndefined();
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
      expect(sendKeysCmd).toContain("-p");
      expect(sendKeysCmd).toContain("it");
      expect(sendKeysCmd).toContain("s a test");
      expect(sendKeysCmd).toMatch(/^tmux send-keys -t claude '.*' C-m$/);
    });
  });

  describe("handleSetup (via startClaude)", () => {
    // handleSetup tests also need "no existing session" so startClaude creates one
    beforeEach(async () => {
      const cp = await import("node:child_process");
      vi.mocked(cp.execSync).mockImplementation((cmd: string) => {
        execSyncCalls.push(cmd);
        if (typeof cmd === "string" && cmd.includes("has-session")) {
          throw new Error("session not found");
        }
        return Buffer.from("");
      });
    });

    it("should auto-respond to theme selection prompt", async () => {
      let callCount = 0;
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          callCount++;
          // First capture: theme prompt, second: ready
          const output =
            callCount <= 1
              ? "Choose the text style\n"
              : "Remote Control active\n";
          cb(null, { stdout: output });
        }) as any,
      );

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.ready).toBe(true);
      // Should have sent "1" + Enter for theme selection
      const themeResponse = execSyncCalls.find(
        (c) => c.includes("send-keys") && c.includes("-l") && c.includes("'1'"),
      );
      expect(themeResponse).toBeDefined();
    });

    it("should auto-respond to Press Enter to continue", async () => {
      let callCount = 0;
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          callCount++;
          const output =
            callCount <= 1
              ? "Press Enter to continue\n"
              : "Remote Control active\n";
          cb(null, { stdout: output });
        }) as any,
      );

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.ready).toBe(true);
      // Should have sent C-m (Enter)
      const enterCmd = execSyncCalls.filter(
        (c) => c === "tmux send-keys -t claude C-m",
      );
      expect(enterCmd.length).toBeGreaterThanOrEqual(1);
    });

    it("should auto-respond to trust folder prompt", async () => {
      let callCount = 0;
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          callCount++;
          const output =
            callCount <= 1
              ? "Yes, I trust this folder\n"
              : "Remote Control active\n";
          cb(null, { stdout: output });
        }) as any,
      );

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.ready).toBe(true);
      const trustResponse = execSyncCalls.find(
        (c) => c.includes("send-keys") && c.includes("-l") && c.includes("'1'"),
      );
      expect(trustResponse).toBeDefined();
    });

    it("should auto-respond to bypass permissions prompt", async () => {
      let callCount = 0;
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          callCount++;
          const output =
            callCount <= 1
              ? "Yes, I accept\n"
              : "Remote Control active\n";
          cb(null, { stdout: output });
        }) as any,
      );

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.ready).toBe(true);
      const acceptResponse = execSyncCalls.find(
        (c) => c.includes("send-keys") && c.includes("-l") && c.includes("'2'"),
      );
      expect(acceptResponse).toBeDefined();
    });

    it("should detect login required and return login URL", async () => {
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          cb(null, {
            stdout:
              "Paste code here\nhttps://claude.com/cai/oauth/authorize?foo=bar\n",
          });
        }) as any,
      );

      const tmux = new TmuxManager();
      const result = await tmux.startClaude();

      expect(result.ready).toBe(false);
      expect(result.needsLogin).toBe(true);
      expect(result.loginUrl).toContain("https://claude.com/cai/oauth/authorize");
    });

    it("should return ready:false after max attempts", async () => {
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          cb(null, { stdout: "loading...\n" });
        }) as any,
      );

      const tmux = new TmuxManager();
      // Use very short interval and few attempts to avoid slow test
      const result = await (tmux as any).handleSetup(2, 10);

      expect(result.ready).toBe(false);
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

      expect(output).toBe("Remote Control active\n");
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
      expect(status.lastLines).toContain("Remote Control active");
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

  describe("isActive", () => {
    it("should return active:true when output changes between calls", async () => {
      const tmux = new TmuxManager();

      // First call — establishes baseline
      const first = await tmux.isActive();
      expect(first.active).toBe(true);
      expect(first.idleSeconds).toBe(0);
    });

    it("should return active:false when output stays the same", async () => {
      const tmux = new TmuxManager();

      // First call sets baseline
      await tmux.isActive();
      // Second call — same output
      const second = await tmux.isActive();
      expect(second.active).toBe(false);
    });

    it("should return active:true when output contains busy indicators", async () => {
      const { execFile: mockExecFile } = await import("node:child_process");
      vi.mocked(mockExecFile).mockImplementation(
        ((_cmd: string, _args: string[], cb: any) => {
          cb(null, { stdout: "Processing... Clauding…\n" });
        }) as any,
      );

      const tmux = new TmuxManager();
      // First call sets baseline
      await tmux.isActive();
      // Second call — same output but contains busy indicator
      const result = await tmux.isActive();
      expect(result.active).toBe(true);
    });

    it("should return active:false when session does not exist", async () => {
      const { execSync: mockExecSync } = await import("node:child_process");
      vi.mocked(mockExecSync).mockImplementationOnce(() => {
        throw new Error("no session");
      });

      const tmux = new TmuxManager();
      const result = await tmux.isActive();
      expect(result.active).toBe(false);
    });
  });
});

import { execSync, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION = "claude";

export interface StartClaudeOptions {
  prompt?: string;
  workdir?: string;
}

export class TmuxManager {
  /** Start Claude Code in a tmux session */
  async startClaude({ prompt, workdir = "/workspace" }: StartClaudeOptions = {}) {
    // If session already exists (e.g. started by entrypoint), reuse it
    try {
      execSync(`tmux has-session -t ${SESSION} 2>/dev/null`);
      // Session exists — just run setup handler and return
      const setupResult = await this.handleSetup();
      return { status: "started" as const, session: SESSION, ...setupResult };
    } catch {
      // No session — create one
    }

    // Start new tmux session with large window
    execSync(`tmux new-session -d -s ${SESSION} -x 220 -y 50`);

    // Build claude command
    // --dangerously-skip-permissions: skip all permission prompts
    // --rc: enable Remote Control (returns RC URL for browser access)
    let cmd = "claude --dangerously-skip-permissions --rc";
    if (prompt) {
      // Use -p for one-shot prompt, otherwise interactive
      cmd += ` -p ${shellEscape(prompt)}`;
    }

    // Send command to tmux
    execSync(`tmux send-keys -t ${SESSION} ${shellEscape(`cd ${workdir} && ${cmd}`)} C-m`);

    // Auto-handle setup prompts (theme, security notes, trust, bypass permissions)
    const setupResult = await this.handleSetup();

    return { status: "started" as const, session: SESSION, ...setupResult };
  }

  /**
   * Poll tmux output and auto-respond to Claude Code setup prompts.
   * Returns when the interactive prompt `❯` appears or login is required.
   */
  private async handleSetup(
    maxAttempts = 30,
    intervalMs = 2000,
  ): Promise<{ ready: boolean; needsLogin?: boolean; loginUrl?: string }> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(intervalMs);
      const output = await this.capturePane(50);

      // Ready: interactive prompt visible (RC URL or prompt line)
      if (output.includes("Remote Control active") || output.includes("/remote-control is active")) {
        return { ready: true };
      }

      // Needs manual OAuth login
      if (output.includes("Paste code here")) {
        const urlMatch = output.match(/(https:\/\/claude\.com\/cai\/oauth\/authorize\S+)/);
        return { ready: false, needsLogin: true, loginUrl: urlMatch?.[1] };
      }

      // Theme selection: pick Dark mode
      if (output.includes("Choose the text style")) {
        this.sendKeysSync("1");
        continue;
      }

      // Settings error: continue without broken settings (safety net)
      if (output.includes("Continue without these settings")) {
        this.sendKeysSync("2");
        continue;
      }

      // "Press Enter to continue" (security notes, etc.)
      if (output.includes("Press Enter to continue")) {
        execSync(`tmux send-keys -t ${SESSION} C-m`);
        continue;
      }

      // Trust folder: "Yes, I trust this folder"
      if (output.includes("Yes, I trust this folder")) {
        this.sendKeysSync("1");
        continue;
      }

      // Bypass permissions: "Yes, I accept"
      if (output.includes("Yes, I accept")) {
        this.sendKeysSync("2");
        continue;
      }
    }

    return { ready: false };
  }

  /** Synchronous send-keys helper for setup automation */
  private sendKeysSync(text: string) {
    execSync(`tmux send-keys -t ${SESSION} -l ${shellEscape(text)}`);
    execSync(`tmux send-keys -t ${SESSION} C-m`);
  }

  /** Stop the Claude Code tmux session */
  async stopClaude() {
    try {
      execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`);
      return { status: "stopped" as const };
    } catch {
      return { status: "not_running" as const };
    }
  }

  /** Send keystrokes to the tmux session */
  async sendKeys(text: string, enter = true) {
    try {
      // Use tmux send-keys with literal flag for safety
      execSync(`tmux send-keys -t ${SESSION} -l ${shellEscape(text)}`);
      if (enter) {
        execSync(`tmux send-keys -t ${SESSION} C-m`);
      }
      return { status: "sent" as const };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { status: "error" as const, error: message };
    }
  }

  /** Capture current terminal output */
  async capturePane(lines = 100): Promise<string> {
    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane", "-t", SESSION, "-p", "-S", `-${lines}`,
      ]);
      return stdout;
    } catch {
      return "";
    }
  }

  /** Get session status with recent output */
  async getStatus() {
    try {
      execSync(`tmux has-session -t ${SESSION} 2>/dev/null`);
      const output = await this.capturePane(10);
      const lines = output.trim().split("\n").filter((l) => l.length > 0);
      return {
        session: "running" as const,
        lastLines: lines.slice(-10),
      };
    } catch {
      return { session: "stopped" as const, lastLines: [] as string[] };
    }
  }

  /**
   * Check if the Claude Code session is actively doing work.
   * Compares current output with previous snapshot to detect changes.
   * Also checks for known activity indicators (spinners, progress).
   */
  private lastOutputHash = "";
  private idleSince = 0;

  async isActive(): Promise<{ active: boolean; idleSeconds: number }> {
    try {
      execSync(`tmux has-session -t ${SESSION} 2>/dev/null`);
    } catch {
      return { active: false, idleSeconds: 0 };
    }

    const output = await this.capturePane(30);
    const trimmed = output.trim();

    // Compute simple hash of output to detect changes
    const hash = simpleHash(trimmed);

    if (hash !== this.lastOutputHash) {
      // Output changed — session is active
      this.lastOutputHash = hash;
      this.idleSince = Date.now();
      return { active: true, idleSeconds: 0 };
    }

    // Output unchanged — check how long it's been idle
    const idleSeconds = this.idleSince > 0
      ? Math.floor((Date.now() - this.idleSince) / 1000)
      : 0;

    // Consider active if output contains known busy indicators
    const busyPatterns = ["Clauding…", "Working…", "Thinking…", "Running", "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const isBusy = busyPatterns.some((p) => trimmed.includes(p));

    if (isBusy) {
      this.idleSince = Date.now();
      return { active: true, idleSeconds: 0 };
    }

    return { active: false, idleSeconds };
  }
}

/** Shell-escape a string for safe use in shell commands */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple string hash for change detection (not cryptographic) */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

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
    // Kill existing session if any
    try {
      execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`);
    } catch {}

    // Start new tmux session with large window
    execSync(`tmux new-session -d -s ${SESSION} -x 220 -y 50`);

    // Build claude command
    let cmd = "claude --dangerously-skip-permissions";
    if (prompt) {
      // Use -p for one-shot prompt, otherwise interactive
      cmd += ` -p ${shellEscape(prompt)}`;
    }

    // Send command to tmux
    execSync(`tmux send-keys -t ${SESSION} ${shellEscape(`cd ${workdir} && ${cmd}`)} C-m`);

    return { status: "started" as const, session: SESSION };
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
}

/** Shell-escape a string for safe use in shell commands */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

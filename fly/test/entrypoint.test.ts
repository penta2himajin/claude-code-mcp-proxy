import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static analysis of entrypoint.sh to prevent regressions.
 *
 * Claude Code requires write access to:
 * - ~/.claude/.credentials.json (OAuth token refresh)
 * - ~/.claude/.claude.json (settings, atomic write)
 * - ~/.claude/sessions/, cache/, plans/, etc. (runtime state)
 *
 * Locking ANY of these causes Claude Code to hang silently on startup.
 * Protection against Claude Code's own tools is via managed-settings.json deny rules.
 */

const entrypointPath = join(__dirname, "..", "entrypoint.sh");

describe("entrypoint.sh safety checks", () => {
  const content = readFileSync(entrypointPath, "utf-8");

  // ── Permission lockout prevention (PR #6, #10) ──

  it("should not chmod a-w on .credentials.json (breaks OAuth token refresh)", () => {
    const lines = content.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && t.includes("chmod") && t.includes("a-w") && t.includes(".credentials.json");
    });
    expect(
      lines,
      "chmod a-w on .credentials.json found. Claude Code needs write access to refresh OAuth tokens.",
    ).toHaveLength(0);
  });

  it("should not chmod a-w on .claude.json (breaks settings updates)", () => {
    const lines = content.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && t.includes("chmod") && t.includes("a-w") && t.includes(".claude.json");
    });
    expect(
      lines,
      "chmod a-w on .claude.json found. Claude Code uses atomic write on this file.",
    ).toHaveLength(0);
  });

  it("should not use recursive chmod on the config directory (PR #6)", () => {
    const dangerousPatterns = [
      /chmod\s+-R\s+a-w\s+\/workspace\/\.claude-config[^/]/,
      /find\s+\/workspace\/\.claude-config\s.*-exec\s+chmod\s+a-w/,
    ];
    for (const pattern of dangerousPatterns) {
      const match = content.match(pattern);
      expect(match, `Dangerous pattern: ${match?.[0]}`).toBeNull();
    }
  });

  // ── Token expiry handling (PR #10) ──

  it("should check OAuth token expiry before starting Claude Code", () => {
    expect(content).toContain("expiresAt");
    expect(content).toContain("rm -f");
    expect(content).toContain(".credentials.json");
  });

  it("should validate credentials with claude auth status (catches server-side revocation)", () => {
    // expiresAt alone is insufficient — tokens can be revoked server-side
    // or have no expiresAt set. claude auth status catches all cases.
    expect(content).toContain("claude auth status");
  });

  it("should remove stale credentials before tmux session starts", () => {
    const lines = content.split("\n");
    const expiryCheckLine = lines.findIndex((l) => l.includes("expiresAt"));
    const tmuxStartLine = lines.findIndex((l) =>
      !l.trim().startsWith("#") && l.includes("tmux new-session"),
    );
    expect(expiryCheckLine, "Token expiry check not found").toBeGreaterThanOrEqual(0);
    expect(tmuxStartLine, "tmux session start not found").toBeGreaterThanOrEqual(0);
    expect(
      expiryCheckLine,
      "Token expiry check must happen BEFORE tmux session starts Claude Code",
    ).toBeLessThan(tmuxStartLine);
  });

  // ── CRLF prevention (PR #3) ──

  it("should use LF line endings (not CRLF)", () => {
    expect(content).not.toContain("\r\n");
  });

  // ── PATH setup (PR #8, #9) ──

  it("should set mise shims PATH early (entrypoint runs non-interactively)", () => {
    const lines = content.split("\n");
    const pathLine = lines.findIndex((l) =>
      l.includes("mise/shims") && l.includes("export PATH"),
    );
    const firstToolUse = lines.findIndex((l, i) => {
      if (i <= pathLine) return false;
      const trimmed = l.trim();
      if (trimmed.startsWith("#")) return false;
      return /\b(claude|tsx|node|bun|mise)\b/.test(trimmed);
    });

    expect(pathLine, "mise shims PATH export not found").toBeGreaterThanOrEqual(0);
    expect(firstToolUse, "no tool usage found after PATH export").toBeGreaterThan(pathLine);
  });

  // ── Config persistence ──

  it("should symlink ~/.claude to persistent volume", () => {
    expect(content).toContain("ln -sfn /workspace/.claude-config");
    expect(content).toMatch(/\$HOME\/\.claude/);
  });

  it("should restore .claude.json from backup when missing", () => {
    expect(content).toContain("backups/.claude.json.backup");
    expect(content).toMatch(/if \[.*!.*-f.*\.claude\.json/);
  });

  it("should symlink ~/.claude.json to volume (atomic write breaks direct symlink)", () => {
    expect(content).toContain("ln -sf /workspace/.claude-config/.claude.json");
  });

  // ── Claude Code auto-start (PR #7) ──

  it("should auto-start Claude Code in tmux with --dangerously-skip-permissions --rc", () => {
    const tmuxLines = content.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && t.includes("tmux send-keys") && t.includes("claude");
    });
    expect(tmuxLines.length).toBeGreaterThanOrEqual(1);

    const claudeCmd = tmuxLines[0];
    expect(claudeCmd).toContain("--dangerously-skip-permissions");
    expect(claudeCmd).toContain("--rc");
  });

  it("should start HTTP server with exec (replaces shell process)", () => {
    const lines = content.split("\n");
    const execLine = lines.find((l) => l.trim().startsWith("exec ") && l.includes("tsx"));
    expect(execLine, "exec tsx not found — server must replace shell process").toBeDefined();
  });
});

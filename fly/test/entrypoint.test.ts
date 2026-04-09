import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static analysis of entrypoint.sh to prevent regressions where
 * overly broad chmod commands lock files Claude Code needs to write.
 *
 * Claude Code requires write access to ~/.claude/ for:
 * - sessions/, cache/, plans/, shell-snapshots/ (runtime state)
 * - history.jsonl, settings.json (user preferences)
 * - mcp-needs-auth-cache.json (MCP state)
 *
 * Only auth-critical files should be locked:
 * - .credentials.json, .claude.json, gh/hosts.yml
 */

const entrypointPath = join(__dirname, "..", "entrypoint.sh");

describe("entrypoint.sh safety checks", () => {
  const content = readFileSync(entrypointPath, "utf-8");

  it("should not use recursive chmod on the entire config directory", () => {
    // Match patterns like: chmod -R a-w /workspace/.claude-config
    // or: find /workspace/.claude-config ... -exec chmod a-w {} +
    const dangerousPatterns = [
      /chmod\s+-R\s+a-w\s+\/workspace\/\.claude-config[^/]/,
      /find\s+\/workspace\/\.claude-config\s.*-exec\s+chmod\s+a-w/,
    ];

    for (const pattern of dangerousPatterns) {
      const match = content.match(pattern);
      expect(match, `Dangerous pattern found: ${match?.[0]}\nThis will lock files Claude Code needs to write at startup, causing it to freeze.`).toBeNull();
    }
  });

  it("should only lock specific auth-critical files", () => {
    // Extract all chmod lines (excluding comments)
    const chmodLines = content
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed.includes("chmod") && !trimmed.startsWith("#");
      });

    // Allowed lock targets (specific files, not directories)
    const allowedTargets = [
      ".credentials.json",
      ".claude.json",
      "hosts.yml",
    ];

    for (const line of chmodLines) {
      // Skip chown lines and chmod +x (making executable)
      if (line.includes("chown") || line.includes("+x")) continue;
      // Skip lines that remove write (the ones we care about)
      if (!line.includes("a-w")) continue;

      const targetsOneOfAllowed = allowedTargets.some((t) => line.includes(t));
      expect(
        targetsOneOfAllowed,
        `chmod a-w targets unknown file: "${line.trim()}"\nOnly auth files should be locked. Claude Code needs write access to config dir.`,
      ).toBe(true);
    }
  });

  it("should use LF line endings (not CRLF)", () => {
    expect(content).not.toContain("\r\n");
  });

  it("should set mise shims PATH early (entrypoint runs non-interactively, .bashrc is not sourced)", () => {
    // PATH must be exported before any command that depends on mise-managed tools
    // (claude, tsx, node, etc.). Without this, entrypoint.sh fails with "command not found".
    const lines = content.split("\n");
    const pathLine = lines.findIndex((l) =>
      l.includes("mise/shims") && l.includes("export PATH"),
    );
    // Find first non-PATH tool usage (skip the PATH export line itself)
    const firstToolUse = lines.findIndex((l, i) => {
      if (i <= pathLine) return false;
      const trimmed = l.trim();
      if (trimmed.startsWith("#")) return false;
      return /\b(claude|tsx|node|bun|mise)\b/.test(trimmed);
    });

    expect(pathLine, "mise shims PATH export not found in entrypoint.sh").toBeGreaterThanOrEqual(0);
    expect(firstToolUse, "no tool usage found after PATH export").toBeGreaterThan(pathLine);
  });
});

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

  it("should not chmod a-w on .credentials.json (breaks OAuth token refresh)", () => {
    const lines = content.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && t.includes("chmod") && t.includes("a-w") && t.includes(".credentials.json");
    });
    expect(
      lines,
      "chmod a-w on .credentials.json found. Claude Code needs write access to refresh OAuth tokens. Locking this file causes silent hang on startup.",
    ).toHaveLength(0);
  });

  it("should not chmod a-w on .claude.json (breaks settings updates)", () => {
    const lines = content.split("\n").filter((l) => {
      const t = l.trim();
      return !t.startsWith("#") && t.includes("chmod") && t.includes("a-w") && t.includes(".claude.json");
    });
    expect(
      lines,
      "chmod a-w on .claude.json found. Claude Code uses atomic write on this file. Locking it causes silent hang.",
    ).toHaveLength(0);
  });

  it("should not use recursive chmod on the config directory", () => {
    const dangerousPatterns = [
      /chmod\s+-R\s+a-w\s+\/workspace\/\.claude-config[^/]/,
      /find\s+\/workspace\/\.claude-config\s.*-exec\s+chmod\s+a-w/,
    ];
    for (const pattern of dangerousPatterns) {
      const match = content.match(pattern);
      expect(match, `Dangerous pattern: ${match?.[0]}`).toBeNull();
    }
  });

  it("should handle expired OAuth tokens before starting Claude Code", () => {
    // entrypoint must check token expiry and remove stale credentials
    expect(content).toContain("expiresAt");
    expect(content).toContain("rm -f");
    expect(content).toContain(".credentials.json");
  });

  it("should use LF line endings (not CRLF)", () => {
    expect(content).not.toContain("\r\n");
  });

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
});

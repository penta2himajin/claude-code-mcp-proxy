import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfilePath = join(__dirname, "..", "Dockerfile");

describe("Dockerfile safety checks", () => {
  const content = readFileSync(dockerfilePath, "utf-8");

  it("should run as non-root user (claude --dangerously-skip-permissions refuses root)", () => {
    // The final USER directive must be non-root
    const userDirectives = [...content.matchAll(/^USER\s+(\S+)/gm)];
    expect(userDirectives.length).toBeGreaterThan(0);
    const lastUser = userDirectives[userDirectives.length - 1][1];
    expect(lastUser, "Final USER must be non-root. Claude Code refuses --dangerously-skip-permissions as root.").not.toBe("root");
  });

  it("should deploy managed-settings.json to /etc/claude-code/", () => {
    expect(content).toContain("/etc/claude-code/managed-settings.json");
  });

  it("should add mise shims to PATH in .bashrc (for tmux interactive sessions)", () => {
    expect(content).toContain("mise/shims");
    expect(content).toContain(".bashrc");
  });

  it("should install Claude Code CLI", () => {
    expect(content).toContain("@anthropic-ai/claude-code");
  });

  it("should install tsx for TypeScript execution", () => {
    expect(content).toContain("tsx");
  });

  it("should use entrypoint.sh as CMD (not hardcoded node/tsx command)", () => {
    // entrypoint.sh handles volume setup, credentials, and PATH before starting
    expect(content).toMatch(/CMD\s+\[.*entrypoint\.sh/);
  });

  it("should set BASH_ENV for non-interactive shells (Claude Code Bash tool)", () => {
    // Claude Code's Bash tool runs /bin/bash -c which is non-interactive.
    // .bashrc has a guard ([ -z "$PS1" ] && return) that skips PATH setup.
    // BASH_ENV points to a separate file that's always sourced.
    expect(content).toContain("BASH_ENV");
    expect(content).toContain(".mise-env.sh");
  });
});

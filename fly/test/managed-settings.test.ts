import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const settingsPath = join(__dirname, "..", "managed-settings.json");

describe("managed-settings.json deny rules", () => {
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const denyRules: string[] = settings.permissions?.deny || [];

  it("should have deny rules defined", () => {
    expect(denyRules.length).toBeGreaterThan(0);
  });

  it("should protect config directory from Claude Code's own tools", () => {
    // Claude Code must not be able to rm/mv/edit/write config files via its tools
    const configProtections = denyRules.filter((r) => r.includes(".claude-config"));
    expect(configProtections.length).toBeGreaterThanOrEqual(3); // rm, mv, chmod + Edit + Write
    expect(denyRules).toContainEqual(expect.stringContaining("Edit(/workspace/.claude-config"));
    expect(denyRules).toContainEqual(expect.stringContaining("Write(/workspace/.claude-config"));
  });

  it("should protect gh CLI credentials", () => {
    const ghProtections = denyRules.filter((r) => r.includes("gh") || r.includes(".config/gh"));
    expect(ghProtections.length).toBeGreaterThanOrEqual(2);
  });

  it("should block force-push to main/master", () => {
    const forcePush = denyRules.filter((r) => r.includes("--force") || r.includes("-f"));
    expect(forcePush.length).toBeGreaterThanOrEqual(2);

    const mainPush = denyRules.filter((r) => r.includes("push") && (r.includes("main") || r.includes("master")));
    expect(mainPush.length).toBeGreaterThanOrEqual(2);
  });

  it("should block destructive system commands", () => {
    const destructive = ["shutdown", "reboot", "kill -9 1", "mkfs", "dd"];
    for (const cmd of destructive) {
      const found = denyRules.some((r) => r.includes(cmd));
      expect(found, `Missing deny rule for destructive command: ${cmd}`).toBe(true);
    }
  });

  it("should block accidental package publishing", () => {
    const publish = denyRules.filter((r) => r.includes("publish"));
    expect(publish.length).toBeGreaterThanOrEqual(1);
  });

  it("should block rm -rf", () => {
    const rmRf = denyRules.filter((r) => r.includes("rm -rf") || r.includes("rm -r"));
    expect(rmRf.length).toBeGreaterThanOrEqual(1);
  });
});

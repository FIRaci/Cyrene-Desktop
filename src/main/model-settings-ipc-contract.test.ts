import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("model settings privileged IPC wiring", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");

  it.each([
    "SETTINGS_GET_CONFIG",
    "SETTINGS_SAVE_CONFIG",
    "SETTINGS_TEST_CONNECTION",
    "SETTINGS_TEST_VISION",
  ])("authenticates %s through the settings main-frame policy", (channel) => {
    const start = source.indexOf(`IPC.${channel}`);
    expect(start).toBeGreaterThan(0);
    const handler = source.slice(start, start + 500);
    expect(handler).toContain("assertSettingsMainFrame(event)");
  });

  it("redacts GET/SAVE responses and restores retained secrets before persistence", () => {
    const getStart = source.indexOf("IPC.SETTINGS_GET_CONFIG");
    expect(source.slice(getStart, getStart + 300)).toContain("redactModelSettings(loadModelSettings())");
    const saveStart = source.indexOf("IPC.SETTINGS_SAVE_CONFIG");
    const saveHandler = source.slice(saveStart, saveStart + 600);
    expect(saveHandler).toContain("applyModelSecretPatch(settings, loadModelSettings())");
    expect(saveHandler).toContain("return redactModelSettings(saved)");
  });
});

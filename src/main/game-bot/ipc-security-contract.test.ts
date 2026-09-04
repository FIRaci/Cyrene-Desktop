import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("game-bot IPC security contract", () => {
  it("authenticates every renderer handler and returns redacted configuration", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/main/game-bot/index.ts"), "utf8");
    for (const channel of [
      "GAME_BOT_GET_CONFIG", "GAME_BOT_SAVE_CONFIG", "GAME_BOT_LIST_RECIPES",
      "GAME_BOT_LIST_REFS", "GAME_BOT_REFS_DIR", "GAME_BOT_START", "GAME_BOT_STOP",
    ]) {
      const start = source.indexOf(`IPC.${channel}`);
      expect(start, channel).toBeGreaterThan(-1);
      expect(source.slice(start, start + 300), channel).toContain("requireSettings(event)");
    }
    expect(source).toContain('apiKey: "", hasKey: Boolean(settings.vlm.apiKey)');
    expect(source).toContain('patch.vlm.clearApiKey ? "" : supplied || stored.vlm.apiKey');
  });

  it("wires the game-bot predicate to the trusted Settings main frame", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(source).toContain('isSettingsSender: (event) => isTrustedMainFrameSender(event, settingsWindow, expectedRendererDocument("settings/index.html"))');
  });
});

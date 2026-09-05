// settings-store — game-bot settings persistence. userData/game-bot-settings.json.
// Follows GeneralSettings pattern: load / save / normalize triad.
// Only module touching electron (app.getPath).

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_VISION_MODEL } from "../../shared/model-endpoint";

export interface GameBotSettings {
  enabled: boolean;
  exePath: string;
  activeRecipe: string;   // Script filename (excluding .yaml)
  vlm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

const DEFAULTS: GameBotSettings = {
  enabled: false,
  exePath: "",
  activeRecipe: "star-rail-daily",
  vlm: { baseUrl: DEFAULT_OLLAMA_BASE_URL, apiKey: "", model: DEFAULT_OLLAMA_VISION_MODEL },
};

// IDs are filenames without an extension. Keeping this deliberately narrow makes
// them safe to use below both the bundled recipe root and the per-user refs root.
const GAME_BOT_IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,63})$/;

export function isGameBotIdentifier(value: unknown): value is string {
  return typeof value === "string" && GAME_BOT_IDENTIFIER.test(value);
}

function filePath(): string {
  return path.join(app.getPath("userData"), "game-bot-settings.json");
}

function normalize(input: Partial<GameBotSettings> | null | undefined): GameBotSettings {
  const v = (input?.vlm ?? {}) as { baseUrl?: string; apiKey?: string; model?: string };
  return {
    enabled: Boolean(input?.enabled),
    exePath: typeof input?.exePath === "string" ? input.exePath : "",
    activeRecipe: isGameBotIdentifier(input?.activeRecipe)
      ? input.activeRecipe : DEFAULTS.activeRecipe,
    vlm: {
      baseUrl: typeof v.baseUrl === "string" && v.baseUrl.trim() ? v.baseUrl.trim() : DEFAULTS.vlm.baseUrl,
      apiKey: typeof v.apiKey === "string" ? v.apiKey.trim() : "",
      model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULTS.vlm.model,
    },
  };
}

export function loadGameBotSettings(): GameBotSettings {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return { ...DEFAULTS };
    return normalize(JSON.parse(fs.readFileSync(p, "utf8")) as Partial<GameBotSettings>);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveGameBotSettings(patch: Partial<GameBotSettings>): GameBotSettings {
  const existing = loadGameBotSettings();
  const merged: Partial<GameBotSettings> = { ...existing, ...patch };
  if (patch.vlm) merged.vlm = { ...existing.vlm, ...patch.vlm };
  const final = normalize(merged);
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(final, null, 2), "utf8");
  return final;
}

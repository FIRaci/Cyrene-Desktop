// game-bot 启动入口 + IPC + agent 触发工具。
// 汇总点：组装 BotTools（screenshot/input/vlm-locator/refs-store）→ 注册 IPC → 注册 game_bot_start 工具。
// 唯一碰 electron 的汇总模块（ipcMain/BrowserWindow/app）；引擎本身不碰。

import * as fs from "fs";
import * as path from "path";
import { app, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { toolRegistry } from "../orchestrator/tool-registry";
import { IPC } from "../../shared/ipc-channels";
import { parseRecipe } from "./script-parser";
import { runRecipe } from "./engine";
import type { BotTools } from "./bot-tools";
import type { GameRecipe } from "./types";
import { isGameBotIdentifier, loadGameBotSettings, saveGameBotSettings, type GameBotSettings } from "./settings-store";
import { listRefs, readRef, refsDirPath } from "./refs-store";
import { captureScreen as captureDesktopScreen } from "./screenshot";
import type { ScreenshotResult } from "./screenshot";
import * as input from "./input";
import * as vlm from "./vlm-locator";

const LOG = "[GameBot]";
let captureScreen: () => Promise<ScreenshotResult | null> = async () => null;

function recipesDirPath(): string {
  return path.resolve(app.getAppPath(), "game-recipes");
}

function recipeFilePath(id: string, ext: ".yaml" | ".yml"): string | null {
  if (!isGameBotIdentifier(id)) return null;
  const root = recipesDirPath();
  const candidate = path.resolve(root, id + ext);
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) return null;
  if (fs.existsSync(root) && fs.existsSync(candidate)) {
    const canonicalRoot = fs.realpathSync(root);
    const canonicalCandidate = fs.realpathSync(candidate);
    const canonicalRelative = path.relative(canonicalRoot, canonicalCandidate);
    if (canonicalRelative.startsWith(".." + path.sep) || canonicalRelative === ".." || path.isAbsolute(canonicalRelative)) return null;
  }
  return candidate;
}

/** 扫描内置 game-recipes/ 目录，返回脚本元数据列表。 */
export function listRecipes(): { id: string; name: string }[] {
  const dir = recipesDirPath();
  const result: { id: string; name: string }[] = [];
  try {
    if (!fs.existsSync(dir)) return result;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
      const id = f.replace(/\.(ya?ml)$/, "");
      const recipePath = recipeFilePath(id, f.endsWith(".yaml") ? ".yaml" : ".yml");
      if (!recipePath) continue;
      const r = parseRecipe(fs.readFileSync(recipePath, "utf8"));
      result.push({ id, name: r.ok ? r.recipe.name : id });
    }
  } catch (err) {
    console.warn(LOG, "Failed to list recipes:", err);
  }
  return result;
}

/** 读脚本文件 → GameRecipe。 */
function loadRecipe(id: string): GameRecipe | null {
  if (!isGameBotIdentifier(id)) return null;
  for (const ext of [".yaml", ".yml"]) {
    const p = recipeFilePath(id, ext as ".yaml" | ".yml");
    if (!p) return null;
    if (fs.existsSync(p)) {
      const r = parseRecipe(fs.readFileSync(p, "utf8"));
      return r.ok ? r.recipe : null;
    }
  }
  return null;
}

// ── 运行时状态 ──
let runSignal: { aborted: boolean } | null = null;
let runningRecipe: string | null = null;

/** 组装 BotTools 实现（注入引擎）。 */
function buildTools(settings: GameBotSettings): BotTools {
  const vlmConfig = { baseUrl: settings.vlm.baseUrl, apiKey: settings.vlm.apiKey, model: settings.vlm.model };
  const curRecipe = () => runningRecipe ?? settings.activeRecipe;
  return {
    launch: async (exe) => {
      const { spawn } = await import("child_process");
      spawn(exe, [], { detached: true, shell: false, stdio: "ignore" }).unref();
    },
    screenshot: captureScreen,
    click: input.click,
    clickCenter: async () => {
      const s = await captureScreen();
      if (s) await input.clickCenter(s.width, s.height);
    },
    key: input.keyPress,
    locate: async (refName, targetDesc) => {
      const ref = readRef(curRecipe(), refName);
      const screen = await captureScreen();
      if (!screen || !ref) return null;
      return vlm.locate(vlmConfig, screen, [ref], targetDesc ?? "", screen.width, screen.height);
    },
    select: async (desc) => {
      const screen = await captureScreen();
      if (!screen) return null;
      return vlm.locate(vlmConfig, screen, [], desc, screen.width, screen.height);
    },
    check: async (ask, refName) => {
      const ref = refName ? (readRef(curRecipe(), refName) ?? undefined) : undefined;
      const screen = await captureScreen();
      if (!screen) return null;
      return vlm.check(vlmConfig, screen, ask, ref);
    },
    compare: async (refNames, ask) => {
      const refs = refNames
        .map((n) => readRef(curRecipe(), n))
        .filter((x): x is { base64: string; mime: string } => x !== null);
      const screen = await captureScreen();
      if (!screen) return null;
      return vlm.compare(vlmConfig, screen, refs, ask);
    },
  };
}

function broadcastProgress(info: { index: number; total: number; desc: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send(IPC.GAME_BOT_PROGRESS, info); } catch { /* ignore */ }
    }
  }
}

/** 启动代肝（设置面板 / agent 都调这个）。异步运行，不阻塞调用方。 */
export async function startGameBot(): Promise<{ ok: boolean; error?: string }> {
  if (runSignal) return { ok: false, error: "Game automation is already running." };
  const settings = loadGameBotSettings();
  if (!settings.enabled) return { ok: false, error: "Game automation is disabled. Enable it in Settings > Plugins > Game Bot." };
  if (!settings.exePath) return { ok: false, error: "The game executable path is not configured." };
  if (!vlm.isVlmConfigUsable(settings.vlm))
    return { ok: false, error: "No usable VLM is configured. Set a Base URL and Model ID; non-local endpoints also require an API key." };
  const recipe = loadRecipe(settings.activeRecipe);
  if (!recipe) return { ok: false, error: "Recipe not found: " + settings.activeRecipe };

  runningRecipe = settings.activeRecipe;
  runSignal = { aborted: false };
  const tools = buildTools(settings);

  void runRecipe(recipe, {
    tools,
    vars: { exe_path: settings.exePath, vlm_config: settings.vlm.model },
    onProgress: broadcastProgress,
    signal: runSignal,
  }).then((res) => {
    console.log(LOG, "Automation finished:", res.ok ? "success" : "failed (" + res.error + ")", res.completed + "/" + res.total);
    broadcastProgress({ index: -1, total: res.total, desc: res.ok ? "Completed" : "Failed: " + (res.error ?? "") });
  }).catch((err) => {
    console.error(LOG, "Automation failed:", err);
    broadcastProgress({ index: -1, total: 0, desc: "Error: " + (err instanceof Error ? err.message : String(err)) });
  }).finally(() => {
    runSignal = null;
    runningRecipe = null;
  });
  return { ok: true };
}

/** 停止代肝。 */
export function stopGameBot(): { ok: boolean } {
  if (runSignal) runSignal.aborted = true;
  return { ok: true };
}

/** 注册 IPC + game_bot_start 工具。app.whenReady 后调一次。 */
type PublicGameBotSettings = Omit<GameBotSettings, "vlm"> & {
  vlm: Omit<GameBotSettings["vlm"], "apiKey"> & { apiKey: ""; hasKey: boolean };
};

function toPublicGameBotSettings(settings: GameBotSettings): PublicGameBotSettings {
  return { ...settings, vlm: { ...settings.vlm, apiKey: "", hasKey: Boolean(settings.vlm.apiKey) } };
}

function restoreGameBotSecret(patch: Partial<GameBotSettings> & { vlm?: Partial<GameBotSettings["vlm"]> & { clearApiKey?: boolean } }): Partial<GameBotSettings> {
  if (!patch.vlm) return patch;
  const stored = loadGameBotSettings();
  const supplied = typeof patch.vlm.apiKey === "string" ? patch.vlm.apiKey.trim() : "";
  return {
    ...patch,
    vlm: { ...patch.vlm, apiKey: patch.vlm.clearApiKey ? "" : supplied || stored.vlm.apiKey },
  } as Partial<GameBotSettings>;
}

export function initGameBot(options: { captureScreen?: () => Promise<ScreenshotResult | null>; isSettingsSender?: (event: IpcMainInvokeEvent) => boolean } = {}): void {
  captureScreen = options.captureScreen ?? captureDesktopScreen;
  const requireSettings = (event: IpcMainInvokeEvent): void => {
    if (!options.isSettingsSender || !options.isSettingsSender(event)) throw new Error("UNTRUSTED_GAME_BOT_SENDER");
  };
  ipcMain.handle(IPC.GAME_BOT_GET_CONFIG, (event) => {
    requireSettings(event);
    return toPublicGameBotSettings(loadGameBotSettings());
  });
  ipcMain.handle(IPC.GAME_BOT_SAVE_CONFIG, (event, patch: unknown) => {
    requireSettings(event);
    const saved = saveGameBotSettings(restoreGameBotSecret(patch as Partial<GameBotSettings>));
    // enabled 开关同步到 agent 工具，关了 agent 就看不到/调不到
    toolRegistry.setEnabled("game_bot_start", saved.enabled);
    return toPublicGameBotSettings(saved);
  });
  ipcMain.handle(IPC.GAME_BOT_LIST_RECIPES, (event) => { requireSettings(event); return listRecipes(); });
  ipcMain.handle(IPC.GAME_BOT_LIST_REFS, (event, recipeId: string) => { requireSettings(event); return listRefs(recipeId); });
  ipcMain.handle(IPC.GAME_BOT_REFS_DIR, (event, recipeId: string) => { requireSettings(event); return refsDirPath(recipeId); });
  ipcMain.handle(IPC.GAME_BOT_START, (event) => {
    requireSettings(event);
    return startGameBot();
  });
  ipcMain.handle(IPC.GAME_BOT_STOP, (event) => { requireSettings(event); return stopGameBot(); });

  // agent 触发工具：用户在聊天里要代肝时调用。enabled 跟随配置开关。
  const initialSettings = loadGameBotSettings();
  toolRegistry.register({
    id: "game_bot_start",
    name: "Game Bot Automator",
    description:
      "Start game automation to run daily tasks automatically via preset recipes (e.g. Star Rail).\n\n" +
      "When to use:\n- User asks to automate daily missions / clear stamina / start game bot\n\n" +
      "When NOT to use:\n- User is asking how to configure game bot (guide to Settings → Plugins → Game Bot)\n\n" +
      "No parameters required. Engine runs independently in background.",
    enabled: initialSettings.enabled,
    risk: "input-control",
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async () => {
      const r = await startGameBot();
      if (r.ok) return "✅ Game bot started, running in background. Progress will be updated in real-time.";
      return "[Error] Failed to start game bot: " + (r.error ?? "unknown error");
    },
  });

  console.log(LOG, "Initialized: IPC + game_bot_start tool, available scripts:", listRecipes().map((r) => r.id).join(", ") || "(none)");
}

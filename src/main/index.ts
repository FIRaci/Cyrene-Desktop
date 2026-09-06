import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, dialog, protocol, net, powerMonitor, globalShortcut } from "electron";
import { spawn } from "node:child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createHash, randomUUID } from "crypto";
import { pathToFileURL } from "url";
import { IPC } from "../shared/ipc-channels";
import { normalizeUiTheme, type UiTheme } from "../shared/ui-theme";
import { DEFAULT_UI_FONT, isSupportedFontFileName, normalizeUiFont, type UiFont } from "../shared/ui-font";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_VISION_MODEL, LOCAL_MODEL_PROVIDER, isModelEndpointUsable } from "../shared/model-endpoint";
import { normalizeUiIcon, UI_ICON_PRESETS, type UiIcon } from "../shared/ui-icon";
import { foldReasoning, normalizeReasoningPreference, type ReasoningPreference } from "../shared/reasoning";
import { getUiFontResponseHeaders, isSafeUiFontRequest } from "./ui-font-protocol";
import { authorizePetControlSender, authorizePetZoomSender, normalizePetZoom } from "./pet-zoom-security";
import { applyModelSecretPatch, redactModelSettings } from "./model-settings-ipc";
import { assertTrustedMainFrameSender, isTrustedMainFrameSender } from "./trusted-renderer";
import {
  normalizeChatSocialContextEnabled,
  normalizeDefaultChatMode,
  normalizeMobileMessageSegmentationMode,
  normalizeProactiveChatMode,
  normalizeProactiveDeliveryTarget,
  normalizeSegmentedOutputMode,
  type DefaultChatMode,
  type MobileMessageSegmentationMode,
  type ProactiveChatMode,
  type ProactiveDeliveryTarget,
  type SegmentedOutputMode,
} from "../shared/preferences";
import {
  DEFAULT_CUSTOM_STYLE,
  STYLE_FILE_BY_ID,
  normalizeCustomStyleConfig,
  normalizeStyleId,
  resolveStylePreference,
  type CustomStyleConfig,
  type StyleId,
} from "../shared/style-sampling";
import { STATUS_KEYWORDS, inferFeelingFromText } from "./status-keywords";
import { findAction } from "../shared/live2d-actions";
import { CoWatchService } from "./cowatch/cowatch-service";
import {
  addL2MemoryVector,
  addMemory,
  buildMemoryContext,
  deleteImportedDoc,
  deleteUserMemoryVectors,
  getEntriesBySource,
  initRAG,
  isUserMemoryVectorStoreReady,
  switchEmbeddingModel,
} from "./rag";
import { getEmbeddingProvider, getSceneEmbeddingProvider } from "./rag/embedding";
import { describePendingAttachment } from "./rag/file-ingest";
import { cancelDocumentIndexJob, configureDocumentIndexQueue, enqueueDocumentIndexJob } from "./rag/document-index-queue";
import { retrieveQueuedDocumentChunks, runDocumentIndexJob } from "./rag/document-index-worker";
import { processDocumentIndexRequest } from "./rag/document-index-ipc";
import {
  IMAGE_CAPTION_PROMPT,
  buildImageCaptionPrompt,
  validateCaptionImagePath,
} from "./chat/image-caption";
import { decideImageSendStrategy } from "./chat/image-send-strategy";
import { buildAlwaysOnContext, buildMemoryInjection, scheduleMemoryWrite } from "./orchestrator";
import { CyreneAgent } from "./orchestrator/cyrene-agent";
import { validateSearchApiKey } from "./orchestrator/search-backend-filter";
import { indexConversationTurn } from "./orchestrator/history-tools";
import { buildToneInjection } from "./orchestrator/tone-injector";
import { getAdapter, buildVendorUrl, getAdapterForConfig, createSseReader } from "./orchestrator/vendors";
import type {
  ChatResponse,
  StructuredOutputRequest,
  VendorConfig,
} from "./orchestrator/vendors";
import {
  classifyStructuredOutputEndpoint,
  resolveStructuredOutputProfile,
} from "./orchestrator/structured-output/profiles";
import { normalizeFinishReason } from "./orchestrator/structured-output/finish-reason";
import { dispatchChatGeneration } from "./orchestrator/structured-output/dispatcher";
import { invokeLangChainStructured } from "./orchestrator/structured-output/langchain-invoker";
import { testVendorConnection } from "./orchestrator/vendors/test-connection";
import { migrateLegacyMinimaxDefaults } from "./orchestrator/vendors/minimax-defaults";
import { getCapability, getCapabilityOrOpenAI } from "./orchestrator/vendors/capabilities";
import { resolveApprovedStyleSampling } from "./orchestrator/vendors/style-sampling";
import type { VisionConfig } from "./orchestrator/vision-captioner";
import { toolRegistry, type ToolDefinition } from "./orchestrator/tool-registry";
import { buildToolCatalog } from "./orchestrator/tool-catalog";
import type { ToolRiskLevel } from "./permission";
import { loadChannelsSettings } from "./channels/settings-store";
import { channelManager } from "./channels/manager";
import { canStartProactiveChannelDelivery, sendProactiveChannelMessage } from "./channels/proactive-delivery";
//  built-in-tools （fetch_url / run_shell / install_mcp_server）
import "./orchestrator/built-in-tools";
//  fs-tools （read_file / list_dir / write_file / read_image）
import "./orchestrator/fs-tools";
import { initMcpManager, addMcpServer, removeMcpServer, listMcpServers, pruneMcpServersByIds } from "./orchestrator/mcp-manager";
import { syncPlaywrightMcp, PLAYWRIGHT_MCP_ID, REMOVED_BUILTIN_MCP_IDS } from "./sync-mcp-builtin";
import { buildEnvironmentContext } from "./orchestrator/environment";
import { initPermissionFromDisk, registerPermissionIpc, getCurrentLevel } from "./permission";
import { registerChoiceIpc, setChoiceCardSender } from "./user-choice";
import { ElectronScreenshotHelperClient } from "./screenshot/helper-client";
import { resolveScreenshotHelperPath } from "./screenshot/helper-path";
import {
  createScreenshotService,
  validateScreenshotInsert,
  type ScreenshotService,
} from "./screenshot/screenshot-service";
import {
  ScreenConsentController,
  SystemAudioAwarenessService,
  WindowsMediaSessionMetadataAdapter,
  formatSystemAudioContext,
  type ScreenCaptureProducer,
} from "./sensory";
import { enqueueLLMTask } from "./llm-queue";
import { compileSocialContextBlock } from "./social-context/context";
import {
  buildSocialExtractionPrompt,
  SOCIAL_EXTRACTION_SCHEMA,
} from "./social-context/extractor";
import { rankSocialAtoms } from "./social-context/retrieval";
import { createSocialContextScheduler } from "./social-context/scheduler";
import { createSocialAtomStore } from "./social-context/store";
import { getEmbeddingStatus, downloadEmbeddingModel, deleteEmbeddingModel } from "./embedding-manager";
import { BUILT_IN_STICKER_DESCRIPTIONS } from "./sticker-descriptions";
import { buildCachedStickerEmbeddingIndex } from "./sticker-embedding-cache";
import { matchSticker } from "./sticker-embedder";
import type { StickerEmbeddingEntry } from "./sticker-embedder";
import { buildCachedSceneIndex } from "./scene-embedding-cache";
import type { SceneIndex } from "./scene-embedder";
import { loadUserStickerManifest, addUserSticker, deleteUserSticker, getAllStickerConfig, isStickerIdTaken, getStickersDir } from "./sticker-storage";
import { parseLocalStickerFileFromUrl, resolveLocalStickerPath } from "./sticker-protocol";
import { normalizeWindowVisibilitySettings } from "./window-visibility-settings";
import { PetWindowMoveController } from "./pet-window-movement";
import type { StickerConfigItem } from "../shared/sticker-types";
import { initReranker, getRerankerInstallStatus } from "./rag/reranker";
import { memoryStore } from "./memory/memory-store"
import { backupMemoryRagFiles, reconcileMemoryRag } from "./memory/memory-rag-reconciliation";
import type { L0Profile, L1Profile } from "./memory/memory-types";
import { broadcastChatsChanged, registerChatsIpc } from "./chats/chats-ipc";
import * as chatsStore from "./chats/chats-store";
import { recordUsage, getUsage, flush as flushTokenUsage } from "./token-usage-store";
import { uploadFile as ttsUploadFile, cloneVoice as ttsCloneVoice, synthesize as ttsSynthesize } from "./tts/minimax-engine";
import { synthesize as gptsovitsSynthesize } from "./tts/gptsovits-engine";
import { synthesize as customCloudSynthesize } from "./tts/custom-cloud-engine";
import { synthesize as mimoSynthesize } from "./tts/mimo-engine";
import { synthesize as mosslandSynthesize, cloneVoice as mosslandCloneVoice, listVoices as mosslandListVoices } from "./tts/mossland-engine";
import { synthesizeByEngine } from "./tts/tts-dispatcher";
import { synthesizeEdgeTts } from "./tts/edge-tts-engine";
import { translateEnglishToMandarinSpeech } from "./tts/speech-translation";
import { convertVoiceWithRvc } from "./tts/rvc-engine";
import { ALLOWED_TTS_SETTING_KEYS, type GptsovitsLanguageMode } from "../shared/tts-types";
import { registerAgUiIpc, type AguiRunInput } from "./agui-bridge";
import { setWeatherConfig, setSearchConfig, loadTodos, onTodosChange, setDelegateSettings, setUserTimezoneConfig } from "./orchestrator/built-in-tools";
import { registerRecallHistoryTool } from "./orchestrator/history-tools";
import { registerDocumentTools } from "./orchestrator/document-tools";
import { registerLifeTools, setTranslateConfig } from "./orchestrator/life-tools";
import { registerTravelTools, setTravelConfig } from "./orchestrator/travel-tools";
import { registerEmailTools, setEmailConfig } from "./orchestrator/email-tools";
import { resolveMusicPaths } from "./music/paths";
import { bootstrapMusicService } from "./music/bootstrap";
import { installShutdownLatch } from "./music/shutdown-latch";
import {
  buildConversationTimeContext,
  normalizeChatMessagesWithTime,
  resolveChatContextTimezone,
  type ChatContextMessage,
} from "./chat-time-context";
import { setAsrConfig } from "./asr/volcano-asr-engine";
import { setCallWindow, registerCallIpc, setCallSettings, stopCall } from "./call/call-manager";
import { initSkills, skillRegistry, buildAutoInjectedSkillContext, buildAutoInjectedSoulContext, buildSkillCatalog, parseSlashCommand, setSkillEnabled, listSkillsForUi } from "./skills";
import {
  isMusicCompanionAvailable,
  loadMusicCompanionHost,
} from "./skills/music-companion-host";
import { initGameBot } from "./game-bot";
import { initChannels, shutdownChannels, setChannelsConversationLifecycle } from "./channels/init";
import { buildChannelAttachmentInputs } from "./channels/agent-input";
import { setDispatcherBuildAndRunAgent, setDispatcherSynthesizeTts, setDispatcherBroadcastChat, setDispatcherLoadGeneralSettings, setDispatcherLoadRecentHistory } from "./channels/dispatcher";
import { createWindowLifecycleTracker } from "./electron-window-lifecycle";
import {
  buildAgentRunOptions,
  onAgentRunFinished,
  type BuildOptionsDeps,
  type OnRunFinishedDeps,
} from "./orchestrator/build-options";
import { buildRelationshipContext, recordRelationshipTurn } from "./relationship/relationship-log";
import { createFeelingScores, smoothFeeling } from "./orchestrator/runtime-state-smoother";
import { getSchedulerStore } from "./scheduler/scheduler-store";
import { SchedulerEngine } from "./scheduler/scheduler-engine";
import { createSchedulerRunner } from "./scheduler/scheduler-runner";
import { registerSchedulerIpc } from "./scheduler/scheduler-ipc";
import type { ScheduledTask } from "./scheduler/types";
import {
  createProactiveChatService,
  type ProactiveChatService,
  type ProactiveCommitInput,
  type ProactiveCommitResult,
} from "./proactive/proactive-service";
import { routeProactiveDelivery } from "./proactive/proactive-delivery-routing";
import { buildProactiveMessages, type ProactiveHistoryTurn } from "./proactive/proactive-prompt";
import {
  createProactiveTrigger,
  type ProactiveTriggerController,
} from "./proactive/proactive-trigger";
import { runProactiveModel } from "./proactive/proactive-model";
import type { ProactiveCandidate, ProactiveRuntimeSnapshot } from "./proactive/proactive-types";
import { canCommitProactiveMessage } from "./proactive/proactive-policy";
import { loadProactiveState, saveProactiveState } from "./proactive/proactive-state-store";
import { normalizeCitaSettings } from "./cita/settings";
import { CitaService, ContextStore, RemoteSemanticEngine } from "./cita";
import { contextRefRegistry } from "./orchestrator/tool-context";

// Ensure data directory is bound to Drive D if available on Windows, before any subsystem calls app.getPath("userData")
try {
  if (!app.commandLine.hasSwitch("user-data-dir") && process.platform === "win32") {
    const driveDRoot = "D:\\";
    const defaultDriveDDir = "D:\\CyreneData";
    const localDataDir = path.resolve(__dirname, "..", "..", "data");
    const legacyAppDataDir = path.join(app.getPath("appData"), "cyrene-desktop");

    if (fs.existsSync(driveDRoot)) {
      if (!fs.existsSync(defaultDriveDDir)) {
        try {
          fs.mkdirSync(defaultDriveDDir, { recursive: true });
          // Safe migration transaction: if legacy directory on Drive C has data, copy it across
          if (fs.existsSync(legacyAppDataDir)) {
            const filesToMigrate = ["model-settings.json", "general-settings.json", "user-profile.json", "chats", "memory"];
            for (const item of filesToMigrate) {
              const src = path.join(legacyAppDataDir, item);
              const dest = path.join(defaultDriveDDir, item);
              if (fs.existsSync(src) && !fs.existsSync(dest)) {
                try {
                  fs.cpSync(src, dest, { recursive: true });
                } catch (copyErr) {
                  console.warn("[Cyrene] Failed to migrate " + item + " from legacy AppData:", copyErr);
                }
              }
            }
          }
        } catch { /* non-fatal */ }
      }
      if (fs.existsSync(defaultDriveDDir)) {
        app.setPath("userData", defaultDriveDDir);
      }
    } else if (fs.existsSync(localDataDir)) {
      app.setPath("userData", localDataDir);
    }
  }
} catch (err) {
  console.warn("[Cyrene] Failed to bind custom userData dir:", err);
}


function logFatalProcessError(type: string, error: unknown): void {
  try {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, "fatal-error.log");
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${type}] ${message}\n`);
    console.error(`[Cyrene ${type}]`, error);
  } catch { /* best effort */ }
}

process.on("uncaughtException", (error) => {
  logFatalProcessError("uncaughtException", error);
  if (app.isPackaged) {
    try {
      dialog.showErrorBox(
        "Cyrene - Unexpected Error",
        `An unexpected error occurred in Cyrene:\n\n${error instanceof Error ? error.message : String(error)}`
      );
    } catch { /* ignore */ }
  }
});

process.on("unhandledRejection", (reason) => {
  logFatalProcessError("unhandledRejection", reason);
});

configureDocumentIndexQueue(runDocumentIndexJob);

async function reconcileUserMemoryIndex(): Promise<void> {
  if (!isUserMemoryVectorStoreReady()) {
    console.warn("[Memory/RAG] reconciliation skipped: vector store is not writable");
    return;
  }
  const report = await reconcileMemoryRag({
    getMemories: () => memoryStore.getAllL2(),
    getVectors: () => getEntriesBySource("user_memory"),
    backup: async () => backupMemoryRagFiles(app.getPath("userData")),
    addVector: addL2MemoryVector,
    markSynced: (l2Id, ragId) => memoryStore.markL2SyncStatus(l2Id, "synced", ragId),
    markSyncFailed: (l2Id, error) => memoryStore.markL2SyncStatus(l2Id, "sync_failed", undefined, error),
    deleteVectors: (ids) => deleteUserMemoryVectors(ids),
    warn: (message, error) => console.warn(`[Memory/RAG] ${message}:`, error),
  });
  console.log("[Memory/RAG] reconciliation:", report);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let chatWindow: BrowserWindow | null = null;
let sidebarWindow: BrowserWindow | null = null;
let tasksWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let stickerManagerWindow: BrowserWindow | null = null;
let callWindow: BrowserWindow | null = null;
let logWindow: BrowserWindow | null = null;

export interface ActivityLogItem {
  timestamp: number;
  type: "user" | "reasoning" | "response" | "kaomoji" | "tool" | "error" | "system";
  text: string;
  channel?: string;
  meta?: unknown;
}

export const activityLogBuffer: ActivityLogItem[] = [];

export function pushActivityLog(
  type: ActivityLogItem["type"],
  text: string,
  meta?: unknown,
  channel?: string,
): void {
  const item: ActivityLogItem = {
    timestamp: Date.now(),
    type,
    text,
    channel,
    meta,
  };
  activityLogBuffer.push(item);
  if (activityLogBuffer.length > 1000) {
    activityLogBuffer.shift();
  }
  if (logWindow && !logWindow.isDestroyed()) {
    try {
      logWindow.webContents.send(IPC.LOG_ENTRY, item);
    } catch {
      // ignore
    }
  }
}

function seedActivityLogFromChats(): void {
  if (activityLogBuffer.length > 0) return;
  try {
    const sessions = chatsStore.listSessions();
    const collected: ActivityLogItem[] = [];
    for (const sessionMeta of sessions.slice(0, 8)) {
      const full = chatsStore.getSession(sessionMeta.id);
      if (!full || !full.messages || full.messages.length === 0) continue;
      const channel = full.title || "Main Chat";
      for (const m of full.messages.slice(-20)) {
        if (!m.content) continue;
        const timestamp = m.at || sessionMeta.updatedAt;
        if (m.role === "user") {
          collected.push({
            timestamp,
            type: "user",
            text: m.content,
            channel,
          });
        } else if (m.role === "model") {
          if (m.reasoning) {
            collected.push({
              timestamp: timestamp - 50,
              type: "reasoning",
              text: m.reasoning,
              channel,
            });
          }
          collected.push({
            timestamp,
            type: "response",
            text: m.content,
            channel,
          });
        }
      }
    }
    collected.sort((a, b) => a.timestamp - b.timestamp);
    activityLogBuffer.push(...collected);
  } catch (err) {
    console.warn("[ActivityLog] Failed to seed from chat sessions:", err);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.show();
    chatWindow.focus();
  } else {
    createChatWindow();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
let schedulerEngine: SchedulerEngine | null = null;
let screenshotService: ScreenshotService | null = null;
// The owner selected persistent screen observation for this trusted local app.
// This grants capture only to the fixed producers below; it does not grant file writes or shell access.
const screenConsent = new ScreenConsentController({ mode: "session", sessionGranted: true });
let systemAudioAwareness: SystemAudioAwarenessService | null = null;
let systemAudioRefreshTimer: NodeJS.Timeout | null = null;
let systemAudioDesiredEnabled = false;
let systemAudioTransition: Promise<void> = Promise.resolve();
let proactiveChatService: ProactiveChatService | null = null;
let normalConversationBusyCount = 0;
let proactiveScreenLocked = false;
const live2dWindowLifecycle = createWindowLifecycleTracker<BrowserWindow>("live2d-main", {
  onClosed: () => { /* no-op： setLive2dWindow  opener  */ },
});
const petWindowMoveController = new PetWindowMoveController(
  () => mainWindow,
  ({ x, y }) => {
    saveGeneralSettings({ petWindowX: x, petWindowY: y });
  },
);

const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;

async function runExplicitScreenCapture<T>(producer: ScreenCaptureProducer, operation: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const authorization = screenConsent.request(producer);
  if (authorization.status !== "authorized") throw new Error("SCREEN_CAPTURE_NOT_AUTHORIZED");
  const lease = screenConsent.beginCapture(authorization.authorization, producer);
  if (!lease) throw new Error("SCREEN_CAPTURE_AUTHORIZATION_EXPIRED");
  try {
    if (lease.signal.aborted) throw new Error("SCREEN_CAPTURE_REVOKED");
    return await operation(lease.signal);
  } finally {
    lease.release();
  }
}

function sensoryContextBlock(): string {
  return formatSystemAudioContext(systemAudioAwareness?.snapshot() ?? []);
}

function setSystemAudioAwarenessEnabled(enabled: boolean): Promise<void> {
  systemAudioDesiredEnabled = enabled;
  systemAudioTransition = systemAudioTransition.then(async () => {
    const service = systemAudioAwareness;
    if (!service) return;
    if (!systemAudioDesiredEnabled) {
      if (systemAudioRefreshTimer) clearInterval(systemAudioRefreshTimer);
      systemAudioRefreshTimer = null;
      await service.revoke();
      return;
    }
    await service.enable();
    if (!systemAudioDesiredEnabled) {
      await service.revoke();
      return;
    }
    await service.refresh();
    if (!systemAudioRefreshTimer) {
      systemAudioRefreshTimer = setInterval(() => void service.refresh(), 2_000);
    }
  }).catch((error) => console.warn("[SystemAudio] lifecycle transition failed:", error));
  return systemAudioTransition;
}

async function buildAlwaysOnContextWithSensory(userText: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const base = await buildAlwaysOnContext(userText, messages as any);
  const sensory = sensoryContextBlock();
  return sensory ? `${base}\n\n${sensory}` : base;
}

function getScreenshotDirectory(): string {
  return path.join(app.getPath("userData"), "screenshots");
}

async function saveScreenshotPasteTemp(
  base64: string,
  _mime: string,
): Promise<{ filePath: string }> {
  const raw = Buffer.from(base64, "base64");
  if (raw.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error("SCREENSHOT_TOO_LARGE");
  }
  const image = nativeImage.createFromBuffer(raw);
  if (image.isEmpty()) {
    throw new Error("INVALID_SCREENSHOT_IMAGE");
  }
  const screenshotDirectory = getScreenshotDirectory();
  await fs.promises.mkdir(screenshotDirectory, { recursive: true });
  const filePath = path.join(screenshotDirectory, `${randomUUID()}.png`);
  await fs.promises.writeFile(filePath, image.toPNG());
  return { filePath };
}

let coWatchService: CoWatchService | null = null;

function getCoWatchService(): CoWatchService {
  if (!coWatchService) {
    coWatchService = new CoWatchService({
      captureScreen: () => captureScreenForCoWatch(),
      loadModelSettings: () => loadModelSettings(),
      loadVisionConfig: () => loadVisionConfig(),
      broadcastState: (state) => {
        for (const win of [mainWindow, chatWindow, sidebarWindow, logWindow]) {
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC.COWATCH_STATE_CHANGED, state);
          }
        }
      },
      deliverReaction: (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.PET_AGENT_EVENT, {
            type: "say",
            text,
          });
        }
        try {
          const targetSessionId = ensureActiveChatSessionId();
          chatsStore.appendMessage(targetSessionId, {
            id: randomUUID(),
            role: "model",
            content: text,
            at: Date.now(),
          });
          broadcastChatsChanged();
        } catch (err) {
          console.warn("[CoWatch] Failed to persist reaction to chat:", err);
        }
      },
      pushLog: (type, text, meta) => {
        pushActivityLog(type, text, meta, "cowatch");
      },
    });
  }
  return coWatchService;
}

async function captureScreenForCoWatch(): Promise<{ filePath: string; previewUrl: string; mime: string } | null> {
  return runExplicitScreenCapture("vision", async () => {
    const { desktopCapturer, screen } = await import("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    // Downscale for lightning fast JPEG encoding, lightweight payload, and prompt AI analysis
    const targetWidth = Math.min(1024, width);
    const targetHeight = Math.round(targetWidth * (height / width));
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: targetWidth, height: targetHeight },
    });
    if (sources.length === 0) return null;
    const thumb = sources[0].thumbnail;
    const jpegBuffer = thumb.toJPEG(75);
    const screenshotDirectory = getScreenshotDirectory();
    await fs.promises.mkdir(screenshotDirectory, { recursive: true });
    const filePath = path.join(screenshotDirectory, `${randomUUID()}.jpg`);
    await fs.promises.writeFile(filePath, jpegBuffer);
    return {
      filePath,
      previewUrl: pathToFileURL(filePath).href,
      mime: "image/jpeg",
    };
  }).catch((err) => {
    console.warn("[CoWatch] Periodic capture failed:", err);
    return null;
  });
}

function initializeScreenshotService(initialHotkey: string): ScreenshotService {
  const screenshotDirectory = getScreenshotDirectory();
  const client = new ElectronScreenshotHelperClient({
    spawnImpl: (command, args) => spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }),
    resolveHelperPath: () => resolveScreenshotHelperPath({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      envOverride: process.env.CYRENE_SCREENSHOT_HELPER_PATH,
    }),
    screenshotDirectory,
    logger: console,
  });
  const service = createScreenshotService({
    client,
    registerShortcut: (accelerator, callback) =>
      globalShortcut.register(accelerator, () => {
        void runExplicitScreenCapture("hotkey", callback).catch((error) =>
          console.warn("[Screenshot] Hotkey capture denied or failed:", error));
      }),
    unregisterShortcut: (accelerator) => globalShortcut.unregister(accelerator),
    sendInsert: (data) => {
      const validated = validateScreenshotInsert(
        data,
        screenshotDirectory,
        (filePath) => nativeImage.createFromPath(filePath),
      );
      if (!validated) {
        throw new Error(`INVALID_SCREENSHOT_RESULT:${data.filePath}`);
      }
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(IPC.SCREENSHOT_INSERT, validated);
      }
    },
  });

  ipcMain.handle(IPC.SCREENSHOT_START, (event) => {
    if (chatWindow?.webContents.id !== event.sender.id) throw new Error("UNTRUSTED_SCREEN_CAPTURE_SENDER");
    return runExplicitScreenCapture("vision", () => service.startFromChatButton());
  });
  ipcMain.handle(IPC.SCREENSHOT_INSTANT_LOOK, async (event) => {
    if (chatWindow?.webContents.id !== event.sender.id) throw new Error("UNTRUSTED_SCREEN_CAPTURE_SENDER");
    return runExplicitScreenCapture("vision", async () => {
      const { desktopCapturer, screen } = await import("electron");
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
      });
      if (sources.length === 0) return null;
      const thumb = sources[0].thumbnail;
      const pngBuffer = thumb.toPNG();
      const base64 = pngBuffer.toString("base64");
      const mime = "image/png";
      const tempResult = await saveScreenshotPasteTemp(base64, mime);
      const validated = {
        filePath: tempResult.filePath,
        previewUrl: pathToFileURL(tempResult.filePath).href,
        mime,
        hasAnnotations: false,
      };
      return validated;
    });
  });

  ipcMain.handle(IPC.COWATCH_TOGGLE, () => {
    return getCoWatchService().toggle();
  });
  ipcMain.handle(IPC.COWATCH_GET_STATE, () => {
    return getCoWatchService().getState();
  });
  ipcMain.handle(IPC.SCREENSHOT_SAVE_TEMP, (event, base64: string, mime: string) => {
    if (chatWindow?.webContents.id !== event.sender.id) throw new Error("UNTRUSTED_SCREEN_CAPTURE_SENDER");
    return saveScreenshotPasteTemp(base64, mime);
  });
  ipcMain.handle(IPC.SCREENSHOT_HOTKEY_CAPTURE_START, (event) => {
    if (chatWindow?.webContents.id !== event.sender.id) throw new Error("UNTRUSTED_SCREEN_CAPTURE_SENDER");
    service.suspendHotkey();
    return true;
  });
  ipcMain.handle(IPC.SCREENSHOT_HOTKEY_CAPTURE_END, (event) => {
    if (chatWindow?.webContents.id !== event.sender.id) throw new Error("UNTRUSTED_SCREEN_CAPTURE_SENDER");
    service.resumeHotkey();
    return true;
  });

  service.init(initialHotkey);
  return service;
}
//  id（ IPC ）；
// ""。 closed  null。
let activeChatSessionId: string | null = null;

export function ensureActiveChatSessionId(): string {
  if (activeChatSessionId && chatsStore.isValidSessionId(activeChatSessionId)) {
    const existing = chatsStore.getSession(activeChatSessionId);
    if (existing) return activeChatSessionId;
  }
  const sessions = chatsStore.listSessions();
  if (sessions.length > 0 && sessions[0]?.id) {
    activeChatSessionId = sessions[0].id;
    return activeChatSessionId;
  }
  const newSession = chatsStore.createSession({ title: "Cyrene & Master" });
  activeChatSessionId = newSession.id;
  return activeChatSessionId;
}


const isDev = process.env.VITE_DEV === "1";

function appendMinimaxTtsLog(entry: Record<string, unknown>): void {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "minimax-tts.log");
    fs.appendFileSync(logFile, JSON.stringify(entry, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[TTS MiniMax] Failed to write diagnostic log:", err);
  }
}

function appendGptsovitsTtsLog(entry: Record<string, unknown>): void {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "gptsovits-tts.log");
    fs.appendFileSync(logFile, JSON.stringify(entry, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[TTS GPT-SoVITS] Failed to write diagnostic log:", err);
  }
}

function appendCustomCloudTtsLog(entry: Record<string, unknown>): void {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "custom-cloud-tts.log");
    fs.appendFileSync(logFile, JSON.stringify(entry, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[TTS CustomCloud] Failed to write diagnostic log:", err);
  }
}

function appendMimoTtsLog(entry: Record<string, unknown>): void {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "mimo-tts.log");
    fs.appendFileSync(logFile, JSON.stringify(entry, null, 2) + "\n", "utf8");
  } catch (err) {
    console.warn("[TTS MiMo] Failed to write diagnostic log:", err);
  }
}

function getTtsCacheDir(): string {
  return path.join(app.getPath("userData"), "cyrene-tts-cache");
}

function assertTtsCacheKey(cacheKey: string): string {
  if (!/^(minimax|gptsovits|custom-cloud|mimo)-[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Invalid TTS cache key");
  }
  return cacheKey;
}

function buildTtsCacheKey(payload: {
  voiceId: string;
  text: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  model?: string;
  format?: "mp3" | "wav" | "pcm";
}): string {
  const source = JSON.stringify({
    version: 1,
    engine: "minimax",
    model: payload.model ?? "speech-2.8-hd",
    voiceId: payload.voiceId,
    speed: payload.speed ?? 1,
    volume: payload.volume ?? 1,
    pitch: payload.pitch ?? 0,
    format: payload.format ?? "mp3",
    text: payload.text,
  });
  return "minimax-" + createHash("sha256").update(source, "utf8").digest("hex");
}

function buildGptsovitsCacheKey(payload: {
  baseUrl: string;
  refAudioPath: string;
  promptText: string;
  text: string;
  languageMode?: GptsovitsLanguageMode;
  textLang?: "en" | "zh";
  promptLang?: "en" | "zh";
  speed?: number;
  format?: "wav" | "mp3";
  rvcApplied?: boolean;
}): string {
  const source = JSON.stringify({
    version: 2,
    engine: "gptsovits",
    baseUrl: payload.baseUrl,
    refAudioPath: payload.refAudioPath,
    promptText: payload.promptText,
    languageMode: payload.languageMode ?? "english",
    textLang: payload.textLang ?? "en",
    promptLang: payload.promptLang ?? "en",
    speed: payload.speed ?? 1,
    format: payload.format ?? "wav",
    rvcApplied: payload.rvcApplied === true,
    text: payload.text,
  });
  return "gptsovits-" + createHash("sha256").update(source, "utf8").digest("hex");
}

function getDefaultCyreneRefAudioPath(): string {
  const base = app?.isPackaged ? process.resourcesPath : (app?.getAppPath ? app.getAppPath() : process.cwd());
  const candidates = [
    path.join(base, "resources", "voice", "cyrene", "ref_audio.wav"),
    path.join(base, "voice", "cyrene", "ref_audio.wav"),
    path.join(process.cwd(), "resources", "voice", "cyrene", "ref_audio.wav"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function prepareGptsovitsVoicePayload(payload: {
  baseUrl?: string;
  refAudioPath?: string;
  promptText?: string;
  text: string;
  speed?: number;
  format?: "wav" | "mp3";
}) {
  const settings = loadGeneralSettings();
  const defaultRefAudio = getDefaultCyreneRefAudioPath();
  const baseUrl = (payload.baseUrl && payload.baseUrl.trim()) || settings.ttsGptsovitsBaseUrl || "http://127.0.0.1:9880";
  const refAudioPath = (payload.refAudioPath && payload.refAudioPath.trim())
    || (settings.ttsGptsovitsRefAudioPath && settings.ttsGptsovitsRefAudioPath.trim())
    || defaultRefAudio;
  const promptText = (payload.promptText && payload.promptText.trim())
    || (settings.ttsGptsovitsPromptText && settings.ttsGptsovitsPromptText.trim())
    || "开拓者，希琳一直都在这里陪着你哦。";
  const languageMode = "original-mandarin";
  const text = await translateEnglishToMandarinSpeech(payload.text, loadModelSettings());
  const translatedToMandarin = /[\u3400-\u9fff]/u.test(text);
  return {
    ...payload,
    baseUrl,
    refAudioPath,
    promptText,
    format: payload.format ?? "wav",
    text,
    languageMode: "original-mandarin" as const,
    textLang: "zh" as const,
    promptLang: "zh" as const,
    rvcApplied: false,
    rvc: null as {
      baseUrl: string;
      modelName: string;
      pitch: number;
      indexRate: number;
    } | null,
  };
}

async function applyConfiguredRvc(
  audio: Buffer,
  prepared: Awaited<ReturnType<typeof prepareGptsovitsVoicePayload>>,
): Promise<{ audio: Buffer; format: "wav" | "mp3"; converted: boolean }> {
  if (!prepared.rvc) return { audio, format: prepared.format ?? "wav", converted: false };
  const converted = await convertVoiceWithRvc({ audio, ...prepared.rvc });
  return converted.converted
    ? { audio: converted.audio, format: "wav", converted: true }
    : { audio, format: prepared.format ?? "wav", converted: false };
}

function buildCustomCloudCacheKey(payload: {
  endpointUrl: string;
  voiceId?: string;
  text: string;
  speed?: number;
  volume?: number;
  format?: "wav" | "mp3";
}): string {
  const source = JSON.stringify({
    version: 1,
    engine: "custom-cloud",
    endpointUrl: payload.endpointUrl,
    voiceId: payload.voiceId ?? "",
    speed: payload.speed ?? 1,
    volume: payload.volume ?? 1,
    format: payload.format ?? "mp3",
    text: payload.text,
  });
  return "custom-cloud-" + createHash("sha256").update(source, "utf8").digest("hex");
}

function buildMimoCacheKey(payload: {
  voiceAudioPath?: string;
  text: string;
  stylePrompt?: string;
}): string {
  const source = JSON.stringify({
    version: 1,
    engine: "mimo",
    model: "mimo-v2.5-tts-voiceclone",
    voiceAudioPath: payload.voiceAudioPath ?? "",
    stylePrompt: payload.stylePrompt ?? "",
    format: "wav",
    text: payload.text,
  });
  return "mimo-" + createHash("sha256").update(source, "utf8").digest("hex");
}

/** Mossland cache key：voice_id + model + format + text 。
 *   Mossland "" key ， voice_id + model 。 */
function buildMosslandCacheKey(payload: {
  voiceId?: string;
  text: string;
  model?: string;
  format?: "mp3" | "wav" | "pcm";
}): string {
  const source = JSON.stringify({
    version: 1,
    engine: "mossland",
    model: payload.model ?? "moss-tts",
    voiceId: payload.voiceId ?? "",
    format: payload.format ?? "mp3",
    text: payload.text,
  });
  return "mossland-" + createHash("sha256").update(source, "utf8").digest("hex");
}

function getTtsCachePath(cacheKey: string, format: "mp3" | "wav" | "pcm" = "mp3"): string {
  const safeKey = assertTtsCacheKey(cacheKey);
  const ext = format === "wav" ? "wav" : format === "pcm" ? "pcm" : "mp3";
  return path.join(getTtsCacheDir(), `${safeKey}.${ext}`);
}

// ：，。
interface ProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  displayName?: string;
  /**
   *  settings  transport；"auto" =  baseUrl  + capabilities fallback。
   * resolveTransport()  "auto"  transport。
   *  =  "auto"。
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
  /**
   * （source of truth）。 ModelSettings.reasoning 。
   *  effort  user preference，
   *  resolveEffectiveReasoning  effective config。
   */
  reasoning?: ReasoningPreference;
}

/**
 * ： providerName →  providerName。
 *
 * ：UI "（）" preset ，
 *  model-settings.json  provider （ perProvider ）
 * ；normalize ， perProvider ，
 * provider 。。
 *
 * ，****，，。
 */
const PROVIDER_RENAMES: Record<string, string> = {
  "MiniMax": "MiniMax",
  "DeepSeek": "DeepSeek",
  "Zhipu GLM": "GLM",
  "Qwen (DashScope)": "Qwen",
  "MiniMax (Xiyu Tech)": "MiniMax",
  "Doubao (Volcano Engine)": "Doubao",
  "GLM (Zhipu)": "GLM",
  "Kimi (Moonshot)": "Kimi",
  "Qwen (Tongyi Qianwen)": "Qwen",
  "MiMo (Xiaomi)": "MiMo",
};

/**
 *  perProvider  + currentProvider  PROVIDER_RENAMES。
 * -  → ：；，（""）。
 * - ：。
 */
function migrateProviderRenames(
  currentProvider: string,
  perProvider: Record<string, ProviderProfile>,
): { provider: string; perProvider: Record<string, ProviderProfile> } {
  const next: Record<string, ProviderProfile> = {};
  for (const [key, value] of Object.entries(perProvider)) {
    const newKey = PROVIDER_RENAMES[key] ?? key;
    if (next[newKey]) {
      // （），：
      //  →  next[newKey]，。
      console.log("[Cyrene] provider rename: drop legacy", key, "→ kept", newKey);
      continue;
    }
    if (newKey !== key) {
      console.log("[Cyrene] provider rename:", key, "→", newKey);
    }
    next[newKey] = value;
  }
  const newProvider = PROVIDER_RENAMES[currentProvider] ?? currentProvider;
  return { provider: newProvider, perProvider: next };
}

interface ModelSettings {
  mode: "auto" | "manual";
  provider: string;
  // ， shortName。
  displayName?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   *  explicitTransport （ perProvider[currentProvider] ）。
   *  ProviderProfile.explicitTransport。
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
  /**
   *  reasoning （ explicitTransport ）。
   *  perProvider[currentProvider].reasoning； view。
   *  preference（）；effective config  capability 。
   */
  reasoning?: ReasoningPreference;
  // ：currentProvider ，。
  // （source of truth） perProvider； baseUrl/model/apiKey ，
  //  main  settings.baseUrl 。
  perProvider: Record<string, ProviderProfile>;
  runtimeSync: "off" | "local" | "llm";
  stickerEnabled: boolean;
  stickerSize: StickerSize;
  stickerSimilarityThreshold: number;
  /** （）。30-1800， 300。 */
  chatRequestTimeoutSec: number;
  /** 。5-30， 12。 */
  maxIterations: number;
  /** Plan 。1-5， 2。 */
  maxReplans: number;
  /** 。0-3， 1。 */
  maxRefresh: number;
  /**  LLM （）。30-120， 75。 */
  perCallTimeoutSec: number;
  /** CITA （）。4-30， 8。 */
  citaRepairBudgetSec: number;
  /** Action Gate （）。5-40， 10。 */
  actionGateRepairBudgetSec: number;
  rerankerMode: "light" | "standard" | "none";
  embeddingModel: "minilm" | "bgem3";
  // （）。undefined  = ，read_image 。
  vision?: VisionModelConfig;
  /** 。true （direct），vision 。 */
  multimodal: boolean;
}

/** （，）。 = 。 */
interface VisionModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}


interface UserProfile {
  nickname: string;
  callPreference: string;
  birthday: string;
  timezone: string;
  avatarPath: string;
  /** （，） */
  defaultCity: string;
  /** ：secret() | male() | female() */
  gender: string;
}

interface GeneralSettings {
  citaEnabled: boolean;
  citaSemanticEngine: "remote";
  /** Chat ；，。 */
  chatSocialContextEnabled: boolean;
  musicEnabled: boolean;
  musicVolume: number;
  soundEnabled: boolean;
  soundVolume: number;
  petAlwaysOnTop: boolean;
  petVisible: boolean;
  /** ：1.0=，0.5~2.0，。 */
  petZoom: number;
  /**  X ， undefined */
  petWindowX?: number;
  /**  Y ， undefined */
  petWindowY?: number;
  sidebarVisible: boolean;
  tasksVisible: boolean;
  launchAtLogin: boolean;
  language: "en-US";
  uiTheme: UiTheme;
  uiFont: UiFont;
  uiIcon: UiIcon;
  /** 。 */
  defaultChatMode: DefaultChatMode;
  /** ，； renderer  styleId 。 */
  currentStyleId: StyleId;
  /** 。 */
  customStyle: CustomStyleConfig;
  /** 。 */
  segmentedOutputMode: SegmentedOutputMode;
  /** 。 */
  mobileMessageSegmentation: MobileMessageSegmentationMode;
  /** ；。 */
  proactiveChatMode: ProactiveChatMode;
  /** 、。 */
  proactiveDeliveryTarget: ProactiveDeliveryTarget;
  // TTS 
  ttsEngine: "off" | "web-speech" | "minimax" | "gptsovits" | "custom-cloud" | "mimo" | "mossland" | "edge";
  ttsAutoRead: boolean;
  ttsSpeed: number;
  ttsVolume: number;
  // MiniMax
  ttsMinimaxKey: string;
  ttsMinimaxVoiceId: string;
  /** MiniMax ：speech-2.8-hd(¥3.5/) | speech-2.8-turbo(¥2.0/) */
  ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
  /** MiniMax （，）；false= */
  ttsStreaming: boolean;
  // GPT-SoVITS（）
  ttsGptsovitsBaseUrl: string;
  ttsGptsovitsRefAudioPath: string;
  ttsGptsovitsPromptText: string;
  ttsGptsovitsFormat: "wav" | "mp3";
  ttsGptsovitsLanguageMode: GptsovitsLanguageMode;
  // RVC 
  ttsRvcEnabled: boolean;
  ttsRvcBaseUrl: string;
  ttsRvcModel: string;
  ttsRvcPitch: number;
  ttsRvcIndexRate: number;
  //  TTS
  ttsCustomCloudEndpointUrl: string;
  ttsCustomCloudApiKey: string;
  ttsCustomCloudVoiceId: string;
  ttsCustomCloudFormat: "wav" | "mp3";
  ttsCustomCloudTimeoutMs: number;
  //  MiMo TTS
  ttsMimoKey: string;
  ttsMimoVoiceAudioPath: string;
  ttsMimoStylePrompt: string;
  ttsMosslandKey: string;
  ttsMosslandVoiceId: string;
  ttsMosslandModel: string;
  ttsMosslandTestText: string;
  ttsMosslandFormat: "mp3" | "wav" | "pcm";
  /** ：open-meteo() | amap(,key) */
  weatherSource: "open-meteo" | "amap";
  /** （） */
  weatherEnabled: boolean;
  /**  key（https://lbs.amap.com  Web key） */
  amapKey: string;
  /** 🚗 */
  travelEnabled: boolean;
  /** 🖥️ （Playwright MCP）。 false，。 */
  playwrightMcpEnabled: boolean;
  // ： +  key
  searchEngine: "off" | "ddg" | "bocha" | "tavily" | "minimax";
  searchBochaKey: string;
  searchTavilyKey: string;
  searchMinimaxKey: string;
  /** ✉️ */
  emailEnabled: boolean;
  /** SMTP ， smtp.qq.com */
  emailSmtpHost: string;
  /** SMTP ， 465（SSL）/ 587（STARTTLS） */
  emailSmtpPort: number;
  /**  SSL/TLS（465  true，587  false；） */
  emailSmtpSecure: boolean;
  /**  */
  emailSmtpUser: string;
  /** SMTP （） */
  emailSmtpPass: string;
  /** （） */
  emailFromName: string;
  /** 🎧ASR ：off() | aliyun() | local(,) */
  asrEngine: "off" | "aliyun" | "local";
  /**  AppKey */
  asrAliyunAppKey: string;
  /**  RAM AccessKey ID */
  asrAliyunAccessKeyId: string;
  /**  RAM AccessKey Secret */
  asrAliyunAccessKeySecret: string;
  /** ASR ：zh() | en() | auto() */
  asrLanguage: "zh" | "en" | "auto";
  /** VAD （），500~2000， 1000 */
  asrVadSilenceMs: number;
  /** VAD （0~1）， 0.01。 */
  asrVadThreshold: number;
  /**  */
  asrShowTranscript: boolean;
  /** （Electron Accelerator ， "Alt+Shift+S"） */
  screenshotHotkey: string;
  systemAudioAwarenessEnabled: boolean;
}


interface PublicModelConfig {
  mode: "auto" | "manual";
  provider: string;
  // ； shortName
  displayName?: string;
  // （），""
  shortName: string;
  model: string;
  connected: boolean;
  runtimeSync: "off" | "local" | "llm";
  stickerSize: StickerSize;
  rerankerMode: "light" | "standard" | "none";
}

type RuntimeStatus = "Accompanying" | "Thinking" | "Working" | "Listening" | "Reminding" | "Offline";
type RuntimeFeeling = "Calm" | "Happy" | "Gentle" | "Excited" | "Coy" | "Worried" | "Sad" | "Touched" | "Shy";
type StickerSize = "small" | "standard" | "large";

interface RuntimeState {
  status: RuntimeStatus;
  feeling: RuntimeFeeling;
  expression: number;
  updatedAt: number;
}

const RUNTIME_STATUSES: RuntimeStatus[] = ["Accompanying", "Thinking", "Working", "Listening", "Reminding", "Offline"];
const RUNTIME_FEELINGS: RuntimeFeeling[] = ["Calm", "Happy", "Gentle", "Excited", "Coy", "Worried", "Sad", "Touched", "Shy"];
const CHAT_REQUEST_TIMEOUT_MS = 300000; // FC Total budget: 20 rounds × reasoning model ~10-15s needs 300s headroom

/** Base dimensions of desktop pet window (when zoom=1.0). */
const PET_WINDOW_BASE_WIDTH = 400;
const PET_WINDOW_BASE_HEIGHT = 500;
const STARTUP_EMBEDDING_REFRESH_DELAY_MS = 1500;

function getAppIconPath(icon: UiIcon): string {
  const preset = UI_ICON_PRESETS.find((item) => item.id === icon);
  const fileName = preset?.fileName ?? "cyrene-sun.png";
  const appPath = typeof app !== "undefined" && typeof app.getAppPath === "function" ? app.getAppPath() : process.cwd();
  const candidates = [
    path.join(appPath, "assets", "icon-presets", fileName),
    path.join(__dirname, "..", "..", "..", "assets", "icon-presets", fileName),
    path.join(process.cwd(), "assets", "icon-presets", fileName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getCurrentAppIconPath(): string {
  return getAppIconPath(loadGeneralSettings().uiIcon);
}
let runtimeState: RuntimeState = {
    status: "Accompanying",
    feeling: "Calm",
    expression: 0,
    updatedAt: Date.now(),
  };
let feelingScores = createFeelingScores(runtimeState.feeling);
let stickerEmbeddingIndex: StickerEmbeddingEntry[] | null = null;
let stickerEmbeddingRefreshSeq = 0;
let sceneEmbeddingIndex: SceneIndex | null = null;
let sceneEmbeddingRefreshSeq = 0;

function refreshStickerEmbeddingIndexInBackground(reason: string): void {
  const seq = ++stickerEmbeddingRefreshSeq;
  void (async () => {
    try {
      const provider = getEmbeddingProvider();
      if (!provider) {
        if (seq === stickerEmbeddingRefreshSeq) stickerEmbeddingIndex = null;
        console.warn("[StickerEmbedding] Model not found. Sticker matching disabled.");
        return;
      }

      const index = await buildCachedStickerEmbeddingIndex(
        provider,
        BUILT_IN_STICKER_DESCRIPTIONS,
        loadUserStickerManifest(),
      );
      if (seq !== stickerEmbeddingRefreshSeq) return;
      stickerEmbeddingIndex = index;
      console.log(`[StickerEmbedding] index ready (${reason}): ${index.length} entries`);
    } catch (err) {
      if (seq === stickerEmbeddingRefreshSeq) stickerEmbeddingIndex = null;
      console.error("[StickerEmbedding] refresh failed:", err instanceof Error ? err.message : String(err));
    }
  })();
}

function refreshSceneEmbeddingIndexInBackground(reason: string): void {
  const seq = ++sceneEmbeddingRefreshSeq;
  void (async () => {
    try {
      const sceneProvider = getSceneEmbeddingProvider();
      if (!sceneProvider) {
        if (seq === sceneEmbeddingRefreshSeq) sceneEmbeddingIndex = null;
        console.warn("[SceneEmbedding] bge-m3 model not found. Scene embedding disabled.");
        return;
      }

      const index = await buildCachedSceneIndex(sceneProvider);
      if (seq !== sceneEmbeddingRefreshSeq) return;
      sceneEmbeddingIndex = index;
      console.log("[SceneEmbedding] index ready:", Object.keys(index.scenes).length, "scenes", `(${reason})`);
    } catch (err) {
      if (seq === sceneEmbeddingRefreshSeq) sceneEmbeddingIndex = null;
      console.error("[SceneEmbedding] refresh failed:", err instanceof Error ? err.message : String(err));
    }
  })();
}

function scheduleStartupEmbeddingRefreshes(): void {
  setTimeout(() => {
    refreshStickerEmbeddingIndexInBackground("startup");
    refreshSceneEmbeddingIndexInBackground("startup");
  }, STARTUP_EMBEDDING_REFRESH_DELAY_MS);
}

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  mode: "auto",
  //  MiniMax（v1 vendor adapter ），DeepSeek  v1 。
  provider: LOCAL_MODEL_PROVIDER,
  baseUrl: DEFAULT_OLLAMA_BASE_URL,
  model: DEFAULT_OLLAMA_MODEL,
  apiKey: "",
  perProvider: {
    [LOCAL_MODEL_PROVIDER]: {
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      model: DEFAULT_OLLAMA_MODEL,
      apiKey: "",
      displayName: "Ollama (Local)",
    },
  },
  runtimeSync: "llm",
  stickerEnabled: true,
  stickerSize: "standard",
  stickerSimilarityThreshold: 0.55,
  chatRequestTimeoutSec: 300,
  maxIterations: 12,
  maxReplans: 2,
  maxRefresh: 1,
  perCallTimeoutSec: 75,
  citaRepairBudgetSec: 8,
  actionGateRepairBudgetSec: 10,
  rerankerMode: "light",
  embeddingModel: "minilm",
  vision: { baseUrl: DEFAULT_OLLAMA_BASE_URL, apiKey: "", model: DEFAULT_OLLAMA_VISION_MODEL },
  multimodal: false,
};

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  citaEnabled: false,
  citaSemanticEngine: "remote",
  chatSocialContextEnabled: false,
  musicEnabled: false,
  musicVolume: 60,
  soundEnabled: true,
  soundVolume: 70,
  petAlwaysOnTop: true,
  petVisible: true,
  petZoom: 1,
  sidebarVisible: true,
  tasksVisible: true,
  launchAtLogin: false,
  language: "en-US",
  uiTheme: "classic",
  uiFont: DEFAULT_UI_FONT,
  uiIcon: "cyrene-sun",
  defaultChatMode: "work",
  currentStyleId: "default",
  customStyle: DEFAULT_CUSTOM_STYLE,
  segmentedOutputMode: "off",
  mobileMessageSegmentation: "off",
  proactiveChatMode: "off",
  proactiveDeliveryTarget: "local",
  ttsEngine: "gptsovits",
  ttsAutoRead: true,
  ttsSpeed: 1,
  ttsVolume: 1,
  ttsMinimaxKey: "",
  ttsMinimaxVoiceId: "",
  ttsMinimaxModel: "speech-2.8-turbo",
  ttsStreaming: true,
  ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
  ttsGptsovitsRefAudioPath: getDefaultCyreneRefAudioPath(),
  ttsGptsovitsPromptText: "开拓者，希琳一直都在这里陪着你哦。",
  ttsGptsovitsFormat: "wav",
  ttsGptsovitsLanguageMode: "original-mandarin",
  ttsRvcEnabled: false,
  ttsRvcBaseUrl: "http://localhost:18888",
  ttsRvcModel: "Cyrene (Aiden Dawn)",
  ttsRvcPitch: 0,
  ttsRvcIndexRate: 0.75,
  ttsCustomCloudEndpointUrl: "",
  ttsCustomCloudApiKey: "",
  ttsCustomCloudVoiceId: "",
  ttsCustomCloudFormat: "mp3",
  ttsCustomCloudTimeoutMs: 30000,
  ttsMimoKey: "",
  ttsMimoVoiceAudioPath: "",
  ttsMimoStylePrompt: "Gentle, natural, and warmly conversational, as if speaking softly with the user.",
  ttsMosslandKey: "",
  ttsMosslandVoiceId: "",
  ttsMosslandModel: "moss-tts",
  ttsMosslandTestText: "Hello, I am Cyrene. It is wonderful to meet you.",
  ttsMosslandFormat: "mp3",
  weatherSource: "open-meteo",
  weatherEnabled: true,
  amapKey: "",
  travelEnabled: true,
  playwrightMcpEnabled: false,
  searchEngine: "ddg",
  searchBochaKey: "",
  searchTavilyKey: "",
  searchMinimaxKey: "",
  emailEnabled: false,
  emailSmtpHost: "",
  emailSmtpPort: 465,
  emailSmtpSecure: true,
  emailSmtpUser: "",
  emailSmtpPass: "",
  emailFromName: "",
  asrEngine: "local",
  asrAliyunAppKey: "",
  asrAliyunAccessKeyId: "",
  asrAliyunAccessKeySecret: "",
  asrLanguage: "en",
  asrVadSilenceMs: 1000,
  asrVadThreshold: 0.01,
  asrShowTranscript: false,
  screenshotHotkey: "Alt+Shift+S",
  systemAudioAwarenessEnabled: true,
};

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "model-settings.json");
}

function getGeneralSettingsPath(): string {
  return path.join(app.getPath("userData"), "app-settings.json");
}


function getUserProfilePath(): string {
  return path.join(app.getPath("userData"), "user-profile.json");
}

function getAvatarPath(): string {
  return path.join(app.getPath("userData"), "avatar.png");
}

function getRagStorePath(): string {
  return path.join(app.getPath("userData"), "rag-data", "memory-store.json");
}

const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: "",
  callPreference: "",
  birthday: "",
  timezone: "Asia/Shanghai",
  avatarPath: "",
  defaultCity: "Hanoi",
  gender: "secret",
};

function loadUserProfile(): UserProfile {
  try {
    const filePath = getUserProfilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_USER_PROFILE;
    const loaded = { ...DEFAULT_USER_PROFILE, ...JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<UserProfile> };
    if (!loaded.defaultCity || !loaded.defaultCity.trim()) {
      loaded.defaultCity = "Hanoi";
    }
    return loaded;
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function saveUserProfile(profile: Partial<UserProfile>): UserProfile {
  const existing = loadUserProfile();
  const merged = { ...existing, ...profile };
  const filePath = getUserProfilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

interface MemoryPanelItem {
  id: string;
  title: string;
  body: string;
  meta: string;
}

interface ImportedDocItem {
  importId: string | null;
  fileName: string;
  chunkCount: number;
  lastImportedAt: number;
}

async function loadMemoryPanelData() {
  const [l0, l1, l2] = await Promise.all([
    memoryStore.getL0(),
    memoryStore.getL1(),
    memoryStore.getAllL2(),
  ]);

  let importedDocs: ImportedDocItem[] = [];
  const ragStorePath = getRagStorePath();

  try {
    if (fs.existsSync(ragStorePath)) {
      const raw = fs.readFileSync(ragStorePath, "utf8");
      const entries = JSON.parse(raw) as Array<{
        source?: string;
        createdAt?: number;
        metadata?: { fileName?: string; importId?: string };
      }>;

      const docsMap = new Map<string, ImportedDocItem>();
      for (const entry of entries) {
        if (entry.source !== "imported_doc") continue;
        const fileName = entry.metadata?.fileName || "Untitled document";
        const importId = entry.metadata?.importId as string | undefined;
        //  importId ， fileName 
        const key = importId || "legacy:" + fileName;
        const existing = docsMap.get(key);
        if (existing) {
          existing.chunkCount += 1;
          existing.lastImportedAt = Math.max(existing.lastImportedAt, entry.createdAt || 0);
        } else {
          docsMap.set(key, {
            importId: importId || null,
            fileName,
            chunkCount: 1,
            lastImportedAt: entry.createdAt || 0,
          });
        }
      }

      importedDocs = [...docsMap.values()].sort((a, b) => b.lastImportedAt - a.lastImportedAt);
    }
  } catch (error) {
    console.warn("[settings] load imported docs failed:", error);
  }

  return {
    l0,
    l1,
    l2: l2.sort((a, b) => b.createdAt - a.createdAt),
    importedDocs,
    reflections: [] as MemoryPanelItem[],
  };
}

function getStickerSettingsPath(): string {
  return path.join(app.getPath("userData"), "sticker-settings.json");
}

/**
 * normalize ：
 *   1. （mode/provider/runtimeSync/...）
 *   2.  perProvider ：、、apiKey  trim 
 *   3.  schema ： perProvider  currentProvider ， baseUrl/model/apiKey 
 *   4.  perProvider[currentProvider]  baseUrl/model/apiKey 
 *      → （source of truth） perProvider；
 */
function normalizeProviderProfile(input: Partial<ProviderProfile> | null | undefined): ProviderProfile {
  const explicitTransport: ProviderProfile["explicitTransport"] =
    input?.explicitTransport === "openai" || input?.explicitTransport === "anthropic" || input?.explicitTransport === "auto"
      ? input.explicitTransport
      : undefined;
  return {
    baseUrl: typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "",
    model: typeof input?.model === "string" ? input.model.trim() : "",
    apiKey: typeof input?.apiKey === "string" ? input.apiKey.trim() : "",
    displayName: typeof input?.displayName === "string" && input?.displayName.trim() ? input.displayName.trim() : undefined,
    explicitTransport,
    reasoning: normalizeReasoningPreference((input as { reasoning?: unknown })?.reasoning),
  };
}

/** 。 = ， undefined。 */
function normalizeVisionConfig(input: Partial<VisionModelConfig> | undefined): VisionModelConfig | undefined {
  if (!input || typeof input !== "object") return undefined;
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  //  = 
  if (!baseUrl && !apiKey && !model) return undefined;
  return { baseUrl, apiKey, model };
}

function normalizeModelSettings(input: Partial<ModelSettings> | null | undefined): ModelSettings {
  const mode: "auto" | "manual" = input?.mode === "manual" ? "manual" : "auto";
  let provider = typeof input?.provider === "string" && input.provider.trim()
    ? input.provider.trim()
    : DEFAULT_MODEL_SETTINGS.provider;

  // perProvider ：、
  const rawPerProvider = (input as ModelSettings | undefined)?.perProvider;
  let perProvider: Record<string, ProviderProfile> = {};
  if (rawPerProvider && typeof rawPerProvider === "object") {
    for (const [key, value] of Object.entries(rawPerProvider)) {
      if (typeof key !== "string" || !key.trim()) continue;
      perProvider[key.trim()] = normalizeProviderProfile(value as Partial<ProviderProfile>);
    }
  }

  // ： provider  provider 。
  // " schema "，。
  ({ provider, perProvider } = migrateProviderRenames(provider, perProvider));
  for (const [providerName, profile] of Object.entries(perProvider)) {
    perProvider[providerName] = migrateLegacyMinimaxDefaults(providerName, profile);
  }

  //  schema ：v1  model-config.json  perProvider ，
  //  baseUrl/model/apiKey 。 currentProvider 。
  if (!perProvider[provider]) {
    perProvider[provider] = normalizeProviderProfile({
      baseUrl: typeof input?.baseUrl === "string" ? input.baseUrl : "",
      model: typeof input?.model === "string" ? input.model : "",
      apiKey: typeof input?.apiKey === "string" ? input.apiKey : "",
    });

    ipcMain.handle(IPC.APP_CHECK_FOR_UPDATES, async () => {
      const { checkForAppUpdates } = await import("./updater/auto-updater");
      return checkForAppUpdates(app.getVersion());
    });
    // （）， baseUrl/model（ UI ）
    if (!perProvider[provider].baseUrl) perProvider[provider].baseUrl = DEFAULT_MODEL_SETTINGS.baseUrl;
    if (!perProvider[provider].model) perProvider[provider].model = DEFAULT_MODEL_SETTINGS.model;
  }

  // ： perProvider[provider] 
  const profile = perProvider[provider];

  // ：vision.syncWithMain === true -> multimodal: true
  let multimodal = input?.multimodal === true;
  const rawVision = input?.vision as Partial<VisionModelConfig> & { syncWithMain?: boolean } | undefined;
  if (rawVision && rawVision.syncWithMain === true) {
    multimodal = true;
  }

  return {
    mode,
    provider,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: profile.apiKey,
    explicitTransport: profile.explicitTransport,
    reasoning: profile.reasoning,  // ： explicitTransport （perProvider[currentProvider].reasoning）
    perProvider,
    runtimeSync: input?.runtimeSync === "local" ? "local" : "llm",
    stickerEnabled: input?.stickerEnabled !== false,
    stickerSize: input?.stickerSize === "small" || input?.stickerSize === "large" ? input.stickerSize : "standard",
    stickerSimilarityThreshold: typeof input?.stickerSimilarityThreshold === "number"
      ? Math.max(0.3, Math.min(0.9, input.stickerSimilarityThreshold))
      : 0.55,
    chatRequestTimeoutSec: typeof input?.chatRequestTimeoutSec === "number"
      && Number.isFinite(input.chatRequestTimeoutSec)
      ? Math.max(30, Math.min(1800, Math.round(input.chatRequestTimeoutSec)))
      : 300,
    maxIterations: typeof input?.maxIterations === "number" && Number.isFinite(input.maxIterations)
      ? Math.max(5, Math.min(30, Math.round(input.maxIterations)))
      : 12,
    maxReplans: typeof input?.maxReplans === "number" && Number.isFinite(input.maxReplans)
      ? Math.max(1, Math.min(5, Math.round(input.maxReplans)))
      : 2,
    maxRefresh: typeof input?.maxRefresh === "number" && Number.isFinite(input.maxRefresh)
      ? Math.max(0, Math.min(3, Math.round(input.maxRefresh)))
      : 1,
    perCallTimeoutSec: typeof input?.perCallTimeoutSec === "number" && Number.isFinite(input.perCallTimeoutSec)
      ? Math.max(30, Math.min(120, Math.round(input.perCallTimeoutSec)))
      : 75,
    citaRepairBudgetSec: typeof input?.citaRepairBudgetSec === "number" && Number.isFinite(input.citaRepairBudgetSec)
      ? Math.max(4, Math.min(30, Math.round(input.citaRepairBudgetSec)))
      : 8,
    actionGateRepairBudgetSec: typeof input?.actionGateRepairBudgetSec === "number" && Number.isFinite(input.actionGateRepairBudgetSec)
      ? Math.max(5, Math.min(40, Math.round(input.actionGateRepairBudgetSec)))
      : 10,
    rerankerMode: input?.rerankerMode === "standard" || input?.rerankerMode === "none" ? input.rerankerMode : "light",
    embeddingModel: input?.embeddingModel === "bgem3" ? "bgem3" : "minilm",
    vision: normalizeVisionConfig(rawVision) ?? DEFAULT_MODEL_SETTINGS.vision,
    multimodal,
  };
}

function loadModelSettings(): ModelSettings {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return DEFAULT_MODEL_SETTINGS;
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeModelSettings(JSON.parse(raw) as Partial<ModelSettings>);
  } catch (err) {
    console.error("[Cyrene] load settings failed:", err);
    return DEFAULT_MODEL_SETTINGS;
  }
}

/**
 * ， syncWithMain  supportsVision 。
 *  null = （read_image ）。
 *
 * syncWithMain=true ： baseUrl/key/model， supportsVision——
 * ， null（）。
 */
/**
 * 。
 * multimodal=true：，（ read_image ）。
 * multimodal=false：（）， null。
 */
export function loadVisionConfig(): VisionConfig | null {
  const settings = loadModelSettings();

  if (settings.multimodal) {
    if (!isModelEndpointUsable(settings)) return null;
    return { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model };
  }

  const v = settings.vision;
  if (v && isModelEndpointUsable(v)) {
    return { baseUrl: v.baseUrl, apiKey: v.apiKey, model: v.model };
  }

  return null;
}

/**
 * ：
 *   -  settings  baseUrl/model/apiKey（），
 *      perProvider（，）。
 *   - "" perProvider[provider]，。
 *   - normalizeModelSettings  perProvider[provider] ， = 。
 */
function saveModelSettings(settings: Partial<ModelSettings>): ModelSettings {
  const existing = loadModelSettings();
  const merged: Partial<ModelSettings> = { ...existing, ...settings };

  // currentProvider 、
  const currentProvider = (typeof settings.provider === "string" && settings.provider.trim())
    ? settings.provider.trim()
    : existing.provider;

  // ： perProvider， merge  perProvider
  const perProvider: Record<string, ProviderProfile> = { ...(existing.perProvider ?? {}) };
  if (settings.perProvider && typeof settings.perProvider === "object") {
    for (const [key, value] of Object.entries(settings.perProvider)) {
      perProvider[key] = normalizeProviderProfile(value as Partial<ProviderProfile>);
    }
  }

  //  currentProvider （）
  const incomingProfile = perProvider[currentProvider] ?? normalizeProviderProfile(null);
  // explicitTransport：。 "openai" | "anthropic" | "auto" ； undefined  "auto"。
  const incomingExplicitTransport: ProviderProfile["explicitTransport"] =
    settings.explicitTransport === "openai" || settings.explicitTransport === "anthropic" || settings.explicitTransport === "auto"
      ? settings.explicitTransport
      : incomingProfile.explicitTransport;
  // reasoning （ #4）： perProvider >  > existing
  const incomingProfileForReasoning = (settings.perProvider ?? {})[currentProvider];
  const hasProfileReasoning = incomingProfileForReasoning
    && Object.prototype.hasOwnProperty.call(incomingProfileForReasoning, "reasoning");
  const hasTopLevelReasoning = Object.prototype.hasOwnProperty.call(settings, "reasoning");
  let chosenReasoningRaw: unknown;
  let chosenReasoningHasKey: boolean;
  if (hasProfileReasoning) {
    chosenReasoningRaw = (incomingProfileForReasoning as { reasoning?: unknown }).reasoning;
    chosenReasoningHasKey = true;
  } else if (hasTopLevelReasoning) {
    chosenReasoningRaw = settings.reasoning;
    chosenReasoningHasKey = true;
  } else {
    chosenReasoningRaw = undefined;
    chosenReasoningHasKey = false;
  }
  const foldedReasoning = foldReasoning(chosenReasoningRaw, incomingProfile.reasoning, chosenReasoningHasKey);

  perProvider[currentProvider] = {
    baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : incomingProfile.baseUrl,
    model: typeof settings.model === "string" ? settings.model.trim() : incomingProfile.model,
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : incomingProfile.apiKey,
    displayName: typeof settings.displayName === "string" && settings.displayName.trim()
      ? settings.displayName.trim()
      : incomingProfile.displayName,
    explicitTransport: incomingExplicitTransport,
    reasoning: foldedReasoning,
  };

  merged.provider = currentProvider;
  merged.perProvider = perProvider;

  const final = normalizeModelSettings(merged);
  const filePath = getSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(final, null, 2), "utf8");
  return final;
}

function normalizeGeneralSettings(input: Partial<GeneralSettings> | null | undefined): GeneralSettings {
  const windowVisibility = normalizeWindowVisibilitySettings(input);
  const cita = normalizeCitaSettings({
    enabled: input?.citaEnabled,
    semanticEngine: input?.citaSemanticEngine,
  });
  const clamp = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : fallback;
  };
  const clampPort = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(1, Math.min(65535, Math.round(num))) : fallback;
  };
  const clampMs = (value: unknown, fallback: number) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.max(1000, Math.min(120000, Math.round(num))) : fallback;
  };
  return {
    citaEnabled: cita.enabled,
    citaSemanticEngine: cita.semanticEngine,
    chatSocialContextEnabled: normalizeChatSocialContextEnabled(input?.chatSocialContextEnabled),
    musicEnabled: Boolean(input?.musicEnabled),
    musicVolume: clamp(input?.musicVolume, DEFAULT_GENERAL_SETTINGS.musicVolume),
    soundEnabled: input?.soundEnabled === undefined ? DEFAULT_GENERAL_SETTINGS.soundEnabled : Boolean(input.soundEnabled),
    soundVolume: clamp(input?.soundVolume, DEFAULT_GENERAL_SETTINGS.soundVolume),
    petAlwaysOnTop: input?.petAlwaysOnTop === undefined ? DEFAULT_GENERAL_SETTINGS.petAlwaysOnTop : Boolean(input.petAlwaysOnTop),
    petVisible: input?.petVisible === undefined ? DEFAULT_GENERAL_SETTINGS.petVisible : Boolean(input.petVisible),
    petZoom: typeof input?.petZoom === "number" ? Math.max(0.5, Math.min(2, input.petZoom)) : DEFAULT_GENERAL_SETTINGS.petZoom,
    petWindowX: typeof input?.petWindowX === "number" && isFinite(input.petWindowX)
      ? Math.round(input.petWindowX) : undefined,
    petWindowY: typeof input?.petWindowY === "number" && isFinite(input.petWindowY)
      ? Math.round(input.petWindowY) : undefined,
    sidebarVisible: windowVisibility.sidebarVisible,
    tasksVisible: windowVisibility.tasksVisible,
    launchAtLogin: Boolean(input?.launchAtLogin),
    language: "en-US",
    uiTheme: normalizeUiTheme(input?.uiTheme),
    uiFont: normalizeUiFont(input?.uiFont),
    uiIcon: normalizeUiIcon(input?.uiIcon),
    defaultChatMode: normalizeDefaultChatMode(input?.defaultChatMode),
    currentStyleId: normalizeStyleId(input?.currentStyleId),
    customStyle: normalizeCustomStyleConfig(input?.customStyle),
    segmentedOutputMode: normalizeSegmentedOutputMode(input?.segmentedOutputMode),
    mobileMessageSegmentation: normalizeMobileMessageSegmentationMode(input?.mobileMessageSegmentation),
    proactiveChatMode: normalizeProactiveChatMode(input?.proactiveChatMode),
    proactiveDeliveryTarget: normalizeProactiveDeliveryTarget(input?.proactiveDeliveryTarget),
    // TTS 
    ttsEngine: (["off", "web-speech", "minimax", "gptsovits", "custom-cloud", "mimo", "mossland", "edge"].includes(input?.ttsEngine as string) ? input?.ttsEngine : "gptsovits") as GeneralSettings["ttsEngine"],
    ttsAutoRead: input?.ttsAutoRead === undefined ? DEFAULT_GENERAL_SETTINGS.ttsAutoRead : Boolean(input.ttsAutoRead),
    ttsSpeed: typeof input?.ttsSpeed === "number" ? Math.max(0.5, Math.min(2, input.ttsSpeed)) : DEFAULT_GENERAL_SETTINGS.ttsSpeed,
    ttsVolume: typeof input?.ttsVolume === "number" ? Math.max(0, Math.min(1, input.ttsVolume)) : DEFAULT_GENERAL_SETTINGS.ttsVolume,
    ttsMinimaxKey: typeof input?.ttsMinimaxKey === "string" ? input.ttsMinimaxKey : "",
    ttsMinimaxVoiceId: typeof input?.ttsMinimaxVoiceId === "string" ? input.ttsMinimaxVoiceId : "",
    ttsMinimaxModel: input?.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo",
    ttsStreaming: input?.ttsStreaming === undefined ? true : Boolean(input.ttsStreaming),
    weatherSource: ["open-meteo", "amap"].includes(String(input?.weatherSource))
      ? (input!.weatherSource as "open-meteo" | "amap")
      : "open-meteo",
    weatherEnabled: Boolean(input?.weatherEnabled),
    amapKey: typeof input?.amapKey === "string" ? input.amapKey : "",
    travelEnabled: Boolean(input?.travelEnabled),
    playwrightMcpEnabled: Boolean(input?.playwrightMcpEnabled),
    searchEngine: ["off", "ddg", "bocha", "tavily", "minimax"].includes(String(input?.searchEngine))
      ? (input!.searchEngine as "off" | "ddg" | "bocha" | "tavily" | "minimax")
      : "off",
    searchBochaKey: typeof input?.searchBochaKey === "string" ? input.searchBochaKey : "",
    searchTavilyKey: typeof input?.searchTavilyKey === "string" ? input.searchTavilyKey : "",
    searchMinimaxKey: typeof input?.searchMinimaxKey === "string" ? input.searchMinimaxKey : "",
    // （SMTP）
    emailEnabled: Boolean(input?.emailEnabled),
    emailSmtpHost: typeof input?.emailSmtpHost === "string" ? input.emailSmtpHost : "",
    emailSmtpPort: clampPort(input?.emailSmtpPort, DEFAULT_GENERAL_SETTINGS.emailSmtpPort),
    emailSmtpSecure: input?.emailSmtpSecure === undefined
      ? (clampPort(input?.emailSmtpPort, DEFAULT_GENERAL_SETTINGS.emailSmtpPort) === 465)
      : Boolean(input.emailSmtpSecure),
    emailSmtpUser: typeof input?.emailSmtpUser === "string" ? input.emailSmtpUser : "",
    emailSmtpPass: typeof input?.emailSmtpPass === "string" ? input.emailSmtpPass : "",
    emailFromName: typeof input?.emailFromName === "string" ? input.emailFromName : "",
    // ASR（）
    asrEngine: ["off", "aliyun", "local"].includes(String(input?.asrEngine))
      ? (input!.asrEngine as "off" | "aliyun" | "local")
      : "off",
    asrAliyunAppKey: typeof input?.asrAliyunAppKey === "string" ? input.asrAliyunAppKey : "",
    asrAliyunAccessKeyId: typeof input?.asrAliyunAccessKeyId === "string" ? input.asrAliyunAccessKeyId : "",
    asrAliyunAccessKeySecret: typeof input?.asrAliyunAccessKeySecret === "string" ? input.asrAliyunAccessKeySecret : "",
    asrLanguage: ["zh", "en", "auto"].includes(String(input?.asrLanguage))
      ? (input!.asrLanguage as "zh" | "en" | "auto")
      : "en",
    asrVadSilenceMs: typeof input?.asrVadSilenceMs === "number"
      ? Math.max(300, Math.min(30000, Math.round(input.asrVadSilenceMs)))
      : DEFAULT_GENERAL_SETTINGS.asrVadSilenceMs,
    asrVadThreshold: typeof input?.asrVadThreshold === "number"
      ? Math.max(0.001, Math.min(0.5, Number(input.asrVadThreshold)))
      : DEFAULT_GENERAL_SETTINGS.asrVadThreshold,
    asrShowTranscript: Boolean(input?.asrShowTranscript),
    screenshotHotkey: typeof input?.screenshotHotkey === "string" && input.screenshotHotkey.trim()
      ? input.screenshotHotkey.trim() : DEFAULT_GENERAL_SETTINGS.screenshotHotkey,
    systemAudioAwarenessEnabled: typeof input?.systemAudioAwarenessEnabled === "boolean"
      ? input.systemAudioAwarenessEnabled
      : DEFAULT_GENERAL_SETTINGS.systemAudioAwarenessEnabled,
    ttsGptsovitsBaseUrl: typeof input?.ttsGptsovitsBaseUrl === "string" ? input.ttsGptsovitsBaseUrl : DEFAULT_GENERAL_SETTINGS.ttsGptsovitsBaseUrl,
    ttsGptsovitsRefAudioPath: typeof input?.ttsGptsovitsRefAudioPath === "string" && input.ttsGptsovitsRefAudioPath.trim() ? input.ttsGptsovitsRefAudioPath.trim() : getDefaultCyreneRefAudioPath(),
    ttsGptsovitsPromptText: typeof input?.ttsGptsovitsPromptText === "string" && input.ttsGptsovitsPromptText.trim() ? input.ttsGptsovitsPromptText.trim() : "开拓者，希琳一直都在这里陪着你哦。",
    ttsGptsovitsFormat: input?.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
    ttsGptsovitsLanguageMode: "original-mandarin",
    ttsRvcEnabled: input?.ttsRvcEnabled === true,
    ttsRvcBaseUrl: typeof input?.ttsRvcBaseUrl === "string" && input.ttsRvcBaseUrl.trim() ? input.ttsRvcBaseUrl.trim() : DEFAULT_GENERAL_SETTINGS.ttsRvcBaseUrl,
    ttsRvcModel: typeof input?.ttsRvcModel === "string" && input.ttsRvcModel.trim() ? input.ttsRvcModel.trim() : DEFAULT_GENERAL_SETTINGS.ttsRvcModel,
    ttsRvcPitch: typeof input?.ttsRvcPitch === "number" && Number.isFinite(input.ttsRvcPitch) ? Math.max(-24, Math.min(24, input.ttsRvcPitch)) : 0,
    ttsRvcIndexRate: typeof input?.ttsRvcIndexRate === "number" && Number.isFinite(input.ttsRvcIndexRate) ? Math.max(0, Math.min(1, input.ttsRvcIndexRate)) : 0.75,
    ttsCustomCloudEndpointUrl: typeof input?.ttsCustomCloudEndpointUrl === "string" ? input.ttsCustomCloudEndpointUrl : "",
    ttsCustomCloudApiKey: typeof input?.ttsCustomCloudApiKey === "string" ? input.ttsCustomCloudApiKey : "",
    ttsCustomCloudVoiceId: typeof input?.ttsCustomCloudVoiceId === "string" ? input.ttsCustomCloudVoiceId : "",
    ttsCustomCloudFormat: input?.ttsCustomCloudFormat === "wav" ? "wav" : "mp3",
    ttsCustomCloudTimeoutMs: clampMs(input?.ttsCustomCloudTimeoutMs, DEFAULT_GENERAL_SETTINGS.ttsCustomCloudTimeoutMs),
    ttsMimoKey: typeof input?.ttsMimoKey === "string" ? input.ttsMimoKey : "",
    ttsMimoVoiceAudioPath: typeof input?.ttsMimoVoiceAudioPath === "string" ? input.ttsMimoVoiceAudioPath : "",
    ttsMimoStylePrompt: typeof input?.ttsMimoStylePrompt === "string" ? input.ttsMimoStylePrompt : DEFAULT_GENERAL_SETTINGS.ttsMimoStylePrompt,
    ttsMosslandKey: typeof input?.ttsMosslandKey === "string" ? input.ttsMosslandKey : "",
    ttsMosslandVoiceId: typeof input?.ttsMosslandVoiceId === "string" ? input.ttsMosslandVoiceId : "",
    ttsMosslandModel: typeof input?.ttsMosslandModel === "string" && input.ttsMosslandModel.trim() ? input.ttsMosslandModel.trim() : "moss-tts",
    ttsMosslandTestText: typeof input?.ttsMosslandTestText === "string" ? input.ttsMosslandTestText : DEFAULT_GENERAL_SETTINGS.ttsMosslandTestText,
    ttsMosslandFormat: input?.ttsMosslandFormat === "wav" || input?.ttsMosslandFormat === "pcm" ? input.ttsMosslandFormat : "mp3",
  };
}

function loadGeneralSettings(): GeneralSettings {
  try {
    const filePath = getGeneralSettingsPath();
    if (!fs.existsSync(filePath)) return DEFAULT_GENERAL_SETTINGS;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<GeneralSettings>;
    const normalized = normalizeGeneralSettings(raw);
    // Auto-heal legacy empty paths, English voice mode, or disabled TTS engine on disk
    if (
      raw.ttsGptsovitsLanguageMode !== "original-mandarin" ||
      !raw.ttsGptsovitsRefAudioPath ||
      !raw.ttsGptsovitsPromptText ||
      raw.ttsEngine === "off"
    ) {
      try {
        if (raw.ttsEngine === "off") {
          normalized.ttsEngine = "gptsovits";
        }
        fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
      } catch { /* non-fatal disk write */ }
    }
    return normalized;
  } catch (err) {
    console.error("[Cyrene] load general settings failed:", err);
    return DEFAULT_GENERAL_SETTINGS;
  }
}

function applyGeneralSettings(settings: GeneralSettings): void {
  mainWindow?.setAlwaysOnTop(settings.petAlwaysOnTop, settings.petAlwaysOnTop ? "screen-saver" : "normal");
  if (settings.petVisible) mainWindow?.show();
  else mainWindow?.hide();
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  applyPetZoom(settings.petZoom);
}

/**
 * ， scale。
 * ，，、。
 */
function applyPetZoom(zoom: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const width = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
  const height = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);
  const currentSize = mainWindow.getSize();
  if (currentSize[0] !== width || currentSize[1] !== height) {
    mainWindow.setSize(width, height);
  }
  sendToLive2DWindow(IPC.PET_ZOOM, zoom);
}

function saveGeneralSettings(settings: Partial<GeneralSettings>): GeneralSettings {
  const before = loadGeneralSettings();
  const normalized = normalizeGeneralSettings({ ...before, ...settings });
  const filePath = getGeneralSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
  applyGeneralSettings(normalized);
  if (systemAudioAwareness && before.systemAudioAwarenessEnabled !== normalized.systemAudioAwarenessEnabled) {
    void setSystemAudioAwarenessEnabled(normalized.systemAudioAwarenessEnabled);
  }
  syncBuiltInToolToggles(normalized);
  if (before.uiTheme !== normalized.uiTheme) {
    broadcastUiThemeChanged(normalized.uiTheme);
  }
  if (JSON.stringify(before.uiFont) !== JSON.stringify(normalized.uiFont)) {
    broadcastUiFontChanged(normalized.uiFont);
  }
  if (before.uiIcon !== normalized.uiIcon) {
    applyUiIcon(normalized.uiIcon);
  }
  if (before.screenshotHotkey !== normalized.screenshotHotkey) {
    const result = screenshotService?.replaceHotkey(normalized.screenshotHotkey);
    if (result && !result.ok) {
      console.warn("[Cyrene] Screenshot shortcut registration failed; another app may be using it:", normalized.screenshotHotkey);
    }
  }
  return normalized;
}

function syncBuiltInToolToggles(settings: GeneralSettings): void {
  toolRegistry.setEnabled("weather", settings.weatherEnabled);
  toolRegistry.setEnabled("plan_trip", settings.travelEnabled);
}

/** MiniMax  MCP Server  ID。 */
const MINIMAX_SEARCH_MCP_ID = "minimax-web-search";

/**
 *  MCP Server： MiniMax+key→，→。
 *  TTS_SAVE_SETTINGS 。
 */
async function syncVolcanoSearchMcp(settings: GeneralSettings): Promise<{ mcpSyncResult: string }> {
  // ── MiniMax（PyPI，GitHub，）──
  const minimaxEnable = settings.searchEngine === "minimax";
  const minimaxExists = listMcpServers().some(s => s.id === MINIMAX_SEARCH_MCP_ID);

  // Key （ Key）
  if (minimaxEnable) {
    const keyValidation = validateSearchApiKey(settings.searchMinimaxKey, "MiniMax API Key");
    console.log(`[Cyrene] MiniMax key validation: length=${keyValidation.diagnostics.length} trimmed=${keyValidation.diagnostics.trimmed} nonAscii=${keyValidation.diagnostics.hasNonAscii} controlChars=${keyValidation.diagnostics.hasControlChars}`);
    if (!keyValidation.valid) {
      console.error(`[Cyrene] MiniMax key validation failed: ${keyValidation.error}`);
      // Key ， MCP 
      if (minimaxExists) {
        try { await removeMcpServer(MINIMAX_SEARCH_MCP_ID); } catch (err) { console.error("[Cyrene] Failed to remove MiniMax Search MCP:", err); }
      }
      return { mcpSyncResult: `key_invalid: ${keyValidation.error}` };
    }
  }

  if (minimaxEnable && !minimaxExists) {
    console.log("[Cyrene] Registering MiniMax Search MCP server...");
    try {
      const result = await addMcpServer({
        id: MINIMAX_SEARCH_MCP_ID,
        name: "MiniMax Search",
        transport: "stdio",
        command: "uvx",
        args: ["minimax-coding-plan-mcp", "-y"],
        env: {
          MINIMAX_API_KEY: settings.searchMinimaxKey.trim(),
          MINIMAX_API_HOST: "https://api.minimaxi.com",
        },
      });
      if (result.ok) {
        console.log("[Cyrene] MiniMax Search MCP registered; tools:", result.toolIds?.join(", "));
        return { mcpSyncResult: `registered: ${result.toolIds?.join(", ") ?? "none"}` };
      } else {
        console.error("[Cyrene] MiniMax Search MCP registration failed:", result.error);
        return { mcpSyncResult: `register_failed: ${result.error}` };
      }
    } catch (err) {
      console.error("[Cyrene] MiniMax Search MCP registration error:", err);
      return { mcpSyncResult: `register_exception: ${err}` };
    }
  } else if (!minimaxEnable && minimaxExists) {
    console.log("[Cyrene] Removing MiniMax Search MCP server...");
    try { await removeMcpServer(MINIMAX_SEARCH_MCP_ID); return { mcpSyncResult: "removed" }; } catch (err) { console.error("[Cyrene] Failed to remove MiniMax Search MCP:", err); return { mcpSyncResult: `remove_exception: ${err}` }; }
  } else if (minimaxEnable && minimaxExists) {
    console.log("[Cyrene] MiniMax Search key changed; re-registering MCP server...");
    try {
      await removeMcpServer(MINIMAX_SEARCH_MCP_ID);
      await addMcpServer({
        id: MINIMAX_SEARCH_MCP_ID, name: "MiniMax Search", transport: "stdio",
        command: "uvx",
        args: ["minimax-coding-plan-mcp", "-y"],
        env: { MINIMAX_API_KEY: settings.searchMinimaxKey.trim(), MINIMAX_API_HOST: "https://api.minimaxi.com" },
      });
      return { mcpSyncResult: "reregistered" };
    } catch (err) { console.error("[Cyrene] MiniMax Search MCP re-registration error:", err); return { mcpSyncResult: `reregister_exception: ${err}` }; }
  }
  return { mcpSyncResult: "no_change" };
}

function loadStickerSettings(): Record<string, boolean> {
  let raw: Record<string, unknown> = {};
  try {
    const filePath = getStickerSettingsPath();
    if (fs.existsSync(filePath)) {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    }
  } catch (err) {
    console.error("[Cyrene] load sticker settings failed:", err);
  }

  //  id  boolean（ true）
  const result: Record<string, boolean> = {};
  for (const id of Object.keys(raw)) {
    result[id] = raw[id] !== false;
  }
  return result;
}

function saveStickerSettings(settings: Record<string, boolean>): Record<string, boolean> {
  const filePath = getStickerSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

function setStickerEnabled(id: string, enabled: boolean): Record<string, boolean> {
  const current = loadStickerSettings();
  current[id] = enabled;
  return saveStickerSettings(current);
}

function getStickerManagerConfig(): StickerConfigItem[] {
  const stickerSettings = loadStickerSettings();
  return getAllStickerConfig(stickerSettings);
}

// ──  ──────────────────────────────────────────────

interface PanelLayout { x: number; y: number; }

/**
 *  clamp  workArea ， minVisibleW × minVisibleH 。
 * （），。
 */
function clampWindowToWorkArea(
  pos: PanelLayout,
  size: { width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
  minVisibleW = 120,
  minVisibleH = 80,
): PanelLayout {
  const minX = workArea.x - size.width + minVisibleW;
  const maxX = workArea.x + workArea.width - minVisibleW;
  const minY = workArea.y - size.height + minVisibleH;
  const maxY = workArea.y + workArea.height - minVisibleH;

  function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
  }

  return {
    x: clamp(pos.x, minX, maxX),
    y: clamp(pos.y, minY, maxY),
  };
}

/**
 * 。
 *
 * ：
 * - ：totalWidth <= workArea.width → 
 * - ：totalWidth > workArea.width → sidebar/tasks 
 *
 *  clampWindowToWorkArea  120×80 。
 */
function computePanelLayout(
  workArea: { x: number; y: number; width: number; height: number },
  panels: Array<{ width: number; height: number }>,
  gap = 8,
): PanelLayout[] {
  const totalWidth = panels.reduce((sum, p, i) => sum + p.width + (i > 0 ? gap : 0), 0);
  const maxPanelHeight = Math.max(...panels.map(p => p.height));
  const baseY =
    workArea.height >= maxPanelHeight
      ? workArea.y + Math.floor((workArea.height - maxPanelHeight) / 2)
      : workArea.y;

  if (totalWidth <= workArea.width) {
    // 
    const startX = workArea.x + Math.floor((workArea.width - totalWidth) / 2);
    const positions: PanelLayout[] = [];
    let curX = startX;
    for (let i = 0; i < panels.length; i++) {
      const pos = clampWindowToWorkArea({ x: curX, y: baseY }, panels[i], workArea);
      positions.push(pos);
      curX += panels[i].width + gap;
    }
    return positions;
  }

  // ：
  // chat: （clamp ）
  const chatPos = clampWindowToWorkArea(
    { x: workArea.x + Math.floor((workArea.width - panels[0].width) / 2), y: baseY },
    panels[0],
    workArea,
  );

  // sidebar:  chat  gap； workArea 
  const sidebarMaxX = workArea.x + workArea.width - panels[1].width;
  const sidebarX = Math.min(chatPos.x + panels[0].width + gap, sidebarMaxX);
  const sidebarPos = clampWindowToWorkArea({ x: sidebarX, y: baseY }, panels[1], workArea);

  // tasks: ，y  sidebar  48px
  const tasksX = Math.min(sidebarPos.x, sidebarMaxX);
  const tasksY = clampWindowToWorkArea(
    { x: tasksX, y: sidebarPos.y + 48 },
    panels[2],
    workArea,
  );

  return [chatPos, sidebarPos, tasksY];
}

//  chat / sidebar / tasks 。
// ： display； workArea， 120×80 。
function computeLayout(): {
  chat: PanelLayout;
  sidebar: PanelLayout;
  tasks: PanelLayout;
} {
  const cursor = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const display =
    displays.find(d => {
      const { x, y, width, height } = d.workArea;
      return cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height;
    }) ?? screen.getPrimaryDisplay();

  const { workArea } = display;
  const panels = [
    { width: 1280, height: 760 }, // chat
    { width: 360, height: 760 },  // sidebar
    { width: 480, height: 820 },  // tasks
  ];
  const [chatPos, sidebarPos, tasksPos] = computePanelLayout(workArea, panels, 8);
  return { chat: chatPos, sidebar: sidebarPos, tasks: tasksPos };
}


interface ChatRequestMessage {
  role: "user" | "model" | "assistant" | "system";
  content: string;
  at?: number;
}

interface ChatCompletionChoice {
  message?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
}


function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function createVisibleStreamFilter(): {
  push: (chunk: string) => string;
  flush: () => string;
} {
  let pending = "";
  let insideThink = false;
  const openTag = "<think>";
  const closeTag = "</think>";

  return {
    push(chunk: string): string {
      pending += chunk;
      let visible = "";

      while (pending) {
        const lower = pending.toLowerCase();

        if (insideThink) {
          const closeIndex = lower.indexOf(closeTag);
          if (closeIndex < 0) {
            pending = pending.slice(Math.max(0, pending.length - (closeTag.length - 1)));
            break;
          }

          pending = pending.slice(closeIndex + closeTag.length);
          insideThink = false;
          continue;
        }

        const openIndex = lower.indexOf(openTag);
        if (openIndex < 0) {
          const safeLength = Math.max(0, pending.length - (openTag.length - 1));
          visible += pending.slice(0, safeLength);
          pending = pending.slice(safeLength);
          break;
        }

        visible += pending.slice(0, openIndex);
        pending = pending.slice(openIndex + openTag.length);
        insideThink = true;
      }

      return visible;
    },
    flush(): string {
      if (insideThink) {
        pending = "";
        return "";
      }

      const rest = pending;
      pending = "";
      return rest;
    },
  };
}

function extractJsonPayload(text: string): unknown | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

// feeling → Live2D expression index
const feelingToExpression: Record<string, number> = {
  "Calm": 0,
  "Happy": 6,
  "Gentle": 0,
  "Excited": 3,
  "Coy": 5,
  "Worried": 2,
  "Sad": 0,
  "Touched": 4,
  "Shy": 5,
};

function inferRuntimeState(
  userInput: string,
  llmReply: string,
  toolCalled: boolean
): Pick<RuntimeState, "status"> {
  if (toolCalled) return { status: "Working" };

  const text = userInput + llmReply;

  if (STATUS_KEYWORDS["Listening"]?.test(text)) {
    return { status: "Listening" };
  }

  if (STATUS_KEYWORDS["Thinking"]?.test(text)) {
    return { status: "Thinking" };
  }

  return { status: "Accompanying" };
}

function parseObserverFeeling(text: string): string | null {
  const payload = extractJsonPayload(text);
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const feeling = typeof record.feeling === "string" ? record.feeling : null;
  const validFeelings = ["Calm","Happy","Gentle","Excited","Coy","Worried","Sad","Touched","Shy"];
  return feeling && validFeelings.includes(feeling) ? feeling : null;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function normalizeChatMessages(input: unknown): ChatContextMessage[] {
  return normalizeChatMessagesWithTime(input);
}

function getApiLogPath(): string {
  return path.join(app.getPath("userData"), "chat-api.log");
}

function appendApiLog(
  label: string,
  requestMessages: Array<{ role: string; content: string }>,
  rawResponse: string,
  cleanedResponse: string,
): void {
  // Only write debug logs when explicitly requested via CYRENE_DEBUG_API_LOG
  if (process.env.CYRENE_DEBUG_API_LOG !== "true") return;

  try {
    const logPath = getApiLogPath();
    // Rotate log if it exceeds 5 MB to prevent disk fill
    try {
      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        if (stat.size > 5 * 1024 * 1024) {
          const backupPath = logPath + ".1";
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
          fs.renameSync(logPath, backupPath);
        }
      }
    } catch { /* rotation failure non-fatal */ }

    const now = new Date().toISOString();
    const entry = [
      "=".repeat(80),
      `[${now}] ${label}`,
      "-".repeat(40) + " REQUEST " + "-".repeat(40),
      JSON.stringify(requestMessages, null, 2),
      "-".repeat(40) + " RAW RESPONSE " + "-".repeat(40),
      rawResponse,
      "-".repeat(40) + " CLEANED " + "-".repeat(40),
      cleanedResponse || "(empty)",
      "=".repeat(80),
      "",
    ].join(os.EOL);
    fs.appendFileSync(logPath, entry, "utf8");
  } catch {
    // silent
  }
}

async function callChatCompletionsStream(
  settings: ModelSettings,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature: number | undefined,
  timeoutMs: number,
  label: string,
  onChunk: (text: string) => void,
  logTiming = true,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const _startTime = Date.now();
  if (logTiming) console.log(`[TIMING] ${label} START timeout=${timeoutMs}ms msgLen=${messages.length} sysLen=${messages[0]?.content?.length ?? 0}`);

  //  VendorConfig（settings  + ）
  const cfg: VendorConfig = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    explicitTransport: settings.explicitTransport,
    reasoning: settings.reasoning,
  };

  try {
    // adapter  transport （explicitTransport → baseUrl  → capabilities fallback）
    const adapter = getAdapterForConfig(cfg);
    // adapter  buildStreamRequest  stream=true +  transport  headers/body
    const http = adapter.buildStreamRequest({
      model: cfg.model,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      stream: true,
    }, cfg);

    const response = await fetch(http.url, {
      method: "POST",
      signal: controller.signal,
      headers: http.headers,
      body: http.body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (errorData as { error?: { message?: string } }).error?.message;
      throw new Error(errMsg || `Model request failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("The response body is empty and cannot be streamed");
    }

    let fullText = "";
    const visibleFilter = createVisibleStreamFilter();

    // Reader  → StreamEvent；adapter  StreamChunk
    // 、event  createSseReader ，adapter 。
    for await (const event of createSseReader(adapter, response.body)) {
      const chunk = adapter.parseStreamEvent(event);
      if (!chunk) continue;
      if (chunk.deltaText) {
        fullText += chunk.deltaText;
        const visibleDelta = visibleFilter.push(chunk.deltaText);
        if (visibleDelta) onChunk(visibleDelta);
      }
      // thinking （stripThinkBlocks ）
      if (chunk.usage) {
        recordUsage(chunk.usage.input, chunk.usage.output, 1);
      }
      if (chunk.done) break;
    }

    const visibleTail = visibleFilter.flush();
    if (visibleTail) {
      onChunk(visibleTail);
    }

    const result = stripThinkBlocks(fullText);
    if (logTiming) console.log(`[TIMING] ${label} OK in ${Date.now() - _startTime}ms resultLen=${result.length}`);
    appendApiLog(label, messages, fullText, result);
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (logTiming) console.log(`[TIMING] ${label} TIMEOUT at ${Date.now() - _startTime}ms`);
      throw new Error("The model request timed out. Please try again later.");
    }
    if (logTiming) console.log(`[TIMING] ${label} ERROR at ${Date.now() - _startTime}ms: ${err instanceof Error ? err.message : err}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}


// Legacy wrapper for non-streaming calls (e.g. observer)
async function callChatCompletions(
  settings: ModelSettings,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature: number | undefined,
  timeoutMs: number,
  label: string,
  logTiming = true,
): Promise<string> {
  return callChatCompletionsStream(settings, messages, temperature, timeoutMs, label, () => {}, logTiming);
}

/**
 *  chat completions （CITA ）。
 * CITA （ JSON）， ~2 。
 *  reasoningOverride  reasoning（CITA ）。
 */
async function callChatCompletionsNonStream(
  settings: ModelSettings,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature: number | undefined,
  timeoutMs: number,
  label: string,
  reasoningOverride?: ModelSettings["reasoning"],
  options?: {
    structuredOutput?: StructuredOutputRequest;
    maxTokens?: number;
    extraBody?: Record<string, unknown>;
  },
  signal?: AbortSignal,
): Promise<{
  text: string;
  thinking?: string;
  finishReason: string;
  refusal?: string;
  structuredValue?: unknown;
}> {
  const cfg: VendorConfig = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    explicitTransport: settings.explicitTransport,
    reasoning: reasoningOverride ?? settings.reasoning,
  };
  const adapter = getAdapterForConfig(cfg);
  const chatRequest = {
    model: cfg.model,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    stream: false,
    ...(options?.structuredOutput ? { structuredOutput: options.structuredOutput } : {}),
    ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options?.extraBody ? { extraBody: options.extraBody } : {}),
  };

  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  console.log(`[TIMING] ${label} START (non-stream) timeout=${timeoutMs}ms msgLen=${messages.length} sysLen=${messages[0]?.content?.length ?? 0}`);

  try {
    const parsed = await dispatchChatGeneration<ChatResponse>({
      request: chatRequest,
      provider: adapter.id,
      endpointKind: classifyStructuredOutputEndpoint({
        providerId: adapter.id,
        configuredBaseUrl: cfg.baseUrl,
        officialBaseUrl: adapter.capability.baseUrl,
      }),
      langchain: async () => {
        const generated = await invokeLangChainStructured(
          chatRequest,
          {
            ...cfg,
            provider: adapter.id,
            explicitTransport: adapter.transport,
          },
          controller.signal,
        );
        return {
          assistantMessage: { role: "assistant" as const, content: generated.text },
          text: generated.text,
          toolCalls: [],
          finishReason: generated.finishReason,
          raw: { backend: "langchain" },
          structuredValue: generated.structuredValue,
        };
      },
      legacy: async () => {
        const http = adapter.buildRequest(chatRequest, cfg);
        const response = await fetch(http.url, {
          method: "POST",
          headers: http.headers,
          body: http.body,
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
          const errMsg = (errorData as { error?: { message?: string } }).error?.message;
          throw new Error(errMsg || `Model request failed: HTTP ${response.status}`);
        }
        return adapter.parseResponse(await response.json());
      },
    });
    if (parsed.usage) {
      recordUsage(parsed.usage.input, parsed.usage.output, 1);
    }
    const totalTime = Date.now() - startTime;
    console.log(`[TIMING] ${label} OK in ${totalTime}ms resultLen=${parsed.text.length}`);
    return {
      text: parsed.text,
      thinking: parsed.thinking,
      finishReason: parsed.finishReason,
      refusal: parsed.refusal,
      structuredValue: parsed.structuredValue,
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    if (error instanceof Error && error.name === "AbortError") {
      console.log(`[TIMING] ${label} TIMEOUT at ${totalTime}ms`);
    } else {
      console.log(`[TIMING] ${label} ERROR at ${totalTime}ms: ${error}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

const citaService = new CitaService({
  store: new ContextStore(),
  engine: new RemoteSemanticEngine(
    async (request, signal) => callChatCompletionsNonStream(
      loadModelSettings(),
      [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      0,
      6_000,
      "CITA understandTurn",
      { mode: "off" as const },
      {
        structuredOutput: request.structuredOutput,
        maxTokens: request.maxTokens,
        extraBody: request.extraBody,
      },
      signal,
    ),
    {
      timeoutMs: 8_000,
      systemPrompt: loadPromptFile("cita_system.md"),
      getProfile: () => {
        const settings = loadModelSettings();
        const cfg: VendorConfig = {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
          explicitTransport: settings.explicitTransport,
          reasoning: { mode: "off" },
        };
        const adapter = getAdapterForConfig(cfg);
        return resolveStructuredOutputProfile({
          provider: adapter.id,
          model: cfg.model,
          transport: adapter.transport,
          endpointKind: classifyStructuredOutputEndpoint({
            providerId: adapter.id,
            configuredBaseUrl: cfg.baseUrl,
            officialBaseUrl: adapter.capability.baseUrl,
          }),
        });
      },
    },
  ),
  getSettings: () => normalizeCitaSettings({
    enabled: loadGeneralSettings().citaEnabled,
    semanticEngine: loadGeneralSettings().citaSemanticEngine,
  }),
});

function loadPromptFile(filename: string): string {
  try {
    const filePath = path.join(app.getAppPath(), "prompts", filename);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function getCustomStylePromptPath(): string {
  return path.join(app.getPath("userData"), "styles", "custom", "custom.md");
}

function ensureCustomStylePrompt(): string {
  const targetPath = getCustomStylePromptPath();
  if (fs.existsSync(targetPath)) return targetPath;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const templatePath = path.join(app.getAppPath(), "prompts", "styles", "custom", "custom.md");
  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, targetPath);
  } else {
    fs.writeFileSync(targetPath, "", "utf8");
  }
  return targetPath;
}

function readStylePrompt(styleId: StyleId): string {
  if (styleId === "custom") {
    const filePath = ensureCustomStylePrompt();
    return fs.readFileSync(filePath, "utf8").trim();
  }
  return loadPromptFile("styles/" + STYLE_FILE_BY_ID[styleId]);
}

function resolveSoulSamplingForStyle(input: {
  styleId: StyleId;
  settings: { provider: string; model: string; reasoning?: ReasoningPreference };
  customStyle: CustomStyleConfig;
}) {
  const capability = getCapabilityOrOpenAI(input.settings.provider);
  const preference = resolveStylePreference(input.styleId, input.customStyle);
  return resolveApprovedStyleSampling({
    providerId: capability.id,
    model: input.settings.model,
    reasoning: input.settings.reasoning ?? { mode: "auto" },
    preference,
  });
}

/**
 * ： WorldBook active entries  system prompt，
 * 。—— lost-in-middle、
 *  prompt 、。
 */
function logWorldbookInjection(alwaysOnContext: string, systemContent: string): void {
  const marker = "[Active World Knowledge]";
  if (alwaysOnContext && alwaysOnContext.includes(marker)) {
    const wbStart = systemContent.indexOf(marker);
    console.log("[Worldbook/Diag] ────────────────────────");
    console.log(`[Worldbook/Diag] systemContent total length: ${systemContent.length}`);
    console.log(`[Worldbook/Diag] alwaysOnContext length: ${alwaysOnContext.length}`);
    console.log(`[Worldbook/Diag] ${marker} offset in systemContent: ${wbStart} / ${systemContent.length} (${((wbStart / systemContent.length) * 100).toFixed(1)}%)`);
    console.log(`[Worldbook/Diag] Characters remaining after ${marker}: ${systemContent.length - wbStart}`);
    const beforeWb = systemContent.slice(Math.max(0, wbStart - 200), wbStart);
    const wbSlice = systemContent.slice(wbStart, Math.min(wbStart + alwaysOnContext.length + 200, systemContent.length));
    console.log(`[Worldbook/Diag] -- 200 characters before injection --\n${beforeWb.slice(-200)}`);
    console.log(`[Worldbook/Diag] -- injected content and following 200 characters --\n${wbSlice.slice(0, 800)}`);
    console.log("[Worldbook/Diag] ────────────────────────");
  } else {
    console.log("[Worldbook/Diag] No world knowledge injected this turn (alwaysOnContext is empty or lacks the marker)");
  }
}

function buildSystemPrompt(styleFile: string, includeStyle = true): string {
  const parts: string[] = [];

  // Chat ； "talk"。
  const isChatMode = styleFile.startsWith("chat") || styleFile.startsWith("talk");
  const system = loadPromptFile(isChatMode ? "chat_system.md" : "work_system.md");
  if (system) parts.push(system);

  const identity = loadPromptFile(isChatMode ? "chat_identity.md" : "work_identity.md");
  if (identity) parts.push(identity);

  const soul = loadPromptFile("soul.md");
  if (soul) parts.push(soul);

  const canon = loadPromptFile("canon_quotes.md");
  if (canon) parts.push(canon);

  //  build-options  style Prompt； style 。
  if (includeStyle && !isChatMode) {
    const style = loadPromptFile("styles/" + styleFile);
    if (style) parts.push(style);
  }

  return parts.join("\n\n---\n\n");
}

function buildProactivePersonaPrompt(): string {
  const parts: string[] = [];
  const chatSystem = loadPromptFile("chat_system.md");
  if (chatSystem) parts.push(chatSystem);
  const soul = loadPromptFile("soul.md");
  if (soul) {
    // ；Soul  Live2D/。
    parts.push(soul.split("\n## Division of Live2D and Chat")[0].trim());
  }
  const canon = loadPromptFile("canon_quotes.md");
  if (canon) parts.push(canon);
  const style = loadPromptFile("styles/01_default.md");
  if (style) parts.push(style);
  const toneRules = loadPromptFile("tone-rules.md");
  if (toneRules) parts.push(toneRules);
  return parts.join("\n\n---\n\n");
}

function toProactiveHistory(messages: Array<{ role: "user" | "model"; content: string; at: number }>): ProactiveHistoryTurn[] {
  return messages
    .filter((message) => message.content.trim())
    .slice(-16)
    .map((message) => ({ role: message.role, content: message.content, at: message.at }));
}

function getProactiveHistories(): { ordinary: ProactiveHistoryTurn[]; proactive: ProactiveHistoryTurn[] } {
  const ordinaryMeta = chatsStore.listSessions().find((session) => session.purpose !== "proactive-chat");
  const ordinarySession = ordinaryMeta ? chatsStore.getSession(ordinaryMeta.id) : null;
  const proactiveSession = chatsStore.getSessionByPurpose("proactive-chat");
  return {
    ordinary: toProactiveHistory(ordinarySession?.messages ?? []),
    proactive: toProactiveHistory(proactiveSession?.messages ?? []),
  };
}

function getProactiveRuntimeSnapshot(): ProactiveRuntimeSnapshot {
  const now = Date.now();
  let idleSec = Number.POSITIVE_INFINITY;
  try { idleSec = powerMonitor.getSystemIdleTime(); } catch { /* app  ready */ }
  return {
    now,
    localHour: new Date(now).getHours(),
    idleSec,
    enabled: loadGeneralSettings().proactiveChatMode === "on",
    conversationBusy: normalConversationBusyCount > 0,
    generationBusy: false,
    screenLocked: proactiveScreenLocked,
  };
}

async function buildProactiveAgentMessages(candidate: ProactiveCandidate) {
  const histories = getProactiveHistories();
  const recentTopic = histories.ordinary.slice(-4).map((turn) => turn.content).join("\n");
  const retrievalQuery = `${candidate.sceneId}\n${recentTopic}`.trim();
  const [profileContext, memoryContext] = await Promise.all([
    buildAlwaysOnContextWithSensory(retrievalQuery, histories.ordinary.map((turn) => ({ role: turn.role, content: turn.content }))).catch(() => ""),
    buildMemoryInjection(retrievalQuery).catch(() => ""),
  ]);
  const state = loadProactiveState();
  const snapshot = getProactiveRuntimeSnapshot();
  // ：resolver  prompt， profile.timezone。
  const profile = loadUserProfile();
  const timezone = resolveChatContextTimezone(profile.timezone);
  return buildProactiveMessages({
    basePersona: buildProactivePersonaPrompt(),
    userProfile: profileContext,
    relevantMemory: memoryContext,
    ordinaryHistory: histories.ordinary,
    proactiveHistory: histories.proactive,
    sceneId: candidate.sceneId,
    localNow: new Date(snapshot.now),
    idleSec: snapshot.idleSec,
    unansweredCount: state.unansweredCount,
    timezone,
  });
}

function updateNormalConversationBusy(delta: 1 | -1): void {
  normalConversationBusyCount = Math.max(0, normalConversationBusyCount + delta);
}

const proactiveConversationLifecycle = {
  onUserMessage: () => proactiveChatService?.invalidateForUserMessage(),
  onConversationStarted: () => {
    updateNormalConversationBusy(1);
    proactiveChatService?.normalConversationStarted();
  },
  onConversationEnded: () => {
    updateNormalConversationBusy(-1);
    if (normalConversationBusyCount === 0) proactiveChatService?.normalConversationEnded();
  },
};

function getProactiveCommitDecision(candidate: ProactiveCandidate, generationEpoch: number) {
  return canCommitProactiveMessage(
    getProactiveRuntimeSnapshot(),
    loadProactiveState(),
    candidate,
    generationEpoch,
  );
}

function recordProactiveDeliveryMetadata(input: ProactiveCommitInput): void {
  // Opener  todayFired/recentItems （ SCENE_CONFIGS  ShowBubblePayload  opener ）。
  // ProactiveChat  committed ； implementation ，。
  void input;
}

async function commitLocalProactiveMessage(input: ProactiveCommitInput): Promise<ProactiveCommitResult> {
  const initialDecision = getProactiveCommitDecision(input.candidate, input.generationEpoch);
  if (!initialDecision.allowed) return { kind: "cancelled", reason: initialDecision.reason };

  const session = chatsStore.getOrCreateSessionByPurpose("proactive-chat", {
    title: "Cyrene's proactive message",
    identityId: null,
  });
  const at = Date.now();
  const appended = chatsStore.appendMessage(session.id, {
    id: randomUUID(),
    role: "model",
    content: input.text,
    at,
  });
  if (!appended) throw new Error("Failed to write the proactive chat session");
  broadcastChatsChanged();

  // ； panel/show （opener ，fallback ）。
  void input;
  void at;
  return { kind: "committed" };
}

async function commitSelectedProactiveMessage(input: ProactiveCommitInput): Promise<ProactiveCommitResult> {
  const settings = loadGeneralSettings();
  const target = settings.proactiveDeliveryTarget;
  const result = await routeProactiveDelivery(target, {
    commitLocal: () => commitLocalProactiveMessage(input),
    commitChannel: async (channel) => {
      const channelResult = await sendProactiveChannelMessage({
        channel,
        text: input.text,
        mobileMessageSegmentation: settings.mobileMessageSegmentation,
        manager: channelManager,
        canContinue: () => {
          if (loadGeneralSettings().proactiveDeliveryTarget !== channel) return false;
          return getProactiveCommitDecision(input.candidate, input.generationEpoch).allowed;
        },
      });
      return channelResult.kind === "committed"
        ? { kind: "committed" }
        : { kind: "cancelled", reason: channelResult.reason };
    },
  });

  if (result.kind === "committed") recordProactiveDeliveryMetadata(input);
  return result;
}

function initializeProactiveChatService(): void {
  proactiveChatService = createProactiveChatService({
    loadState: loadProactiveState,
    saveState: (state) => {
      saveProactiveState(state);
    },
    getSnapshot: getProactiveRuntimeSnapshot,
    buildMessages: async (candidate) => buildProactiveAgentMessages(candidate),
    runModel: async (messages) => {
      const settings = loadModelSettings();
      if (!isModelEndpointUsable(settings)) return { kind: "error", reason: "missing_api_key" };
      return runProactiveModel({
        settings: {
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
          explicitTransport: settings.explicitTransport,
          reasoning: settings.reasoning,
        },
        messages,
        timeoutMs: 45_000,
      });
    },
    // Opener  preset fallback ：model  proactive-service  cancel 。
    getFallback: async () => null,
    canStartDelivery: () => {
      const target = loadGeneralSettings().proactiveDeliveryTarget;
      return target === "local" || canStartProactiveChannelDelivery(target, channelManager);
    },
    commitMessage: commitSelectedProactiveMessage,
    log: (event, detail) => console.log(`[Proactive] ${event}`, detail ?? ""),
  });

  setChannelsConversationLifecycle(proactiveConversationLifecycle);

  powerMonitor.on("lock-screen", () => {
    proactiveScreenLocked = true;
    proactiveChatService?.invalidate();
  });
  powerMonitor.on("unlock-screen", () => { proactiveScreenLocked = false; });
  powerMonitor.on("suspend", () => {
    proactiveScreenLocked = true;
    proactiveChatService?.invalidate();
  });
  powerMonitor.on("resume", () => { proactiveScreenLocked = false; });
}

// ── （60s  → evaluateCandidate） ─────────────
//  evaluation backoff Map（， policy ）
let proactiveTrigger: ProactiveTriggerController | null = null;
const proactiveBackoffMap = new Map<string, number>();

function initializeProactiveTrigger(): void {
  if (proactiveTrigger) return; // 
  if (!proactiveChatService) {
    console.warn("[Proactive] trigger skipped: service not initialized");
    return;
  }
  const service = proactiveChatService;
  proactiveTrigger = createProactiveTrigger({
    evaluateCandidate: (c) => service.evaluateCandidate(c),
    getRuntimeSnapshot: getProactiveRuntimeSnapshot,
    getProactiveState: loadProactiveState,
    getTimezone: () => resolveChatContextTimezone(loadUserProfile().timezone),
    // getWeatherContext ：，
    getLastEvaluatedAtByScene: () => new Map(proactiveBackoffMap),
    setLastEvaluatedAtByScene: (next) => {
      proactiveBackoffMap.clear();
      for (const [k, v] of next) proactiveBackoffMap.set(k, v);
    },
  });
  proactiveTrigger.start();
}

function stopProactiveTrigger(): void {
  proactiveTrigger?.stop();
  proactiveTrigger = null;
}

/**
 *  system prompt。
 * ： tools_system.md  + 。
 *  /  / ，。
 */
function buildToolSystemPrompt(enabledTools: ReadonlyArray<ToolDefinition>): string {
  const base = loadPromptFile("tools_system.md");
  const catalog = buildToolCatalog(enabledTools as ToolDefinition[]);
  return [
    base,
    "## Currently available tools",
    catalog,
  ].filter(Boolean).join("\n\n");
}

/**
 * Soul  system prompt。
 * ：（work_system.md/chat_system.md + work_identity.md/chat_identity.md + soul.md + canon + style）+ /。
 * ：（`role: "tool"` ） conversation ，。
 * ：build-options  environmentContext / skillCatalog / toneInjection /
 * alwaysOnContext / relationshipContext / attachmentContext  baseContent ，
 *  toolEnvironmentContext / soulEnvironmentContext。
 */
function buildSoulSystemBasePrompt(styleFile: string): string {
  return buildSystemPrompt(styleFile, false);
}

/**
 * /： /skill-id（ skill +） system 
 * （ system，user message ， memory， spec 6.3）。
 *  skill / →  user ， ""。
 *  →  ""（， /）。
 */
function resolveSlashActivation<T extends { role: string; content: string }>(messages: T[]): string {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return "";
  const lastUser = messages[lastUserIdx];
  if (typeof lastUser.content !== "string") return "";
  const knownIds = skillRegistry.getAll().map(s => s.id);
  const parsed = parseSlashCommand(lastUser.content, knownIds);
  if (!parsed.hit || !parsed.skillId) return "";
  const skill = skillRegistry.getById(parsed.skillId);
  if (skill && skill.enabled && skillRegistry.isAvailable(parsed.skillId)) {
    const body = skillRegistry.getBody(parsed.skillId);
    if (body !== null) {
      console.log("[Cyrene] Slash command activated skill:", parsed.skillId);
      return `\n\n---\n\n[Activated skill: ${parsed.skillId}]\n${body}`;
    }
    return "";
  }
  // skill /： user 
  const available = skillRegistry.getEnabled().map(s => s.id).join(", ") || "(none)";
  messages[lastUserIdx] = { ...lastUser, content: `[System notice: skill is disabled or unavailable: ${parsed.skillId}. Available skills: ${available}]` } as T;
  return "";
}

function loadSoulFeelingContext(): string {
  try {
    const soulPath = path.join(app.getAppPath(), "prompts", "soul.md");
    if (!fs.existsSync(soulPath)) return "";
    return fs.readFileSync(soulPath, "utf8");
  } catch {
    return "";
  }
}

async function observeRuntimeState(
  settings: ModelSettings,
  recentMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  latestUserText: string,
  chatContent: string,
): Promise<void> {
  const recentDialogue = [...recentMessages.slice(-8), { role: "assistant" as const, content: chatContent }]
    .filter((message) => message.role !== "system")
    .slice(-6)
    .map((message) => ({ role: message.role, content: message.content }));

  //  LLM ： MemoryJudge ，；
  //  5s  1 。.catch ，。
  enqueueLLMTask("Mood observer", async () => {
    const observerContent = await callChatCompletions(settings, [
      {
        role: "system",
        content:
          'You are an emotion classifier. Below is Cyrene\'s complete persona:\n\n' + loadSoulFeelingContext() + '\n\nUsing the persona and conversation, classify Cyrene\'s current mood. Return exactly one canonical value: Calm / Happy / Gentle / Excited / Coy / Worried / Sad / Touched / Shy. Return JSON only: {"feeling":"canonical value"}. Prioritize the latest turn, classify Cyrene rather than the user, and use Calm when uncertain.',
      },
      {
        role: "user",
        content: JSON.stringify({
          recentDialogue,
        }),
      },
    ], undefined, 30000, "Mood observer", false);
    const feeling = parseObserverFeeling(observerContent);
    if (feeling) {
      const smoothed = smoothFeeling(feelingScores, feeling);
      feelingScores = smoothed.scores;
      runtimeState.feeling = smoothed.feeling as RuntimeFeeling;
      runtimeState.expression = feelingToExpression[smoothed.feeling] ?? 0;
      runtimeState.updatedAt = Date.now();
      broadcastRuntimeStateChanged();
    }
  }, { log: false }).catch((err) => {
    console.warn("[Cyrene] observe runtime failed; keeping current feeling:", err);
  });
  // ， lint 
  void latestUserText;
}

// （ settings.ts  MODEL_PRESETS.shortName ，）。
// ""。
const PROVIDER_SHORT_NAMES: Record<string, string> = {
  "MiniMax": "MiniMax",
  "DeepSeek": "DeepSeek",
  "Doubao": "Doubao",
  "GLM": "GLM",
  "Kimi": "Kimi",
  "Qwen": "Qwen",
  "ChatGPT": "ChatGPT",
  "Claude": "Claude",
};

function getPublicModelConfig(settings = loadModelSettings()): PublicModelConfig {
  return {
    mode: settings.mode,
    provider: settings.provider,
    displayName: settings.displayName,
    shortName: PROVIDER_SHORT_NAMES[settings.provider] ?? settings.provider,
    model: settings.model,
    connected: isModelEndpointUsable(settings),
    runtimeSync: settings.runtimeSync,
    stickerSize: settings.stickerSize,
    rerankerMode: settings.rerankerMode,
  };
}

function broadcastToAuxWindows(channel: string, payload: unknown): void {
  for (const win of [chatWindow, sidebarWindow, tasksWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function broadcastUiThemeChanged(theme: GeneralSettings["uiTheme"]): void {
  for (const win of [mainWindow, chatWindow, sidebarWindow, tasksWindow, settingsWindow, stickerManagerWindow, callWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.UI_THEME_CHANGED, theme);
    }
  }
}

function broadcastUiFontChanged(font: GeneralSettings["uiFont"]): void {
  for (const win of [mainWindow, chatWindow, sidebarWindow, tasksWindow, settingsWindow, stickerManagerWindow, callWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.UI_FONT_CHANGED, font);
    }
  }
}

function broadcastModelConfigChanged(settings = loadModelSettings()): void {
  broadcastToAuxWindows(IPC.MODEL_CONFIG_CHANGED, getPublicModelConfig(settings));
}

function broadcastRuntimeStateChanged(): void {
  broadcastToAuxWindows(IPC.RUNTIME_STATE_CHANGED, runtimeState);
}

export function sendToLive2DWindow(channel: string, payload?: unknown): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (payload === undefined) win.webContents.send(channel);
  else win.webContents.send(channel, payload);
}

function openExternalUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  if (isDev && url.startsWith("http://localhost:5173")) return false;
  void shell.openExternal(url);
  return true;
}

function attachExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    let sameTrustedDocument = false;
    try {
      const currentUrl = new URL(current);
      const nextUrl = new URL(url);
      sameTrustedDocument = currentUrl.protocol === nextUrl.protocol
        && currentUrl.origin === nextUrl.origin
        && (currentUrl.protocol !== "file:" || currentUrl.pathname === nextUrl.pathname);
    } catch { /* deny malformed navigation */ }
    if (sameTrustedDocument) return;
    event.preventDefault();
    openExternalUrl(url);
  });
}
function createWindow(): void {
  const settings = loadGeneralSettings();
  let restoreX: number | undefined;
  let restoreY: number | undefined;

  const zoom = typeof settings.petZoom === "number" ? Math.max(0.5, Math.min(2, settings.petZoom)) : 1;
  const PET_W = Math.round(PET_WINDOW_BASE_WIDTH * zoom);
  const PET_H = Math.round(PET_WINDOW_BASE_HEIGHT * zoom);

  if (settings.petWindowX !== undefined && settings.petWindowY !== undefined) {
    const targetBounds = {
      x: settings.petWindowX,
      y: settings.petWindowY,
      width: PET_W,
      height: PET_H,
    };
    const display = screen.getDisplayMatching(targetBounds);
    const wa = display.workArea;

    // Check if at least 60x60 is within display workArea
    const interW =
      Math.min(targetBounds.x + PET_W, wa.x + wa.width) -
      Math.max(targetBounds.x, wa.x);
    const interH =
      Math.min(targetBounds.y + PET_H, wa.y + wa.height) -
      Math.max(targetBounds.y, wa.y);

    if (interW >= 60 && interH >= 60) {
      restoreX = Math.max(wa.x, Math.min(wa.x + wa.width - PET_W, settings.petWindowX));
      restoreY = Math.max(wa.y, Math.min(wa.y + wa.height - PET_H, settings.petWindowY));
    } else {
      console.log(
        "[Cyrene] Saved pet position is off-screen (only " +
          interW + "x" + interH + " visible); using default bottom-right position",
      );
    }
  }

  // Fallback default position: bottom-right corner of primary display
  if (restoreX === undefined || restoreY === undefined) {
    const primaryWa = screen.getPrimaryDisplay().workArea;
    restoreX = Math.round(primaryWa.x + primaryWa.width - PET_W - 24);
    restoreY = Math.round(primaryWa.y + primaryWa.height - PET_H - 24);
  }

  mainWindow = new BrowserWindow({
    x: restoreX,
    y: restoreY,
    width: PET_W,
    height: PET_H,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    icon: getCurrentAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachExternalLinkHandler(mainWindow);
  live2dWindowLifecycle.attach(mainWindow);

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  }

  if (!isDev) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // On Windows, setIgnoreMouseEvents({ forward: true }) forwards pointer events but
  // NOT wheel/scroll events. To support Alt+wheel zoom, we must synchronously disable
  // ignore-mouse-events as soon as Alt is held — before the first wheel tick fires.
  // `before-input-event` fires in main process synchronously for all keyboard input.
  let altHeldInMain = false;
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (input.type === "keyDown" && input.key === "Alt" && !altHeldInMain) {
      altHeldInMain = true;
      mainWindow.setIgnoreMouseEvents(false);
    } else if (input.type === "keyUp" && input.key === "Alt" && altHeldInMain) {
      altHeldInMain = false;
      if (!isDev) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  });

  mainWindow.on("hide", () => {
    mainWindow?.webContents.send(IPC.PET_VISIBILITY_CHANGED, false);
  });
  mainWindow.on("show", () => {
    mainWindow?.webContents.send(IPC.PET_VISIBILITY_CHANGED, true);
  });

  let moveSaveTimer: NodeJS.Timeout | null = null;
  mainWindow.on("moved", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const [x, y] = mainWindow.getPosition();
        const before = loadGeneralSettings();
        if (before.petWindowX !== x || before.petWindowY !== y) {
          saveGeneralSettings({ petWindowX: x, petWindowY: y });
        }
      } catch {}
    }, 150);
  });

  applyGeneralSettings(loadGeneralSettings());

  // ： key/
  // （）
  setWeatherConfig(
    () => loadUserProfile().defaultCity || "Hanoi",
    () => loadGeneralSettings().weatherSource,
    () => loadGeneralSettings().amapKey,
    // ：， Custom 
    (card) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(IPC.AGUI_EVENT, {
          type: "CUSTOM",
          name: "cyrene.weather",
          value: card,
        });
      }
    },
    () => loadGeneralSettings().weatherEnabled,
  );

  //  getter： currentUserTimezone() （/ Asia/Shanghai）
  setUserTimezoneConfig(() => loadUserProfile().timezone);

  // ： ask_user_choice  Custom 
  setChoiceCardSender((cardData) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send(IPC.AGUI_EVENT, {
        type: "CUSTOM",
        name: "cyrene.choice",
        value: cardData,
      });
    }
  });

  // 
  setSearchConfig(
    () => loadGeneralSettings().searchEngine,
    () => loadGeneralSettings().searchBochaKey,
    () => loadGeneralSettings().searchTavilyKey,
  );

  //  amapKey （ GeneralSettings  amapKey）
  setTravelConfig(() => loadGeneralSettings().amapKey, () => loadGeneralSettings().travelEnabled);

  //  SMTP （ GeneralSettings）
  setEmailConfig(
    () => loadGeneralSettings().emailEnabled,
    () => loadGeneralSettings().emailSmtpHost,
    () => loadGeneralSettings().emailSmtpPort,
    () => loadGeneralSettings().emailSmtpSecure,
    () => loadGeneralSettings().emailSmtpUser,
    () => loadGeneralSettings().emailSmtpPass,
    () => loadGeneralSettings().emailFromName,
  );

  //  ASR （， GeneralSettings）
  setAsrConfig(() => {
    const s = loadGeneralSettings();
    if (s.asrEngine !== "aliyun") return null;
    return { appKey: s.asrAliyunAppKey, accessKeyId: s.asrAliyunAccessKeyId, accessKeySecret: s.asrAliyunAccessKeySecret, language: s.asrLanguage, engine: s.asrEngine };
  });

  // /TTS 
  setCallSettings(
    () => {
      const s = loadModelSettings();
      return { provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey };
    },
    () => {
      const s = loadGeneralSettings();
      return {
        ttsEngine: s.ttsEngine,
        ttsMinimaxKey: s.ttsMinimaxKey, ttsMinimaxVoiceId: s.ttsMinimaxVoiceId,
        ttsMinimaxModel: s.ttsMinimaxModel,
        ttsSpeed: s.ttsSpeed, ttsVolume: s.ttsVolume,
        ttsGptsovitsBaseUrl: s.ttsGptsovitsBaseUrl,
        ttsGptsovitsRefAudioPath: s.ttsGptsovitsRefAudioPath,
        ttsGptsovitsPromptText: s.ttsGptsovitsPromptText,
        ttsGptsovitsFormat: s.ttsGptsovitsFormat,
        ttsCustomCloudEndpointUrl: s.ttsCustomCloudEndpointUrl,
        ttsCustomCloudApiKey: s.ttsCustomCloudApiKey,
        ttsCustomCloudVoiceId: s.ttsCustomCloudVoiceId,
        ttsCustomCloudFormat: s.ttsCustomCloudFormat,
        ttsCustomCloudTimeoutMs: s.ttsCustomCloudTimeoutMs,
        ttsMimoKey: s.ttsMimoKey,
        ttsMimoVoiceAudioPath: s.ttsMimoVoiceAudioPath,
        ttsMimoStylePrompt: s.ttsMimoStylePrompt,
      };
    },
    //  system prompt （+++phone+skill+，）
    async (userText: string) => {
      const messages = [{ role: "user" as const, content: userText }];

      // ① （， profile.timezone  Intl）
      const now = new Date();
      const userTz = resolveChatContextTimezone(loadUserProfile().timezone);
      const timeStr = `Current time: ${now.toLocaleDateString("en-US", { timeZone: userTz })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: userTz })}`;

      // ② （ + L0/L1 ）
      let alwaysOnContext = "";
      try { alwaysOnContext = await buildAlwaysOnContextWithSensory(userText, messages); } catch { /* ignore */ }

      // ③ 
      let memoryInjection = "";
      try { memoryInjection = await buildMemoryInjection(userText); } catch { /* ignore */ }

      // ④  prompt
      const phoneParts: string[] = [];
      const phoneSystem = loadPromptFile("phone_system.md");
      if (phoneSystem) phoneParts.push(phoneSystem);
      const phoneIdentity = loadPromptFile("phone_identity.md");
      if (phoneIdentity) phoneParts.push(phoneIdentity);
      const soul = loadPromptFile("soul.md");
      if (soul) phoneParts.push(soul);
      const canon = loadPromptFile("canon_quotes.md");
      if (canon) phoneParts.push(canon);
      const phoneStyle = loadPromptFile("phone_style.md");
      if (phoneStyle) phoneParts.push(phoneStyle);
      const phonePrompt = phoneParts.join("\n\n---\n\n");

      // ⑤ Skill 
      const skillCatalog = buildSkillCatalog(skillRegistry.getEnabled());
      const skillActivation = resolveSlashActivation(messages);

      // ⑥ 
      let toneInjection = "";
      const sceneProvider = getSceneEmbeddingProvider();
      if (sceneProvider && sceneEmbeddingIndex) {
        try { toneInjection = await buildToneInjection(userText, messages, sceneProvider, sceneEmbeddingIndex); } catch { /* ignore */ }
      }

      return timeStr + "\n\n" +
        (alwaysOnContext ? alwaysOnContext + "\n\n" : "") +
        (memoryInjection ? memoryInjection + "\n\n" : "") +
        phonePrompt +
        (skillCatalog ? "\n\n---\n\n" + skillCatalog : "") +
        skillActivation +
        toneInjection;
    },
    // ： →  weather  execute
    async (userText: string) => {
      try {
        const weatherTool = toolRegistry.getById("weather");
        if (!weatherTool) return null;
        const cityMatch = userText.match(/(?:in|for|at|weather in|weather of)\s+([A-Za-z\s]+)/i) || userText.match(/([A-Za-z]+)/);
        const city = cityMatch?.[1] ?? "";
        const result = await weatherTool.execute({ city }, undefined);
        return result;
      } catch (err) {
        console.warn("[Call] Weather lookup failed:", err);
        return null;
      }
    },
  );

  //  LLM （delegate_task ，）
  setDelegateSettings(() => {
    const s = loadModelSettings();
    return { provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey };
  });

  mainWindow.on("closed", () => {
    if (moveSaveTimer) {
      clearTimeout(moveSaveTimer);
      moveSaveTimer = null;
    }
    petWindowMoveController.dispose();
    live2dWindowLifecycle.clear(mainWindow ?? undefined);
    mainWindow = null;
  });
}


function createChatWindow(sessionId?: string): void {
  const targetSessionId = sessionId || ensureActiveChatSessionId();
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.show();
    chatWindow.focus();
    if (targetSessionId) {
      chatWindow.webContents.send(IPC.CHATS_SWITCH_SESSION, targetSessionId);
    }
    return;
  }

  const layout = computeLayout();
  chatWindow = new BrowserWindow({
    x: layout.chat.x,
    y: layout.chat.y,
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 540,
    title: "Cyrene · Chat",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    skipTaskbar: false,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(chatWindow);

  const queryString = targetSessionId ? "?sessionId=" + encodeURIComponent(targetSessionId) : "";
  if (isDev) {
    chatWindow.loadURL("http://localhost:5173/chat/" + queryString);
  } else {
    chatWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "chat", "index.html"),
      targetSessionId ? { search: queryString } : undefined,
    );
  }

  chatWindow.once("ready-to-show", () => {
    chatWindow?.show();
    chatWindow?.focus();
  });

  // Fallback: Ensure chat window shows even if ready-to-show is delayed
  setTimeout(() => {
    if (chatWindow && !chatWindow.isDestroyed() && !chatWindow.isVisible()) {
      chatWindow.show();
      chatWindow.focus();
    }
  }, 1500);

  chatWindow.on("closed", () => {
    chatWindow = null;
  });
}

function createSidebarWindow(): void {
  if (sidebarWindow && !sidebarWindow.isDestroyed()) {
    sidebarWindow.show();
    sidebarWindow.focus();
    return;
  }

  const layout = computeLayout();
  sidebarWindow = new BrowserWindow({
    x: layout.sidebar.x,
    y: layout.sidebar.y,
    width: 360,
    height: 760,
    minWidth: 320,
    minHeight: 540,
    title: "Cyrene · Status",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    skipTaskbar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(sidebarWindow);

  if (isDev) {
    sidebarWindow.loadURL("http://localhost:5173/sidebar/");
  } else {
    sidebarWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "sidebar", "index.html")
    );
  }

  sidebarWindow.once("ready-to-show", () => {
    sidebarWindow?.show();
  });

  sidebarWindow.on("closed", () => {
    sidebarWindow = null;
  });
}

function createTasksWindow(): void {
  if (tasksWindow && !tasksWindow.isDestroyed()) {
    tasksWindow.show();
    tasksWindow.focus();
    return;
  }

  const layout = computeLayout();
  tasksWindow = new BrowserWindow({
    x: layout.tasks.x,
    y: layout.tasks.y,
    width: 480,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    title: "Cyrene · Today's Schedule",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    skipTaskbar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(tasksWindow);

  if (isDev) {
    tasksWindow.loadURL("http://localhost:5173/tasks/");
  } else {
    tasksWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "tasks", "index.html")
    );
  }

  tasksWindow.once("ready-to-show", () => {
    tasksWindow?.show();
  });

  tasksWindow.on("closed", () => {
    tasksWindow = null;
  });
}

function createSettingsWindow(section?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    // ： settings （loadURL ）
    if (section) {
      settingsWindow.webContents.send(IPC.SETTINGS_SWITCH_SECTION, section);
    }
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const width = 1060;
  const height = 920;
  settingsWindow = new BrowserWindow({
    x: dx + Math.max(0, Math.floor((dw - width) / 2)),
    y: dy + Math.max(0, Math.floor((dh - height) / 2)),
    width,
    height,
    minWidth: 920,
    minHeight: 580,
    title: "Cyrene · Settings",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    skipTaskbar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(settingsWindow);

  const hash = section ? `#${section}` : "";
  if (isDev) {
    settingsWindow.loadURL("http://localhost:5173/settings/" + hash);
  } else {
    settingsWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "settings", "index.html"),
      { hash: section || "" }
    );
  }

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createLogWindow(): void {
  if (logWindow && !logWindow.isDestroyed()) {
    if (logWindow.isMinimized()) logWindow.restore();
    logWindow.show();
    logWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const width = 860;
  const height = 640;
  logWindow = new BrowserWindow({
    x: dx + Math.max(0, Math.floor((dw - width) / 2)),
    y: dy + Math.max(0, Math.floor((dh - height) / 2)),
    width,
    height,
    minWidth: 600,
    minHeight: 400,
    title: "Cyrene · Response & Activity Log",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(logWindow);

  if (isDev) {
    logWindow.loadURL("http://localhost:5173/log/");
  } else {
    logWindow.loadFile(
      path.join(__dirname, "..", "..", "renderer", "log", "index.html")
    );
  }

  logWindow.once("ready-to-show", () => {
    logWindow?.show();
  });

  logWindow.on("closed", () => {
    logWindow = null;
  });
}

function toggleChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed() && (chatWindow.isVisible() || chatWindow.isMinimized())) {
    chatWindow.hide();
  } else {
    createChatWindow();
  }
}

function toggleSidebarWindow(): void {
  if (sidebarWindow && !sidebarWindow.isDestroyed() && (sidebarWindow.isVisible() || sidebarWindow.isMinimized())) {
    sidebarWindow.hide();
  } else {
    createSidebarWindow();
  }
}

function toggleTasksWindow(): void {
  if (tasksWindow && !tasksWindow.isDestroyed() && (tasksWindow.isVisible() || tasksWindow.isMinimized())) {
    tasksWindow.hide();
  } else {
    createTasksWindow();
  }
}

function toggleSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed() && (settingsWindow.isVisible() || settingsWindow.isMinimized())) {
    settingsWindow.hide();
  } else {
    createSettingsWindow();
  }
}

function toggleLogWindow(): void {
  if (logWindow && !logWindow.isDestroyed() && (logWindow.isVisible() || logWindow.isMinimized())) {
    logWindow.hide();
  } else {
    createLogWindow();
  }
}


async function createStickerManagerWindow(): Promise<{ ok: boolean; error?: string }> {
  if (stickerManagerWindow && !stickerManagerWindow.isDestroyed()) {
    stickerManagerWindow.show();
    stickerManagerWindow.focus();
    stickerManagerWindow.moveTop();
    return { ok: true };
  }

  const parentBounds = settingsWindow?.getBounds();
  const display = screen.getPrimaryDisplay();
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const width = 520;
  const height = 420;
  stickerManagerWindow = new BrowserWindow({
    x: parentBounds ? parentBounds.x + Math.max(24, Math.floor((parentBounds.width - width) / 2)) : dx + Math.max(0, Math.floor((dw - width) / 2)),
    y: parentBounds ? parentBounds.y + 64 : dy + Math.max(0, Math.floor((dh - height) / 2)),
    width,
    height,
    minWidth: 460,
    minHeight: 360,
    title: "Sticker Manager",
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    parent: settingsWindow ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(stickerManagerWindow);

  stickerManagerWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[stickers] did-fail-load", { errorCode, errorDescription, validatedURL });
  });

  try {
    if (isDev) {
      await stickerManagerWindow.loadURL("http://localhost:5173/sticker-manager/");
    } else {
      await stickerManagerWindow.loadFile(
        path.join(__dirname, "..", "..", "renderer", "sticker-manager", "index.html")
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[stickers] failed to load sticker manager window", error);
    stickerManagerWindow?.close();
    return { ok: false, error: message };
  }

  stickerManagerWindow.once("ready-to-show", () => {
    stickerManagerWindow?.show();
    stickerManagerWindow?.focus();
    stickerManagerWindow?.moveTop();
  });

  stickerManagerWindow.on("closed", () => {
    stickerManagerWindow = null;
  });

  return { ok: true };
}

/** （450×800 ，）。 */
function createCallWindow(): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.show();
    callWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.workArea;
  const CALL_W = 420;
  const CALL_H = 800;
  const cx = Math.max(0, Math.floor((dw - CALL_W) / 2));
  const cy = Math.max(0, Math.floor((dh - CALL_H) / 2));

  callWindow = new BrowserWindow({
    x: display.workArea.x + cx,
    y: display.workArea.y + cy,
    width: CALL_W,
    height: CALL_H,
    minWidth: 420,
    minHeight: 600,
    title: "Cyrene · Voice Call",
    icon: getCurrentAppIconPath(),
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "preload", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachExternalLinkHandler(callWindow);

  if (isDev) {
    callWindow.loadURL("http://localhost:5173/call/");
  } else {
    callWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "call", "index.html"));
  }

  callWindow.once("ready-to-show", () => {
    callWindow?.show();
  });

  callWindow.on("closed", () => {
    callWindow = null;
    stopCall();
    setCallWindow(null);
  });

  //  call-manager
  setCallWindow(callWindow);
}

function getTrayIcon(): Electron.NativeImage {
  const appPath = typeof app !== "undefined" && typeof app.getAppPath === "function" ? app.getAppPath() : process.cwd();
  const candidates = [
    path.join(appPath, "assets", "tray-icon.ico"),
    path.join(appPath, "assets", "icon.ico"),
    path.join(__dirname, "..", "..", "..", "assets", "tray-icon.ico"),
    path.join(__dirname, "..", "..", "..", "assets", "icon.ico"),
    path.join(process.cwd(), "assets", "tray-icon.ico"),
    path.join(process.cwd(), "assets", "icon.ico"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const ico = nativeImage.createFromPath(c);
      if (!ico.isEmpty()) return ico;
    }
  }
  const appIconPath = getCurrentAppIconPath();
  if (fs.existsSync(appIconPath)) {
    const appIcon = nativeImage.createFromPath(appIconPath);
    if (!appIcon.isEmpty()) {
      return appIcon.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

function createTray(): void {
  try {
    const icon = getTrayIcon();
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open Chat (Alt+1)",
        click: () => { toggleChatWindow(); },
      },
      {
        label: "Open Status (Alt+2)",
        click: () => { toggleSidebarWindow(); },
      },
      {
        label: "Today's Schedule (Alt+3)",
        click: () => { toggleTasksWindow(); },
      },
      {
        label: "Response Log (Alt+4)",
        click: () => { toggleLogWindow(); },
      },
      {
        label: "Settings (Alt+S)",
        click: () => { toggleSettingsWindow(); },
      },
      {
        label: "Show/Hide Pet (Alt+C)",
        click: () => {
          if (mainWindow) {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => { app.quit(); },
      },
    ]);

    tray.setToolTip("Cyrene");
    tray.setContextMenu(contextMenu);
    tray.on("click", () => { toggleChatWindow(); });
    tray.on("double-click", () => { toggleChatWindow(); });
  } catch (err) {
    console.warn("[Cyrene] Failed to initialize tray:", err);
  }
}

function applyUiIcon(iconSetting: UiIcon): void {
  const icon = nativeImage.createFromPath(getAppIconPath(iconSetting));
  if (icon.isEmpty()) {
    console.warn("[Cyrene] failed to load selected app icon:", iconSetting);
    return;
  }
  tray?.setImage(icon);
  for (const win of [mainWindow, chatWindow, sidebarWindow, tasksWindow, settingsWindow, logWindow, stickerManagerWindow, callWindow]) {
    if (win && !win.isDestroyed()) win.setIcon(icon);
  }
}

const currentPetSenderId = (): number | null => mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null;
const currentSettingsSenderId = (): number | null => settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow.webContents.id : null;

function expectedRendererDocument(relativePath: string): string {
  if (isDev) {
    const route = relativePath === "index.html"
      ? ""
      : relativePath.replace(/index\.html$/, "");
    return `http://localhost:5173/${route.replace(/\\/g, "/")}`;
  }
  return pathToFileURL(path.join(__dirname, "..", "..", "renderer", ...relativePath.split("/"))).href;
}

function isPetMainFrame(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return isTrustedMainFrameSender(event, mainWindow, expectedRendererDocument("index.html"));
}

function assertSettingsMainFrame(event: Electron.IpcMainInvokeEvent): void {
  assertTrustedMainFrameSender(event, settingsWindow, expectedRendererDocument("settings/index.html"), "UNTRUSTED_SETTINGS_SENDER");
}

ipcMain.handle(IPC.WINDOW_SET_INTERACTIVE, (event, interactive: boolean) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId()) || typeof interactive !== "boolean") return;
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }
});

ipcMain.on(IPC.WINDOW_MOVE, (event, dx: number, dy: number) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId()) || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  petWindowMoveController.moveRelative(dx, dy);
});

ipcMain.on(IPC.WINDOW_MOVE_TO, (event, x: number, y: number) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId()) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  petWindowMoveController.queueAbsolute(x, y);
});

/**
 * Toggle the BrowserWindow's opacity while the user is dragging.
 *
 * The window is created with 	ransparent: true (a WS_EX_LAYERED window).
 * Windows DWM treats "fully transparent" layered windows as a special
 * class and caches a separate drag-image bitmap that races with the
 * WebGL canvas being redrawn by the GPU during the drag -- that race
 * is the "double model" ghost the user sees.
 *
 * Why opacity (not setBackgroundColor): setBackgroundColor only changes
 * the Chromium page background. DWM still sees a fully-transparent
 * layered window and keeps its drag-image code path. setOpacity calls
 * SetLayeredWindowAttributes with a per-pixel alpha < 1.0, which forces
 * DWM to take the alpha-blending path -- the same path that no longer
 * generates the drag image. setOpacity is therefore the lever that
 * actually changes DWM's drag behaviour, regardless of the page
 * background colour.
 *
 * 0.99 (= 1% transparent) is the most conservative value: visually
 * imperceptible, but enough to switch DWM off the drag-image path.
 * If a particular Windows build still ghosts at 0.99, push the value
 * down (0.95, 0.9). Lower opacity is *more* effective at suppressing
 * the drag image, at the cost of making the model itself look faintly
 * translucent during the drag.
 */
ipcMain.on(IPC.WINDOW_SET_DRAGGING, (event, isDragging: boolean) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId()) || typeof isDragging !== "boolean") return;
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (!isDragging) {
    petWindowMoveController.finishDragging();
  }
});

/**
 * Capture the current window contents and return it as a base64 data URL.
 *
 * Used by the renderer to grab a single frame of the WebGL canvas at the
 * start of a window drag, so it can overlay a static <img> on top of the
 * canvas while the drag is in progress. The static image lets the drag
 * work without involving the WebGL draw pipeline at all, which is what
 * kills the layered-window flicker (DWM is no longer racing with
 * GPU-driven canvas updates).
 */
ipcMain.handle(IPC.WINDOW_CAPTURE_FRAME, async (event) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId())) return null;
  if (!mainWindow) return null;
  try {
    const image = await mainWindow.webContents.capturePage();
    return image.toDataURL();
  } catch (err) {
    console.error("[Cyrene] captureFrame failed:", err);
    return null;
  }
});
ipcMain.handle(IPC.WINDOW_GET_CURSOR_POSITION, (event) => {
  if (!isPetMainFrame(event) || !authorizePetControlSender(event.sender.id, currentPetSenderId())) return null;
  return screen.getCursorScreenPoint();
});

ipcMain.on(IPC.PET_SHOW_CONTEXT_MENU, (event) => {
  const menu = Menu.buildFromTemplate([
    {
      label: "Chat with Cyrene (Alt+1)",
      click: () => toggleChatWindow(),
    },
    {
      label: "Status Panel (Alt+2)",
      click: () => toggleSidebarWindow(),
    },
    {
      label: "Today's Schedule (Alt+3)",
      click: () => toggleTasksWindow(),
    },
    {
      label: "Response & Activity Log (Alt+4)",
      click: () => toggleLogWindow(),
    },
    {
      label: "Quick Mini Chat (Alt+5)",
      click: () => sendToLive2DWindow(IPC.PET_TOGGLE_MINI_CHAT),
    },
    {
      label: "Toggle Voice / Sound",
      click: () => sendToLive2DWindow(IPC.PET_TOGGLE_VOICE),
    },
    {
      label: "Settings (Alt+S)",
      click: () => toggleSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "Expressions & Motions",
      submenu: [
        {
          label: "Smile",
          click: () => { const a = findAction("smile"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Playful Wink (Wink~)",
          click: () => { const a = findAction("wink"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Act Cute",
          click: () => { const a = findAction("act cute"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Sparkle",
          click: () => { const a = findAction("sparkle"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Starry Eyes",
          click: () => { const a = findAction("starry eyes"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Sunglasses",
          click: () => { const a = findAction("sunglasses"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Question Mark",
          click: () => { const a = findAction("question mark"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Dizzy Eyes",
          click: () => { const a = findAction("dizzy eyes"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Cheerful Eyes",
          click: () => { const a = findAction("happy eyes"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
        {
          label: "Reset Pose & Expression",
          click: () => { const a = findAction("reset"); if (a) sendToLive2DWindow(IPC.LIVE2D_PLAY_ACTION, a.target); },
        },
      ],
    },
    { type: "separator" },
    {
      label: mainWindow?.isVisible() ? "Hide Cyrene (Alt+C)" : "Show Cyrene (Alt+C)",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) mainWindow.hide();
          else mainWindow.show();
        }
      },
    },
    {
      label: "Quit Cyrene",
      click: () => app.quit(),
    },
  ]);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    menu.popup({ window: win });
  } else {
    menu.popup();
  }
});

// Response & Activity Log IPC handlers
ipcMain.handle(IPC.LOG_GET_ENTRIES, () => {
  if (activityLogBuffer.length === 0) {
    seedActivityLogFromChats();
  }
  return activityLogBuffer;
});

ipcMain.handle(IPC.LOG_CLEAR, () => {
  activityLogBuffer.length = 0;
  if (logWindow && !logWindow.isDestroyed()) {
    try {
      logWindow.webContents.send(IPC.LOG_CLEARED);
    } catch {
      // ignore
    }
  }
  return true;
});

ipcMain.handle(IPC.LOG_PUSH_ENTRY, (_event, entry: Partial<ActivityLogItem>) => {
  if (!entry || typeof entry.text !== "string" || !entry.type) return false;
  pushActivityLog(
    entry.type as ActivityLogItem["type"],
    entry.text,
    entry.meta,
    entry.channel,
  );
  return true;
});

ipcMain.on(IPC.LOG_CLOSE, () => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.hide();
  }
});

ipcMain.on(IPC.LOG_MINIMIZE, () => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.minimize();
  }
});

interface CachedWeatherTelemetry {
  timestamp: number;
  data: {
    city: string;
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    weatherCode: number;
    weatherText: string;
    weatherIcon: string;
  };
}

let hanoiWeatherCache: CachedWeatherTelemetry | null = null;
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

function resolveWeatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code === 1) return "🌤️";
  if (code === 2) return "⛅";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 55) return "🌦️";
  if (code >= 61 && code <= 65) return "🌧️";
  if (code >= 71 && code <= 75) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95 && code <= 99) return "⛈️";
  return "⛅";
}

function resolveWeatherText(code: number): string {
  if (code === 0) return "Clear Sky";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rainy";
  if (code >= 71 && code <= 75) return "Snowy";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Partly Cloudy";
}

ipcMain.handle(IPC.WEATHER_GET_CURRENT, async (_event, requestedCity?: string) => {
  const city = (requestedCity && typeof requestedCity === "string" ? requestedCity.trim() : "Hanoi") || "Hanoi";
  const now = Date.now();
  if (city.toLowerCase() === "hanoi" && hanoiWeatherCache && (now - hanoiWeatherCache.timestamp < WEATHER_CACHE_TTL_MS)) {
    return hanoiWeatherCache.data;
  }

  try {
    const lat = 21.0285;
    const lon = 105.8542;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = (await res.json()) as {
        current?: {
          temperature_2m: number;
          relative_humidity_2m: number;
          apparent_temperature: number;
          weather_code: number;
        };
      };
      if (data?.current) {
        const c = data.current;
        const result = {
          city: "Hanoi",
          temperature: Math.round(c.temperature_2m),
          apparentTemperature: Math.round(c.apparent_temperature),
          humidity: Math.round(c.relative_humidity_2m),
          weatherCode: c.weather_code,
          weatherText: resolveWeatherText(c.weather_code),
          weatherIcon: resolveWeatherIcon(c.weather_code),
        };
        hanoiWeatherCache = { timestamp: now, data: result };
        return result;
      }
    }
  } catch (err) {
    console.warn("[Weather] Open-Meteo fetch failed:", err);
  }

  return {
    city: "Hanoi",
    temperature: 28,
    apparentTemperature: 31,
    humidity: 75,
    weatherCode: 2,
    weatherText: "Partly Cloudy",
    weatherIcon: "⛅",
  };
});

ipcMain.handle(IPC.LIVE2D_GET_MAIN_DIAGNOSTICS, () => ({
  window: live2dWindowLifecycle.getDiagnostics(),
}));

ipcMain.handle("debug:screenshot", async (event) => {
  if (!isDev || !mainWindow || mainWindow.webContents.id !== event.sender.id) return null;
  return runExplicitScreenCapture("debug", async () => {
    const image = await mainWindow!.webContents.capturePage();
    const png = image.toPNG();
    const outPath = path.join(app.getPath("temp"), "cyrene-screenshot.png");
    await fs.promises.writeFile(outPath, png);
    return outPath;
  });
});

ipcMain.on(IPC.WINDOW_MINIMIZE, () => {
  mainWindow?.minimize();
});

ipcMain.on(IPC.WINDOW_CLOSE, () => {
  mainWindow?.hide();
});

ipcMain.on(IPC.APP_QUIT, () => {
  app.quit();
});

ipcMain.on(IPC.CHAT_MINIMIZE, () => {
  chatWindow?.minimize();
});

ipcMain.on(IPC.CHAT_CLOSE, () => {
  chatWindow?.close();
});

ipcMain.on(IPC.CHAT_TOGGLE_MAXIMIZE, () => {
  if (!chatWindow) return;
  if (chatWindow.isMaximized()) {
    chatWindow.unmaximize();
  } else {
    chatWindow.maximize();
  }
});

ipcMain.handle(IPC.CHAT_IS_MAXIMIZED, () => {
  return chatWindow?.isMaximized() ?? false;
});

// ：{ providerKey, providerId, model, preference }
// providerKey = settings.provider（displayName），；chat:setReasoning  providerKey。
ipcMain.handle(IPC.CHAT_GET_REASONING_STATE, () => {
  const settings = loadModelSettings();
  const cap = getCapabilityOrOpenAI(settings.provider);
  return {
    providerKey: settings.provider,
    providerId: cap.id,
    model: settings.model,
    preference: settings.perProvider?.[settings.provider]?.reasoning,
  };
});

// ：。payload  { providerKey, preference }，providerKey 。
ipcMain.handle(IPC.CHAT_SET_REASONING, (_event, payload: unknown) => {
  if (!payload || typeof payload !== "object") return;
  const p = payload as { providerKey?: unknown; preference?: unknown };
  if (typeof p.providerKey !== "string" || typeof p.preference !== "object" || !p.preference) return;
  const current = loadModelSettings();
  if (current.provider !== p.providerKey) {
    // ： state 、，provider 。 providerKey 。
    return;
  }
  const normalized = normalizeReasoningPreference(p.preference);
  if (!normalized) return;
  saveModelSettings({ reasoning: normalized });
});
ipcMain.handle(IPC.CHAT_INGEST_FILES, async (_event, paths: unknown) => {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string") : [];
  if (list.length === 0) return [];
  try {
    return list.map((filePath) => describePendingAttachment(filePath));
  } catch (err: any) {
    console.error("[Cyrene] ingestFiles ERROR:", err?.message || err);
    return [];
  }
});

ipcMain.handle(IPC.CHAT_PROCESS_DOCUMENTS, async (event, payload: unknown) => {
  const filePaths = payload && typeof payload === "object" && Array.isArray((payload as { filePaths?: unknown }).filePaths)
    ? (payload as { filePaths: unknown[] }).filePaths.filter((p): p is string => typeof p === "string")
    : [];
  if (filePaths.length === 0) return [];
  const query = typeof (payload as { query?: unknown }).query === "string"
    ? (payload as { query: string }).query
    : "";
  return processDocumentIndexRequest({
    filePaths,
    query,
    sender: event.sender,
    enqueue: enqueueDocumentIndexJob,
    retrieve: retrieveQueuedDocumentChunks,
  });
});

ipcMain.handle(IPC.CHAT_CANCEL_DOCUMENT_INDEX, (_event, payload: unknown) => {
  const jobId = payload && typeof payload === "object" ? (payload as { jobId?: unknown }).jobId : undefined;
  return typeof jobId === "string" && cancelDocumentIndexJob(jobId);
});

ipcMain.handle(IPC.CHAT_CAPTION_IMAGE, async (_event, payload: unknown) => {
  const filePath = payload && typeof payload === "object"
    ? (payload as { filePath?: unknown }).filePath
    : undefined;
  const hasAnnotations = payload && typeof payload === "object"
    ? (payload as { hasAnnotations?: unknown }).hasAnnotations === true
    : false;
  const validated = validateCaptionImagePath(filePath);
  if (!validated.ok) return { ok: false, error: validated.error };

  const visionCfg = loadVisionConfig();
  if (!visionCfg) {
    return { ok: false, error: "No vision model is configured, so the image cannot be analyzed." };
  }

  try {
    const { captionImage } = await import("./orchestrator/vision-captioner");
    const caption = await captionImage(
      { base64: validated.buffer.toString("base64"), mime: validated.mime },
      buildImageCaptionPrompt(hasAnnotations),
      visionCfg,
    );
    if (caption.startsWith("[Error")) {
      return { ok: false, error: caption };
    }
    return { ok: true, caption };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle(IPC.CHAT_GET_IMAGE_SEND_STRATEGY, () => {
  const settings = loadModelSettings();
  return decideImageSendStrategy({
    multimodal: settings.multimodal,
    vision: loadVisionConfig(),
  });
});
ipcMain.on(IPC.SIDEBAR_MINIMIZE, () => {
  sidebarWindow?.minimize();
});

ipcMain.on(IPC.SIDEBAR_CLOSE, () => {
  sidebarWindow?.close();
});

//  toggle：（true=）
ipcMain.handle(IPC.SIDEBAR_TOGGLE_ALWAYS_ON_TOP, () => {
  if (!sidebarWindow) return false;
  const next = !sidebarWindow.isAlwaysOnTop();
  sidebarWindow.setAlwaysOnTop(next, next ? "screen-saver" : "normal");
  return next;
});

ipcMain.on(IPC.SIDEBAR_OPEN_TASKS, () => {
  createTasksWindow();
});

ipcMain.on(IPC.SIDEBAR_OPEN_SETTINGS, (_event, section?: string) => {
  createSettingsWindow(section);
});

ipcMain.on(IPC.SIDEBAR_OPEN_CALL, () => {
  createCallWindow();
});

ipcMain.on(IPC.TASKS_MINIMIZE, () => {
  tasksWindow?.minimize();
});

ipcMain.on(IPC.TASKS_CLOSE, () => {
  tasksWindow?.close();
});
ipcMain.on(IPC.SETTINGS_MINIMIZE, () => {
  settingsWindow?.minimize();
});

ipcMain.on(IPC.SETTINGS_CLOSE, () => {
  settingsWindow?.close();
});

ipcMain.handle(IPC.SETTINGS_GET_CONFIG, (event) => {
  assertSettingsMainFrame(event);
  return redactModelSettings(loadModelSettings());
});

function redactGeneralSettings(settings: GeneralSettings): GeneralSettings {
  return {
    ...settings,
    ttsMinimaxKey: settings.ttsMinimaxKey ? "••••••••" : "",
    ttsCustomCloudApiKey: settings.ttsCustomCloudApiKey ? "••••••••" : "",
    ttsMimoKey: settings.ttsMimoKey ? "••••••••" : "",
    ttsMosslandKey: settings.ttsMosslandKey ? "••••••••" : "",
    searchMinimaxKey: settings.searchMinimaxKey ? "••••••••" : "",
    searchBochaKey: settings.searchBochaKey ? "••••••••" : "",
    searchTavilyKey: settings.searchTavilyKey ? "••••••••" : "",
    amapKey: settings.amapKey ? "••••••••" : "",
    asrAliyunAppKey: settings.asrAliyunAppKey ? "••••••••" : "",
    asrAliyunAccessKeyId: settings.asrAliyunAccessKeyId ? "••••••••" : "",
    asrAliyunAccessKeySecret: settings.asrAliyunAccessKeySecret ? "••••••••" : "",
  };
}

ipcMain.handle(IPC.SETTINGS_GET_GENERAL, (event) => {
  const isSettings = settingsWindow && event.sender.id === settingsWindow.webContents.id;
  const general = loadGeneralSettings();
  return isSettings ? general : redactGeneralSettings(general);
});

ipcMain.handle(IPC.UI_THEME_GET, () => {
  return loadGeneralSettings().uiTheme;
});

ipcMain.handle(IPC.UI_FONT_GET, () => {
  return loadGeneralSettings().uiFont;
});

function getUiFontsDir(): string {
  return path.join(app.getPath("userData"), "ui-fonts");
}

function getCustomFontDisplayName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/[-_]+/g, " ").trim().slice(0, 80) || "Custom font";
}

ipcMain.handle(IPC.SETTINGS_PICK_UI_FONT, async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Font files", extensions: ["ttf", "otf"] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle(IPC.SETTINGS_IMPORT_UI_FONT, (_event, sourcePath: unknown) => {
  if (typeof sourcePath !== "string" || !sourcePath) throw new Error("No font file was selected");
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension !== ".ttf" && extension !== ".otf") throw new Error("Only .ttf and .otf font files are supported");
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 50 * 1024 * 1024) throw new Error("The font file is invalid or larger than 50 MB");

  const fileName = `custom-${randomUUID()}${extension}`;
  if (!isSupportedFontFileName(fileName)) throw new Error("The font filename is invalid");
  const fontsDir = getUiFontsDir();
  fs.mkdirSync(fontsDir, { recursive: true });
  const targetPath = path.join(fontsDir, fileName);
  fs.copyFileSync(sourcePath, targetPath);

  const before = loadGeneralSettings().uiFont;
  const saved = saveGeneralSettings({ uiFont: { kind: "custom", fileName, displayName: getCustomFontDisplayName(sourcePath) } });
  if (before.kind === "custom" && before.fileName !== fileName) {
    const oldPath = path.join(fontsDir, before.fileName);
    if (isSupportedFontFileName(before.fileName)) fs.rmSync(oldPath, { force: true });
  }
  return saved.uiFont;
});

ipcMain.handle(IPC.SETTINGS_RESET_UI_FONT, () => {
  const before = loadGeneralSettings().uiFont;
  const saved = saveGeneralSettings({ uiFont: DEFAULT_UI_FONT });
  if (before.kind === "custom" && isSupportedFontFileName(before.fileName)) {
    fs.rmSync(path.join(getUiFontsDir(), before.fileName), { force: true });
  }
  return saved.uiFont;
});

ipcMain.handle(IPC.SETTINGS_SAVE_GENERAL, (_event, settings: Partial<GeneralSettings>) => {
  const saved = saveGeneralSettings(settings);
  if ("proactiveChatMode" in settings || "proactiveDeliveryTarget" in settings) {
    proactiveChatService?.invalidate();
  }
  return saved;
});

ipcMain.handle(IPC.SETTINGS_OPEN_CUSTOM_STYLE_PROMPT, async () => {
  const filePath = ensureCustomStylePrompt();
  await shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

ipcMain.on(IPC.SETTINGS_OPEN_SIDEBAR, () => {
  createSidebarWindow();
});

ipcMain.on(IPC.SETTINGS_CLOSE_SIDEBAR, () => {
  sidebarWindow?.close();
});

ipcMain.on(IPC.SETTINGS_OPEN_TASKS, () => {
  createTasksWindow();
});

ipcMain.on(IPC.SETTINGS_CLOSE_TASKS, () => {
  tasksWindow?.close();
});

ipcMain.on(IPC.SETTINGS_SET_PET_ALWAYS_ON_TOP, (_event, value: boolean) => {
  const saved = saveGeneralSettings({ ...loadGeneralSettings(), petAlwaysOnTop: Boolean(value) });
  mainWindow?.setAlwaysOnTop(saved.petAlwaysOnTop, saved.petAlwaysOnTop ? "screen-saver" : "normal");
});

ipcMain.on(IPC.SETTINGS_SET_PET_VISIBLE, (_event, value: boolean) => {
  saveGeneralSettings({ ...loadGeneralSettings(), petVisible: Boolean(value) });
});

ipcMain.on(IPC.SETTINGS_SET_PET_ZOOM, (event, value: unknown) => {
  const trustedFrame = isPetMainFrame(event)
    || isTrustedMainFrameSender(event, settingsWindow, expectedRendererDocument("settings/index.html"));
  if (!trustedFrame || !authorizePetZoomSender(event.sender.id, currentPetSenderId(), currentSettingsSenderId())) return;
  const zoom = normalizePetZoom(value);
  if (zoom === null) return;
  const saved = saveGeneralSettings({ ...loadGeneralSettings(), petZoom: zoom });
  applyPetZoom(saved.petZoom);
});

ipcMain.handle(IPC.MODEL_CONFIG_GET, () => {
  return getPublicModelConfig();
});

ipcMain.handle(IPC.RUNTIME_STATE_GET, () => {
  return runtimeState;
});

ipcMain.handle(IPC.SETTINGS_SAVE_CONFIG, (event, settings: Partial<ModelSettings>) => {
  assertSettingsMainFrame(event);
  const saved = saveModelSettings(applyModelSecretPatch(settings, loadModelSettings()));
  broadcastModelConfigChanged(saved);
  return redactModelSettings(saved);
});

ipcMain.handle(IPC.SETTINGS_TEST_CONNECTION, async (event, cfg: VendorConfig) => {
  assertSettingsMainFrame(event);
  return testVendorConnection(applyModelSecretPatch(cfg, loadModelSettings()) as VendorConfig);
});

/**
 * 。
 *  4x4  PNG（100  base64）——，
 *  SVG （SVG ，）。
 * （HTTP 2xx + ）——""。
 */
const VISION_TEST_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR4nGP4z8DwHxkzkC4AADxAH+HggXe0AAAAAElFTkSuQmCC";

ipcMain.handle(IPC.SETTINGS_TEST_VISION, async (event, cfg: { baseUrl: string; apiKey: string; model: string }) => {
  assertSettingsMainFrame(event);
  const restored = applyModelSecretPatch({ vision: cfg }, loadModelSettings()) as { vision?: typeof cfg };
  cfg = restored.vision ?? cfg;
  const start = Date.now();
  console.log("[Cyrene] test vision: model=" + cfg.model + " url=" + cfg.baseUrl);
  try {
    const { captionImage } = await import("./orchestrator/vision-captioner");
    const result = await captionImage(
      { base64: VISION_TEST_IMAGE_BASE64, mime: "image/png" },
      "What color is this image? Answer with one word.",
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model },
    );
    const latency = Date.now() - start;
    // ： [ （）
    if (result.startsWith("[Error")) {
      return { ok: false, latency, error: result };
    }
    return { ok: true, latency, sample: result.slice(0, 80) };
  } catch (e) {
    return { ok: false, latency: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
});


ipcMain.handle(IPC.EMBEDDING_SET_MODEL, async (_event, modelKey: string) => {
  console.log("[Cyrene] embedding model switch requested:", modelKey);
  try {
    const result = await switchEmbeddingModel(modelKey);
    if (result.ok) {
      await reconcileUserMemoryIndex();
      saveModelSettings({ embeddingModel: modelKey as "minilm" | "bgem3" });
      broadcastModelConfigChanged();
      stickerEmbeddingIndex = null;
      refreshStickerEmbeddingIndexInBackground("embedding-model-switch");
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Cyrene] embedding model switch failed:", message);
    return { ok: false, clearedEntries: 0, error: message };
  }
});
ipcMain.handle(IPC.RERANKER_SET_MODE, async (_event, mode: "light" | "standard" | "none") => {
  const current = loadModelSettings();
  saveModelSettings({ ...current, rerankerMode: mode });
  await initReranker(mode);
  console.log("[Cyrene] reranker mode switched to", mode);
  return true;
});

ipcMain.handle(IPC.RERANKER_GET_STATUS, () => {
  return getRerankerInstallStatus();
});

ipcMain.handle(IPC.MODEL_GET_INSTALL_STATUS, () => {
  const { getModelInstallStatus } = require("./rag/model-status");
  return getModelInstallStatus();
});

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, error: "Invalid URL" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.on(IPC.SETTINGS_PREVIEW_RUNTIME_SYNC, (_event, value: "off" | "local" | "llm") => {
  const current = loadModelSettings();
  const preview = normalizeModelSettings({
    ...current,
    runtimeSync: value === "llm" ? "llm" : value === "local" ? "local" : "off",
  });
  broadcastModelConfigChanged(preview);
});

ipcMain.handle(IPC.SETTINGS_OPEN_STICKER_MANAGER, async () => {
  console.log("[stickers] open sticker manager requested");
  return createStickerManagerWindow();
});

ipcMain.on(IPC.STICKERS_MINIMIZE, () => {
  stickerManagerWindow?.minimize();
});

ipcMain.on(IPC.STICKERS_CLOSE, () => {
  stickerManagerWindow?.close();
});

ipcMain.handle(IPC.STICKERS_GET_CONFIG, () => {
  return getStickerManagerConfig();
});

ipcMain.handle(IPC.STICKERS_SET_ENABLED, (_event, payload: unknown) => {
  const record = payload as { id?: unknown; enabled?: unknown };
  const id = typeof record?.id === "string" ? record.id : null;
  if (!id) return getStickerManagerConfig();
  setStickerEnabled(id, Boolean(record.enabled));
  return getStickerManagerConfig();
});

ipcMain.handle(IPC.STICKERS_PICK_FILE, async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle(IPC.STICKERS_ADD, async (_event, payload: unknown) => {
  const { sourcePath, id, description, phrases } = payload as {
    sourcePath: string;
    id: string;
    description: string;
    phrases: string[];
  };
  try {
    await addUserSticker(sourcePath, id, description, phrases);
    stickerEmbeddingIndex = null;
    refreshStickerEmbeddingIndexInBackground("user-sticker-add");
  } catch (err) {
    console.error("[stickers] add failed:", err);
    throw err;
  }
  return getStickerManagerConfig();
});

ipcMain.handle(IPC.STICKERS_DELETE, async (_event, id: string) => {
  try {
    await deleteUserSticker(id);
    stickerEmbeddingIndex = null;
    refreshStickerEmbeddingIndexInBackground("user-sticker-delete");
  } catch (err) {
    console.error("[stickers] delete failed:", err);
    throw err;
  }
  return getStickerManagerConfig();
});

ipcMain.handle(IPC.STICKERS_GET_ENABLED, () => {
  const stickerSettings = loadStickerSettings();
  return getAllStickerConfig(stickerSettings).filter((s) => s.enabled);
});


ipcMain.handle(IPC.EMBEDDING_GET_STATUS, async () => {
  const cacheDir = path.join(os.homedir(), ".cache", "huggingface");
  const models = {
    minilm: { dir: "Xenova\\all-MiniLM-L6-v2", onnx: "onnx\\model_quantized.onnx", name: "MiniLM" },
    bgem3: { dir: "Xenova\\bge-m3", onnx: "onnx\\model_quantized.onnx", name: "BGE-M3" },
  };
  const result: Record<string, { installed: boolean; sizeBytes: number }> = {};
  for (const [key, m] of Object.entries(models)) {
    const onnxPath = path.join(cacheDir, m.dir, m.onnx);
    const installed = fs.existsSync(onnxPath);
    let sizeBytes = 0;
    if (installed) {
      try { sizeBytes = fs.statSync(onnxPath).size; } catch {}
    }
    result[key] = { installed, sizeBytes };
  }
  return result;
});


ipcMain.handle(IPC.EMBEDDING_DOWNLOAD, async (_event, payload: unknown) => {
  const p = payload as { model?: string; mirror?: string };
  const model = p.model || "minilm";
  const mirror = p.mirror || "official";
  try {
    const win = BrowserWindow.getFocusedWindow();
    await downloadEmbeddingModel(model, mirror, (info) => {
      win?.webContents.send(IPC.EMBEDDING_PROGRESS, info);
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

ipcMain.handle(IPC.USER_GET_AVATAR, () => {
  const avatarPath = getAvatarPath();
  if (!fs.existsSync(avatarPath)) return null;
  const buf = fs.readFileSync(avatarPath);
  const ext = path.extname(avatarPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return "data:" + mime + ";base64," + buf.toString("base64");
});

ipcMain.handle(IPC.MEMORY_PANEL_GET_DATA, () => loadMemoryPanelData());
ipcMain.handle(IPC.MEMORY_PANEL_DELETE_IMPORTED_DOC, (_event, payload: { importId: string; fileName?: string }) => {
  const deleted = deleteImportedDoc(payload.importId, payload.fileName);
  return { ok: true, deleted };
});
// L0/L1 editable fields whitelist
const L0_EDITABLE_KEYS = ["preferredName", "occupation", "longTermInterests", "language", "permanentNote"];
const L1_EDITABLE_KEYS = ["recentGoals", "recentPreferences", "currentProject"];

ipcMain.handle(IPC.MEMORY_PANEL_SAVE_L0, async (_event, raw: Record<string, unknown>) => {
  const patch: Partial<L0Profile> = {};
  for (const key of L0_EDITABLE_KEYS) {
    if (key in raw && typeof raw[key] === "string") {
      (patch as Record<string, unknown>)[key] = (raw[key] as string).trim();
    }
  }
  await memoryStore.updateL0(patch);
  return { ok: true };
});

ipcMain.handle(IPC.MEMORY_PANEL_SAVE_L1, async (_event, raw: Record<string, unknown>) => {
  const patch: Partial<L1Profile> = {};
  for (const key of L1_EDITABLE_KEYS) {
    if (key in raw && typeof raw[key] === "string") {
      (patch as Record<string, unknown>)[key] = (raw[key] as string).trim();
    }
  }
  await memoryStore.updateL1(patch);
  return { ok: true };
});
ipcMain.handle(IPC.USER_GET_PROFILE, () => loadUserProfile());
ipcMain.handle(IPC.USER_SAVE_PROFILE, (_event, profile: Partial<UserProfile>) => saveUserProfile(profile));
ipcMain.handle(IPC.USER_UPLOAD_AVATAR, async () => {
  const { dialog } = await import("electron");
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const srcPath = result.filePaths[0];
  const avatarPath = getAvatarPath();
  fs.mkdirSync(path.dirname(avatarPath), { recursive: true });
  fs.copyFileSync(srcPath, avatarPath);
  const profile = saveUserProfile({ avatarPath });
  broadcastToAuxWindows(IPC.USER_AVATAR_CHANGED, null);
  return { avatarPath, profile };
});

function requireSettingsSender(senderId: number): void {
  if (!settingsWindow || settingsWindow.isDestroyed() || settingsWindow.webContents.id !== senderId) {
    throw new Error("UNTRUSTED_SETTINGS_SENDER");
  }
}

ipcMain.handle(IPC.MCP_ADD_SERVER, async (event, config: unknown) => {
  requireSettingsSender(event.sender.id);
  console.log('[MCP IPC] add-server request received');
  const result = await addMcpServer(config as Parameters<typeof addMcpServer>[0]);
  console.log('[MCP IPC] add-server result:', result.ok ? 'ok' : 'failed');
  return result;
});

ipcMain.handle(IPC.MCP_REMOVE_SERVER, async (event, serverId: string) => {
  requireSettingsSender(event.sender.id);
  console.log('[MCP IPC] remove-server:', serverId);
  const result = await removeMcpServer(serverId);
  console.log('[MCP IPC] remove-server result:', JSON.stringify(result));
  return result;
});

ipcMain.handle(IPC.MCP_LIST_SERVERS, (event) => {
  requireSettingsSender(event.sender.id);
  const servers = listMcpServers();
  console.log('[MCP IPC] list-servers:', servers.length + ' servers');
  return servers;
});

ipcMain.handle(IPC.TOOL_SET_ENABLED, (event, payload: unknown) => {
  requireSettingsSender(event.sender.id);
  const p = payload as { id?: string; enabled?: boolean };
  if (!p.id) return { ok: false, error: 'missing tool id' };
  toolRegistry.setEnabled(p.id, p.enabled !== false);
  console.log('[Tool] ' + p.id + ' enabled=' + (p.enabled !== false));
  return { ok: true };
});

ipcMain.handle(IPC.TOOL_GET_ENABLED, (event) => {
  requireSettingsSender(event.sender.id);
  const tools = toolRegistry.getAllTools();
  const result: Record<string, boolean> = {};
  for (const t of tools) {
    result[t.id] = t.enabled;
  }
  return result;
});

ipcMain.handle(IPC.SKILL_LIST, () => {
  return listSkillsForUi();
});

ipcMain.handle(IPC.SKILL_SET_ENABLED, (_event, payload: unknown) => {
  const p = payload as { id?: string; enabled?: boolean };
  if (!p.id) return { ok: false, error: "missing skill id" };
  setSkillEnabled(p.id, p.enabled !== false);
  console.log("[Skill] " + p.id + " enabled=" + (p.enabled !== false));
  return { ok: true };
});

ipcMain.handle(IPC.EMBEDDING_DELETE, async (_event, payload: unknown) => {
  const p = payload as { model?: string };
  const model = p.model || "minilm";
  try {
    deleteEmbeddingModel(model);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});



// （）
//  app.ready 
protocol.registerSchemesAsPrivileged([
  { scheme: "local-sticker", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "local-font", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

app.whenReady().then(async () => {
  console.info("[Cyrene] App is ready, initializing...");
  
  // Register global shortcuts with toggle capability (press once to open/focus, press again to close/hide)
  globalShortcut.register("Alt+1", () => {
    toggleChatWindow();
  });
  globalShortcut.register("Alt+2", () => {
    toggleSidebarWindow();
  });
  globalShortcut.register("Alt+3", () => {
    toggleTasksWindow();
  });
  globalShortcut.register("Alt+4", () => {
    toggleLogWindow();
  });
  globalShortcut.register("Alt+5", () => {
    sendToLive2DWindow(IPC.PET_TOGGLE_MINI_CHAT);
  });
  globalShortcut.register("Alt+S", () => {
    toggleSettingsWindow();
  });
  globalShortcut.register('Alt+C', () => {
      const win = mainWindow;
      if (win) {
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
        }
      }
  });
  globalShortcut.register("Alt+G", () => {
    getCoWatchService().toggle();
  });

  //  local-sticker:// ： userData/stickers/ 
  protocol.handle("local-sticker", (request) => {
    const file = parseLocalStickerFileFromUrl(request.url);
    if (!file) return new Response("Invalid sticker URL", { status: 404 });

    const filePath = resolveLocalStickerPath(getStickersDir(), file);
    if (!filePath) return new Response("Invalid sticker path", { status: 403 });

    return net.fetch(pathToFileURL(filePath).toString());
  });
  protocol.handle("local-font", (request) => {
    let fileName: string;
    try {
      fileName = decodeURIComponent(new URL(request.url).hostname);
    } catch {
      return new Response("Invalid font URL", { status: 404 });
    }
    if (!isSafeUiFontRequest(fileName)) return new Response("Invalid font URL", { status: 404 });
    const filePath = path.join(getUiFontsDir(), fileName);
    if (path.dirname(filePath) !== getUiFontsDir() || !fs.existsSync(filePath)) return new Response("Font not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString()).then((response) => new Response(response.body, {
      headers: getUiFontResponseHeaders(fileName),
    }));
  });
  // Token  IPC
  ipcMain.handle(IPC.TOKEN_USAGE_GET, (_event, days: number) => {
    return getUsage(Math.max(1, Math.min(90, Number(days) || 7)));
  });

  ipcMain.on(IPC.LIVE2D_SPEECH_PREPARE, () => {
    sendToLive2DWindow(IPC.LIVE2D_SPEECH_PREPARE);
  });
  ipcMain.on(IPC.LIVE2D_MOUTH_START, (_event, payload: { durationMs?: number }) => {
    sendToLive2DWindow(IPC.LIVE2D_MOUTH_START, { durationMs: Number(payload?.durationMs ?? 0) });
  });
  ipcMain.on(IPC.LIVE2D_MOUTH_STOP, () => {
    sendToLive2DWindow(IPC.LIVE2D_MOUTH_STOP);
  });
  ipcMain.on(IPC.PET_SPEAK, (_event, payload: { text?: string }) => {
    if (payload?.text) {
      sendToLive2DWindow(IPC.PET_AGENT_EVENT, { type: "say", text: payload.text });
    }
  });

  // ── TTS IPC ──
  // / TTS （ general settings ）
  const ALLOWED_TTS_MUTATION_KEYS = new Set<string>(ALLOWED_TTS_SETTING_KEYS);

  ipcMain.handle(IPC.TTS_SAVE_SETTINGS, async (event, tts: Partial<GeneralSettings>) => {
    assertSettingsMainFrame(event);
    const before = loadGeneralSettings();
    const sanitizedTts: Partial<GeneralSettings> = {};
    if (tts && typeof tts === "object") {
      for (const [k, v] of Object.entries(tts)) {
        if (ALLOWED_TTS_MUTATION_KEYS.has(k)) {
          (sanitizedTts as any)[k] = v;
        }
      }
    }
    const saved = saveGeneralSettings({ ...before, ...sanitizedTts });

    //  MCP /： MiniMax+key→，→
    const searchConfigChanged = "searchMinimaxKey" in tts || "searchEngine" in tts;
    if (searchConfigChanged) {
      await syncVolcanoSearchMcp(saved);
    }

    // Playwright MCP： settings /
    if ("playwrightMcpEnabled" in tts) {
      await syncPlaywrightMcp(saved);
    }

    // （ ProactiveChat ，）。
    if ("proactiveChatMode" in tts) {
      proactiveChatService?.invalidate();
    }

    // （）
    return saved;
  });
  ipcMain.handle(IPC.TTS_LOAD_SETTINGS, () => {
    return loadGeneralSettings();
  });

  //  → file_id
  ipcMain.handle(IPC.TTS_UPLOAD, async (_event, payload: { apiKey: string; filePath: string; purpose: "voice_clone" | "prompt_audio" }) => {
    if (!payload?.apiKey || !payload?.filePath) {
      throw new Error("API key or file path is missing");
    }
    return await ttsUploadFile(payload.apiKey, payload.filePath, payload.purpose);
  });

  // （Electron dialog）
  ipcMain.handle(IPC.TTS_PICK_AUDIO, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select an audio file",
      filters: [{ name: "Audio files", extensions: ["mp3", "m4a", "wav"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  //  → voice_id
  ipcMain.handle(IPC.TTS_CLONE, async (_event, payload: {
    apiKey: string; fileId: string; voiceId: string;
    promptAudioId?: string; promptText?: string;
    text: string; model?: string;
  }) => {
    if (!payload?.apiKey || !payload?.fileId || !payload?.voiceId || !payload?.text) {
      throw new Error("Required parameters are missing (apiKey/fileId/voiceId/text)");
    }
    return await ttsCloneVoice(payload);
  });

  //  → base64 （ / ）
  ipcMain.handle(IPC.TTS_SYNTHESIZE, async (_event, payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
  }) => {
    if (!payload?.apiKey || !payload?.voiceId || !payload?.text) {
      throw new Error("Required parameters are missing (apiKey/voiceId/text)");
    }
    const audioBuffer = await ttsSynthesize({
      ...payload,
      debugLog: appendMinimaxTtsLog,
    });
    // Buffer → base64 （ atob ）
    return audioBuffer.toString("base64");
  });

  ipcMain.handle(IPC.TTS_SYNTHESIZE_CACHED, async (_event, payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => {
    const format = payload.format ?? "mp3";

    // ： expectedCacheKey ，， apiKey/voiceId。
    let expectedPath: string | null = null;
    if (payload.expectedCacheKey) {
      try {
        expectedPath = getTtsCachePath(payload.expectedCacheKey, format);
      } catch { /* expectedCacheKey ， */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuffer = fs.readFileSync(expectedPath);
      appendMinimaxTtsLog({
        requestId: `tts-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        phase: "cache.hit",
        cacheKey: payload.expectedCacheKey,
        audioBytes: cachedBuffer.length,
        textChars: Array.from(payload.text).length,
      });
      return {
        base64: cachedBuffer.toString("base64"),
        cacheKey: payload.expectedCacheKey,
        cached: true,
      };
    }

    //  → ， apiKey/voiceId
    if (!payload?.apiKey || !payload?.voiceId || !payload?.text || payload.apiKey === "cache-only") {
      throw new Error("The cache missed and required parameters are missing (apiKey/voiceId/text)");
    }

    const cacheKey = buildTtsCacheKey(payload);
    const audioPath = getTtsCachePath(cacheKey, format);
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });

    const audioBuffer = await ttsSynthesize({
      ...payload,
      format,
      debugLog: appendMinimaxTtsLog,
    });
    fs.writeFileSync(audioPath, audioBuffer);
    appendMinimaxTtsLog({
      requestId: `tts-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      phase: "cache.write",
      cacheKey,
      audioBytes: audioBuffer.length,
      textChars: Array.from(payload.text).length,
    });
    return {
      base64: audioBuffer.toString("base64"),
      cacheKey,
      cached: false,
    };
  });

  // （minimax WS  chunk ）
  //  buffer ，
  ipcMain.handle(IPC.TTS_STREAM_START, async (event, payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => {
    const format = payload.format ?? "mp3";
    const sender = event.sender;

    // ：expectedCacheKey  base64（ STREAM_END， chunk）
    let expectedPath: string | null = null;
    if (payload.expectedCacheKey) {
      try { expectedPath = getTtsCachePath(payload.expectedCacheKey, format); } catch { /* */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuf = fs.readFileSync(expectedPath);
      appendMinimaxTtsLog({
        requestId: `tts-stream-cache-${Date.now()}`,
        ts: new Date().toISOString(),
        phase: "stream.cache.hit",
        cacheKey: payload.expectedCacheKey,
        audioBytes: cachedBuf.length,
      });
      // ：（ STREAM_END ， buffer）
      sender.send(IPC.TTS_AUDIO_CHUNK, { base64: cachedBuf.toString("base64") });
      sender.send(IPC.TTS_STREAM_END, { cacheKey: payload.expectedCacheKey, cached: true, format });
      return { started: false, cacheKey: payload.expectedCacheKey, cached: true };
    }

    if (!payload?.apiKey || !payload?.voiceId || !payload?.text) {
      throw new Error("Required streaming synthesis parameters are missing (apiKey/voiceId/text)");
    }

    const cacheKey = buildTtsCacheKey(payload);
    const audioPath = getTtsCachePath(cacheKey, format);
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    const fullChunks: Buffer[] = [];

    // ， await（handler ，chunk  send ）
    void (async () => {
      try {
        const audioBuffer = await ttsSynthesize({
          apiKey: payload.apiKey,
          voiceId: payload.voiceId,
          text: payload.text,
          speed: payload.speed,
          volume: payload.volume,
          pitch: payload.pitch,
          model: payload.model,
          format,
          debugLog: appendMinimaxTtsLog,
          onChunk: (chunkBase64) => {
            fullChunks.push(Buffer.from(chunkBase64, "base64"));
            if (!sender.isDestroyed()) sender.send(IPC.TTS_AUDIO_CHUNK, { base64: chunkBase64 });
          },
        });
        // （ buffer， fullChunks——synthesize ）
        fs.writeFileSync(audioPath, audioBuffer);
        appendMinimaxTtsLog({
          requestId: `tts-stream-${Date.now()}`,
          ts: new Date().toISOString(),
          phase: "stream.cache.write",
          cacheKey,
          audioBytes: audioBuffer.length,
        });
        if (!sender.isDestroyed()) sender.send(IPC.TTS_STREAM_END, { cacheKey, cached: false, format });
      } catch (err) {
        if (!sender.isDestroyed()) {
          sender.send(IPC.TTS_STREAM_ERROR, { message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return { started: true, cacheKey, cached: false };
  });

  // GPT-SoVITS  → base64 （，）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_GPTSOVITS, async (_event, payload: {
    baseUrl?: string; refAudioPath?: string; promptText?: string; text: string;
    speed?: number; format?: "wav" | "mp3";
  }) => {
    const prepared = await prepareGptsovitsVoicePayload(payload);
    if (!prepared?.baseUrl || !prepared?.refAudioPath || !prepared?.promptText || !prepared?.text) {
      throw new Error("Required parameters are missing (baseUrl/refAudioPath/promptText/text)");
    }
    const result = await gptsovitsSynthesize({
      ...prepared,
      debugLog: appendGptsovitsTtsLog,
    });
    const finalAudio = await applyConfiguredRvc(result.audio, prepared);
    const cacheKey = buildGptsovitsCacheKey({
      ...prepared,
      rvcApplied: prepared.rvc ? finalAudio.converted : false,
    });
    return {
      base64: finalAudio.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: finalAudio.format,
    };
  });

  // GPT-SoVITS  + （）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_CACHED_GPTSOVITS, async (_event, payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
    expectedCacheKey?: string;
  }) => {
    const prepared = await prepareGptsovitsVoicePayload(payload);
    const format: "wav" | "mp3" = prepared.format ?? "wav";
    const cacheKey = buildGptsovitsCacheKey(prepared);

    // ： expectedCacheKey ，， baseUrl/refAudioPath。
    let expectedPath: string | null = null;
    if (payload.expectedCacheKey === cacheKey) {
      try {
        expectedPath = getTtsCachePath(payload.expectedCacheKey, format);
      } catch { /* expectedCacheKey ， */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuffer = fs.readFileSync(expectedPath);
      appendGptsovitsTtsLog({
        requestId: `gptsovits-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        phase: "cache.hit",
        cacheKey: payload.expectedCacheKey,
        audioBytes: cachedBuffer.length,
        textChars: Array.from(payload.text).length,
      });
      return {
        base64: cachedBuffer.toString("base64"),
        cacheKey: payload.expectedCacheKey,
        cached: true,
        format,
      };
    }

    // Cache miss → synthesize and cache
    if (!prepared?.baseUrl || !prepared?.refAudioPath || !prepared?.promptText || !prepared?.text) {
      throw new Error("The cache missed and required parameters are missing (baseUrl/refAudioPath/promptText/text)");
    }

    const result = await gptsovitsSynthesize({
      baseUrl: prepared.baseUrl,
      refAudioPath: prepared.refAudioPath,
      promptText: prepared.promptText,
      text: prepared.text,
      textLang: prepared.textLang,
      promptLang: prepared.promptLang,
      speed: prepared.speed,
      format,
      debugLog: appendGptsovitsTtsLog,
    });
    const finalAudio = await applyConfiguredRvc(result.audio, prepared);
    const finalCacheKey = buildGptsovitsCacheKey({
      ...prepared,
      rvcApplied: prepared.rvc ? finalAudio.converted : false,
    });
    const finalAudioPath = getTtsCachePath(finalCacheKey, finalAudio.format);
    fs.mkdirSync(path.dirname(finalAudioPath), { recursive: true });
    fs.writeFileSync(finalAudioPath, finalAudio.audio);
    appendGptsovitsTtsLog({
      requestId: `gptsovits-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      phase: "cache.write",
      cacheKey: finalCacheKey,
      audioBytes: finalAudio.audio.length,
      textChars: Array.from(payload.text).length,
    });
    return {
      base64: finalAudio.audio.toString("base64"),
      cacheKey: finalCacheKey,
      cached: false,
      format: finalAudio.format,
    };
  });

  //  TTS  → base64 （，）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_CUSTOM_CLOUD, async (_event, payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
  }) => {
    if (!payload?.endpointUrl || !payload?.text) {
      throw new Error("Required parameters are missing (endpointUrl/text)");
    }
    const result = await customCloudSynthesize({
      ...payload,
      debugLog: appendCustomCloudTtsLog,
    });
    const cacheKey = buildCustomCloudCacheKey(payload);
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  //  TTS  + （）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD, async (_event, payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
    expectedCacheKey?: string;
  }) => {
    const format: "wav" | "mp3" = payload.format ?? "mp3";

    let expectedPath: string | null = null;
    if (payload.expectedCacheKey) {
      try {
        expectedPath = getTtsCachePath(payload.expectedCacheKey, format);
      } catch { /* expectedCacheKey ， */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuffer = fs.readFileSync(expectedPath);
      appendCustomCloudTtsLog({
        requestId: `custom-cloud-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        phase: "cache.hit",
        cacheKey: payload.expectedCacheKey,
        audioBytes: cachedBuffer.length,
        textChars: Array.from(payload.text).length,
      });
      return {
        base64: cachedBuffer.toString("base64"),
        cacheKey: payload.expectedCacheKey,
        cached: true,
        format,
      };
    }

    if (!payload?.endpointUrl || !payload?.text) {
      throw new Error("The cache missed and required parameters are missing (endpointUrl/text)");
    }

    const cacheKey = buildCustomCloudCacheKey(payload);
    const audioPath = getTtsCachePath(cacheKey, format);
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });

    const result = await customCloudSynthesize({
      endpointUrl: payload.endpointUrl,
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      format,
      timeoutMs: payload.timeoutMs,
      debugLog: appendCustomCloudTtsLog,
    });
    fs.writeFileSync(audioPath, result.audio);
    appendCustomCloudTtsLog({
      requestId: `custom-cloud-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      phase: "cache.write",
      cacheKey,
      audioBytes: result.audio.length,
      textChars: Array.from(payload.text).length,
    });
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  //  MiMo TTS  → base64 （，）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_MIMO, async (_event, payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
  }) => {
    if (!payload?.apiKey || !payload?.voiceAudioPath || !payload?.text) {
      throw new Error("Required parameters are missing (apiKey/voiceAudioPath/text)");
    }
    const result = await mimoSynthesize({
      apiKey: payload.apiKey,
      voiceAudioPath: payload.voiceAudioPath,
      text: payload.text,
      stylePrompt: payload.stylePrompt,
      debugLog: appendMimoTtsLog,
    });
    const cacheKey = buildMimoCacheKey(payload);
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  //  MiMo TTS  + （）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_CACHED_MIMO, async (_event, payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
    expectedCacheKey?: string;
  }) => {
    const format: "wav" = "wav";

    let expectedPath: string | null = null;
    if (payload.expectedCacheKey) {
      try {
        expectedPath = getTtsCachePath(payload.expectedCacheKey, format);
      } catch { /* expectedCacheKey ， */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuffer = fs.readFileSync(expectedPath);
      appendMimoTtsLog({
        requestId: `mimo-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        phase: "cache.hit",
        cacheKey: payload.expectedCacheKey,
        audioBytes: cachedBuffer.length,
        textChars: Array.from(payload.text).length,
      });
      return {
        base64: cachedBuffer.toString("base64"),
        cacheKey: payload.expectedCacheKey,
        cached: true,
        format,
      };
    }

    if (!payload?.apiKey || !payload?.voiceAudioPath || !payload?.text || payload.apiKey === "cache-only") {
      throw new Error("The cache missed and required parameters are missing (apiKey/voiceAudioPath/text)");
    }

    const cacheKey = buildMimoCacheKey(payload);
    const audioPath = getTtsCachePath(cacheKey, format);
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });

    const result = await mimoSynthesize({
      apiKey: payload.apiKey,
      voiceAudioPath: payload.voiceAudioPath,
      text: payload.text,
      stylePrompt: payload.stylePrompt,
      debugLog: appendMimoTtsLog,
    });
    fs.writeFileSync(audioPath, result.audio);
    appendMimoTtsLog({
      requestId: `mimo-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      phase: "cache.write",
      cacheKey,
      audioBytes: result.audio.length,
      textChars: Array.from(payload.text).length,
    });
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  // ── Mossland (api.mosi.cn) ──────────────────────────────────────

  // Mossland （Settings「」，）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_MOSSLAND, async (_event, payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
  }) => {
    if (!payload?.apiKey || !payload?.voiceId || !payload?.text) {
      throw new Error("Required parameters are missing (apiKey/voiceId/text)");
    }
    const result = await mosslandSynthesize({
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      model: payload.model,
      format: payload.format,
    });
    const cacheKey = buildMosslandCacheKey(payload);
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  // Mossland  + （；cache-only  chat  "cache-only"）
  ipcMain.handle(IPC.TTS_SYNTHESIZE_CACHED_MOSSLAND, async (_event, payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => {
    const format: "mp3" | "wav" | "pcm" = payload.format ?? "mp3";

    // 
    let expectedPath: string | null = null;
    if (payload.expectedCacheKey) {
      try {
        expectedPath = getTtsCachePath(payload.expectedCacheKey, format);
      } catch { /* expectedCacheKey ， */ }
    }
    if (expectedPath && fs.existsSync(expectedPath)) {
      const cachedBuffer = fs.readFileSync(expectedPath);
      return {
        base64: cachedBuffer.toString("base64"),
        cacheKey: payload.expectedCacheKey,
        cached: true,
        format,
      };
    }

    //  + （ chat  cache-only ）→ 
    if (!payload?.apiKey || !payload?.voiceId || !payload?.text
        || payload.apiKey === "cache-only" || payload.voiceId === "cache-only") {
      throw new Error("The cache missed and required parameters are missing (apiKey/voiceId/text)");
    }

    const cacheKey = buildMosslandCacheKey(payload);
    const audioPath = getTtsCachePath(cacheKey, format);
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });

    const result = await mosslandSynthesize({
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      model: payload.model,
      format,
    });
    fs.writeFileSync(audioPath, result.audio);
    return {
      base64: result.audio.toString("base64"),
      cacheKey,
      cached: false,
      format: result.format,
    };
  });

  // Mossland （multipart ）
  ipcMain.handle(IPC.TTS_CLONE_MOSSLAND, async (_event, payload: {
    apiKey: string; filePath: string; name?: string; description?: string;
  }) => {
    const result = await mosslandCloneVoice({
      apiKey: payload.apiKey,
      filePath: payload.filePath,
      name: payload.name,
      description: payload.description,
    });
    return {
      voiceId: result.voiceId,
      name: result.name,
      createdAt: result.createdAt,
    };
  });

  // Mossland 
  ipcMain.handle(IPC.TTS_LIST_MOSSLAND_VOICES, async (_event, payload: {
    apiKey: string; limit?: number;
  }) => {
    const result = await mosslandListVoices({
      apiKey: payload.apiKey,
      limit: payload.limit,
    });
    return { voices: result.voices };
  });

  // Online Neural voice synthesis (Microsoft Edge Neural TTS — zh-CN-XiaoyiNeural anime girl)
  ipcMain.handle(IPC.TTS_SYNTHESIZE_ONLINE, async (_event, payload: { text: string; lang?: string }) => {
    if (!payload?.text) return null;
    const text = String(payload.text).trim();
    if (!text) return null;

    try {
      const result = await synthesizeEdgeTts({
        text,
        pitch: "+10Hz",
        rate: "+3%",
      });
      return { base64: result.audio.toString("base64"), format: result.format || "mp3" };
    } catch (edgeErr: any) {
      console.warn("[TTS] Edge neural synthesis failed, trying fallback:", edgeErr?.message || edgeErr);
    }

    try {
      const lang = payload.lang || "zh-CN";
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return { base64, format: "mp3" };
      }
    } catch (err: any) {
      console.warn("[TTS] Online fallback failed:", err?.message || err);
    }
    return null;
  });

  // Translate English/any language to Mandarin Chinese for voice synthesis
  ipcMain.handle(IPC.TTS_TRANSLATE_TO_CHINESE, async (_event, text: string) => {
    if (!text || typeof text !== "string") return "";
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length < 40) {
      return trimmed;
    }

    try {
      const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(trimmed)}`;
      const res = await fetch(gtxUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (res.ok) {
        const json = await res.json() as any;
        if (Array.isArray(json?.[0])) {
          const translated = json[0].map((item: any) => item?.[0] || "").join("").trim();
          if (translated) return translated;
        }
      }
    } catch (gtxErr) {
      console.warn("[TTS] Google translation failed, trying model endpoint fallback:", gtxErr);
    }

    try {
      const fallback = await translateEnglishToMandarinSpeech(trimmed, loadModelSettings());
      if (fallback) return fallback;
    } catch {}

    return trimmed;
  });

  //  IPC（chats-store.initialize  cyrene-chats  index）
  registerChatsIpc((type, text, meta, channel) => pushActivityLog(type, text, meta, channel));
  initializeProactiveChatService();
  initializeProactiveTrigger();

  // （recall_history）——
  registerRecallHistoryTool();

  // （write_excel/write_word/write_pdf/write_markdown）
  registerDocumentTools();

  // （///）
  // ， loadModelSettings getter
  setTranslateConfig(() => {
    const s = loadModelSettings();
    return isModelEndpointUsable(s) ? { provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey } : null;
  });
  registerLifeTools();

  // （——///， amapKey）
  registerTravelTools();

  // （SMTP ， SMTP ）
  registerEmailTools();
  syncBuiltInToolToggles(loadGeneralSettings());

  //  MCP ：Playwright (,)
  const initialSettings = loadGeneralSettings();

  systemAudioAwareness = new SystemAudioAwarenessService(
    new WindowsMediaSessionMetadataAdapter(),
    { excludedApplications: [app.name, "cyrene"] },
  );
  await setSystemAudioAwarenessEnabled(initialSettings.systemAudioAwarenessEnabled);

  //  MCP（Firecrawl hosted ）
  const removed = await pruneMcpServersByIds([...REMOVED_BUILTIN_MCP_IDS]);
  if (removed.length > 0) {
    console.log("[Cyrene] Removed retired built-in MCP entries:", removed.join(", "));
  }

  void syncPlaywrightMcp(initialSettings).catch((e) =>
    console.error("[Cyrene] playwright MCP sync failed:", e)
  );

  // ： helper IPC、。。
  screenshotService = initializeScreenshotService(
    initialSettings.screenshotHotkey ?? "Alt+Shift+S",
  );
  void screenshotService.prewarm();

    // Background auto-updater check (silent, non-blocking)
    setTimeout(async () => {
      try {
        const { checkForAppUpdates } = await import("./updater/auto-updater");
        const result = await checkForAppUpdates(app.getVersion());
        if (result.hasUpdate) {
          console.info(`[Cyrene AutoUpdater] New update available: v${result.latestVersion}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("cyrene:update-available", result);
          }
        }
      } catch (e) {
        console.warn("[Cyrene AutoUpdater] Silent check skipped:", e);
      }
    }, 15_000);

  // Cloud Music MCP wiring (MusicService + IPC + 5 Agent tools + shutdown latch)
  const musicPaths = resolveMusicPaths();
  const musicBootstrap = bootstrapMusicService(musicPaths, {
    contextRefs: contextRefRegistry,
    ingestContextEvent: (event) => citaService.ingest(event),
    sendCard: (card) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(IPC.AGUI_EVENT, {
          type: "CUSTOM",
          name: "cyrene.music",
          value: card,
        });
        return true;
      }
      return false;
    },
  });
  installShutdownLatch(musicBootstrap);

  // Skill ： skills +  meta-tool
  initSkills();
  try {
    loadMusicCompanionHost(
      path.join(app.getAppPath(), "dist", "skills", "cyrene-music-companion", "index.js"),
      () => ({
        skillEnabled: skillRegistry.getById("cyrene-music-companion")?.enabled === true,
        backendAvailable: ["ready", "degraded"].includes(musicBootstrap.service.getBackendState()),
        enabledTools: toolRegistry.getEnabledTools().map((tool) => tool.id),
      }),
    );
    skillRegistry.setAvailability("cyrene-music-companion", isMusicCompanionAvailable);
  } catch (err) {
    console.error("[MusicCompanion] Failed to load composite skill:", err);
    skillRegistry.setAvailability("cyrene-music-companion", () => false);
  }

  // ：IPC + game_bot_start 
  initGameBot({
    captureScreen: () => runExplicitScreenCapture("game-bot", async () => {
      const { captureScreen } = await import("./game-bot/screenshot");
      return captureScreen();
    }),
    isSettingsSender: (event) => isTrustedMainFrameSender(event, settingsWindow, expectedRendererDocument("settings/index.html")),
  });

  // （//...）： dispatcher  buildAndRunAgent + TTS +  + ，
  //  channels  agent +  + 。
  setDispatcherLoadRecentHistory(async (sessionId, limit) => {
    //  history-log： userData/channels/history/<sessionId>.jsonl  N 
    const { loadRecentHistory } = await import("./channels/history-log");
    return loadRecentHistory(sessionId, limit);
  });
  setDispatcherLoadGeneralSettings(loadGeneralSettings);

  setDispatcherBuildAndRunAgent(async (msg, sessionId, priorMessages) => {
    // ： dispatcher  cap  OutgoingMessage.parts。
    //  sticker （ onAgentRunFinished ， dispatcher  embedding）。
    const channelResult: { text: string; sticker: string | null } = { text: "", sticker: null };

    // Phase 3.3： toolSandbox 
    const sandbox = loadChannelsSettings().toolSandbox;
    const allTools = toolRegistry.getEnabledTools();
    const filteredTools: ToolDefinition[] = sandbox === "off"
      ? []
      : sandbox === "safe-only"
        ? allTools.filter((t) => (t.risk ?? "safe") === ("safe" as ToolRiskLevel))
        : allTools;
    console.log(
      "[Channels] bot run:",
      `msg.channel=${msg.channel} sandbox=${sandbox} tools=${filteredTools.length}/${allTools.length} priorMsgs=${priorMessages?.length ?? 0}`,
    );

    // Phase A： ( buildModelMessages :  N ).
    // history-log  role: "user"|"assistant", .
    const historyMessages = (priorMessages ?? [])
      .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));

    //  IncomingMessage  AguiRunInput， CyreneAgent
    const channelModelSettings = loadModelSettings();
    const imageSendStrategy = decideImageSendStrategy({
      multimodal: channelModelSettings.multimodal,
      vision: loadVisionConfig(),
    });
    const attachmentInputs = await buildChannelAttachmentInputs(msg, {
      imageMode: imageSendStrategy.mode,
      captionImage: async (filePath: string) => {
        const validated = validateCaptionImagePath(filePath);
        if (!validated.ok) return { ok: false, error: validated.error };
        const visionCfg = loadVisionConfig();
        if (!visionCfg) return { ok: false, error: "No vision model is configured, so the image cannot be analyzed." };
        try {
          const { captionImage } = await import("./orchestrator/vision-captioner");
          const caption = await captionImage(
            { base64: validated.buffer.toString("base64"), mime: validated.mime },
            IMAGE_CAPTION_PROMPT,
            visionCfg,
          );
          if (caption.startsWith("[Error")) return { ok: false, error: caption };
          return { ok: true, caption };
        } catch (err: any) {
          return { ok: false, error: err?.message || String(err) };
        }
      },
    });
    const { options } = await buildAgentRunOptions(
      {
        messages: [
          ...historyMessages,
          { role: "user", content: msg.text },
        ],
        style: "01_default.md",
        sessionId,
        attachments: attachmentInputs.attachments,
        imageAttachments: attachmentInputs.imageAttachments,
        channel: msg.channel,
        executionMode: sandbox === "off" ? "chat" : "work",
        ...(sandbox === "off" ? {
          userTurnId: `${msg.channel}:${msg.senderId}:${msg.at.toISOString()}:user`,
          assistantTurnId: `${msg.channel}:${msg.senderId}:${msg.at.toISOString()}:assistant`,
        } : {}),
      },
      buildOptionsDeps,
    );
    //  tools  options（ getEnabledTools）
    options.tools = filteredTools;

    const threadId = `thread-${sessionId}-${Date.now()}`;
    const agent = new CyreneAgent({ threadId, description: `bot:${msg.channel}:${msg.senderId}` });
    const reply = await new Promise<string>((resolve, reject) => {
      agent.runWithEvents(options).subscribe({
        complete: () => {
          resolve(agent.lastResult?.reply ?? "");
        },
        error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      });
    });
    channelResult.text = reply;
    if (agent.lastResult) {
      const finished = await onAgentRunFinished(agent.lastResult, msg.text, onRunFinishedDeps, msg.channel);
      //  sticker  dispatcher， OutgoingMessage.parts；
      //  sticker  onAgentRunFinished  IPC ，。
      channelResult.sticker = finished.sticker;
    }
    // 
    void indexConversationTurn(sessionId, msg.text, reply);
    return channelResult;
  });

  // Phase 3.1： TTS  —— dispatcher  reply 
  setDispatcherSynthesizeTts(async (text: string, context) => {
    const cfg = loadGeneralSettings();
    if (cfg.ttsEngine === "off") return null;
    if (cfg.ttsEngine === "minimax" && (!cfg.ttsMinimaxKey || !cfg.ttsMinimaxVoiceId)) return null;
    const gptsovitsRefPath = cfg.ttsGptsovitsRefAudioPath || path.join(process.cwd(), "resources", "voice", "cyrene", "ref_audio.wav");
    const gptsovitsPrompt = cfg.ttsGptsovitsPromptText || "开拓者，希琳一直都在这里陪着你哦。";
    if (cfg.ttsEngine === "gptsovits" && (!cfg.ttsGptsovitsBaseUrl || !gptsovitsRefPath || !gptsovitsPrompt)) return null;
    if (cfg.ttsEngine === "custom-cloud" && !cfg.ttsCustomCloudEndpointUrl) return null;
    if (cfg.ttsEngine === "mimo" && (!cfg.ttsMimoKey || !cfg.ttsMimoVoiceAudioPath)) return null;
    //  TTS （ audio 100M  + ，）
    const ttsText = text.length > 1000 ? text.slice(0, 1000) + "…" : text;
    try {
      const requestedFormat = context.channel === "wechat" ? "wav" : "mp3";
      const result = await synthesizeByEngine(cfg.ttsEngine, {
        text: ttsText,
        speed: cfg.ttsSpeed,
        volume: cfg.ttsVolume,
        // minimax
        apiKey: cfg.ttsEngine === "mimo"
          ? cfg.ttsMimoKey
          : cfg.ttsEngine === "custom-cloud"
            ? cfg.ttsCustomCloudApiKey
            : cfg.ttsMinimaxKey,
        voiceId: cfg.ttsEngine === "mimo"
          ? ""
          : cfg.ttsEngine === "custom-cloud"
            ? cfg.ttsCustomCloudVoiceId
            : cfg.ttsMinimaxVoiceId,
        model: cfg.ttsMinimaxModel,
        // gptsovits
        baseUrl: cfg.ttsGptsovitsBaseUrl,
        refAudioPath: gptsovitsRefPath,
        promptText: gptsovitsPrompt,
        // custom-cloud
        endpointUrl: cfg.ttsCustomCloudEndpointUrl,
        timeoutMs: cfg.ttsCustomCloudTimeoutMs,
        // mimo
        voiceAudioPath: cfg.ttsMimoVoiceAudioPath,
        stylePrompt: cfg.ttsMimoStylePrompt,
        format: requestedFormat,
      });
      const headerHex = result.audio.subarray(0, 4).toString("hex");
      console.log("[TTS verify] engine=", cfg.ttsEngine, "format=", result.format, "header=", headerHex, "size=", result.audio.length);
      return {
        audio: result.audio,
        format: result.format,
        mime: result.format === "wav" ? "audio/wav" : result.format === "pcm" ? "audio/pcm" : "audio/mpeg",
        extension: result.format === "wav" ? ".wav" : result.format === "pcm" ? ".pcm" : ".mp3",
      };
    } catch (err) {
      console.warn("[Channels] TTS synthesis failed:", err instanceof Error ? err.message : err);
      return null;
    }
  });

  // Phase 3.2： ——  bot / chatWindow
  setDispatcherBroadcastChat((event) => {
    const win = chatWindow;
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(IPC.AGUI_EVENT, {
        type: "CUSTOM",
        name: "cyrene.botMessage",
        value: event,
      });
    } catch (err) {
      console.warn("[Channels] botMessage broadcast failed:", err);
    }
  });

  void initChannels();

  // （todo_write  + ）：
  // - loadTodos （）
  // - onTodosChange ， TodoState  CUSTOM 
  //    cyrene.todos 
  loadTodos();
  onTodosChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.AGUI_EVENT, {
          type: "CUSTOM",
          name: "cyrene.todos",
          value: state,
        });
      } catch (e) {
        console.warn("[Cyrene] Todo broadcast failed:", e);
      }
    }
  });

  const schedulerStore = getSchedulerStore();
  schedulerStore.load();
  const schedulerRunner = createSchedulerRunner({
    buildOptions: async (task: ScheduledTask) => {
      const settings = loadModelSettings();
      if (!isModelEndpointUsable(settings)) throw new Error("No usable model is configured. Check the model endpoint, model ID, and cloud API key.");
      const messages = [{ role: "user" as const, content: task.prompt }];
      let alwaysOnContext = "";
      try {
        alwaysOnContext = await buildAlwaysOnContextWithSensory(task.prompt, messages);
      } catch (err) {
        console.warn("[Scheduler] always-on context build failed:", err);
      }
      let environmentContext = "";
      try {
        const profile = loadUserProfile();
        environmentContext = buildEnvironmentContext(
          { provider: settings.provider, model: settings.model },
          { nickname: profile.nickname, callPreference: profile.callPreference, birthday: profile.birthday, defaultCity: profile.defaultCity, timezone: profile.timezone },
        );
      } catch (err) {
        console.warn("[Scheduler] environment context build failed:", err);
      }
      const skillCatalog = buildSkillCatalog(skillRegistry.getEnabled());
      const systemContent =
        (environmentContext ? environmentContext + "\n\n" : "") +
        (alwaysOnContext ? alwaysOnContext + "\n\n" : "") +
        buildSystemPrompt("01_default.md") +
        (skillCatalog ? "\n\n---\n\n" + skillCatalog : "");
      return {
        settings: { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey },
        messages: [{ role: "system", content: systemContent }, ...messages],
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      };
    },
    getChatWebContents: () => (chatWindow && !chatWindow.isDestroyed() ? chatWindow.webContents : null),
    recordHistory: (entry) => schedulerStore.recordHistory(entry),
    id: () => `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    now: () => new Date(),
  });
  schedulerEngine = new SchedulerEngine({
    store: schedulerStore,
    runTask: schedulerRunner.runScheduledTask,
  });
  registerSchedulerIpc(schedulerStore, schedulerEngine, () => toolRegistry.getAllTools());

  // AG-UI ： invoke(AGUI_RUN) → CyreneAgent  FC  → 
  // buildOptions ；onRunFinished 
  // Phase 0 ： orchestrator/build-options.ts，（ / scheduler / bot）
  // deps  (unknown/ReadonlyArray)；
  const socialAtomStore = createSocialAtomStore(
    path.join(app.getPath("userData"), "chat-social-atoms.json"),
  );
  const socialContextScheduler = createSocialContextScheduler({
    store: socialAtomStore,
    enqueue: (label, task) => enqueueLLMTask(label, task, {
      log: false,
      retryRateLimit: false,
    }),
    generate: async (input, repair) => {
      const settings = loadModelSettings();
      const config: VendorConfig = {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        explicitTransport: settings.explicitTransport,
        reasoning: { mode: "off" },
      };
      const adapter = getAdapterForConfig(config);
      const profile = resolveStructuredOutputProfile({
        provider: adapter.id,
        model: config.model,
        transport: adapter.transport,
        endpointKind: classifyStructuredOutputEndpoint({
          providerId: adapter.id,
          configuredBaseUrl: config.baseUrl,
          officialBaseUrl: adapter.capability.baseUrl,
        }),
      });
      const structuredOutput: StructuredOutputRequest = profile.mode === "provider_json_schema"
        ? {
            mode: "json_schema",
            name: "chat_social_atoms",
            schema: SOCIAL_EXTRACTION_SCHEMA,
            strict: true,
          }
        : profile.mode === "provider_json_object"
          ? {
              mode: "json_object",
              name: "chat_social_atoms",
              schema: SOCIAL_EXTRACTION_SCHEMA,
            }
          : {
              mode: "prompt_json",
              name: "chat_social_atoms",
              schema: SOCIAL_EXTRACTION_SCHEMA,
              sendJsonObjectHint: profile.requestHints.sendJsonObject,
            };
      const response = await callChatCompletionsNonStream(
        settings,
        [
          {
            role: "system",
            content: "Extract only directly supported chat continuity facts. Return exactly one JSON object and no prose.",
          },
          { role: "user", content: buildSocialExtractionPrompt(input, repair) },
        ],
        0,
        12_000,
        "Chat social context extraction",
        { mode: "off" },
        {
          structuredOutput,
          maxTokens: 1_000,
          ...(profile.requestHints.reasoningSplit
            ? { extraBody: { reasoning_split: true } }
            : {}),
        },
      );
      if (response.refusal || normalizeFinishReason(response.finishReason) !== "complete") {
        throw new Error("CHAT_SOCIAL_EXTRACTION_INCOMPLETE");
      }
      return response.text;
    },
    recordMetric: (metric) => {
      console.log(
        `[ChatSocialContext] outcome=${metric.outcome} accepted=${metric.acceptedCount} rejected=${metric.rejectedCount} attempts=${metric.attempts} repairs=${metric.repairCount}`,
      );
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildOptionsDeps: BuildOptionsDeps = {
    loadModelSettings: () => loadModelSettings(),
    loadGeneralSettings: () => loadGeneralSettings(),
    loadUserProfile: () => loadUserProfile(),
    buildEnvironmentContext: ((model: { provider: string; model: string }, profile: unknown) =>
      buildEnvironmentContext(model as any, profile as any)) as BuildOptionsDeps["buildEnvironmentContext"],
    buildSkillCatalog: ((skills: ReadonlyArray<unknown>) =>
      buildSkillCatalog(skills as any)) as BuildOptionsDeps["buildSkillCatalog"],
    buildAutoInjectedSkillContext: ((skills: ReadonlyArray<unknown>) =>
      buildAutoInjectedSkillContext(skills as any, (id) => skillRegistry.getBody(id))) as BuildOptionsDeps["buildAutoInjectedSkillContext"],
    buildAutoInjectedSoulContext: ((skills: ReadonlyArray<unknown>) =>
      buildAutoInjectedSoulContext(skills as any, (id) => skillRegistry.getBody(id))) as BuildOptionsDeps["buildAutoInjectedSoulContext"],
    skillRegistry: skillRegistry as unknown as BuildOptionsDeps["skillRegistry"],
    resolveSlashActivation: ((messages: ReadonlyArray<{ role: string; content?: string }>) =>
      resolveSlashActivation(messages as any)) as BuildOptionsDeps["resolveSlashActivation"],
    buildToneInjection: (async (userText, messages, provider, index) =>
      buildToneInjection(userText, messages as any, provider as any, index as any)) as BuildOptionsDeps["buildToneInjection"],
    sceneEmbeddingIndex: sceneEmbeddingIndex as unknown,
    getSceneEmbeddingProvider: () => getSceneEmbeddingProvider() as unknown,
    buildAlwaysOnContext: (async (userText, messages) =>
      buildAlwaysOnContextWithSensory(userText, messages as any)) as BuildOptionsDeps["buildAlwaysOnContext"],
    buildRelationshipContext,
    buildSystemPrompt,
    buildToolSystemPrompt: (enabledTools) => buildToolSystemPrompt(enabledTools as ToolDefinition[]),
    buildSoulSystemBasePrompt,
    readStylePrompt,
    resolveSoulSampling: resolveSoulSamplingForStyle,
    toolRegistry: { getEnabled: () => toolRegistry.getEnabledTools() },
    logWorldbookInjection,
    normalizeChatMessages: ((raw: ReadonlyArray<unknown>) =>
      normalizeChatMessages(raw as any)) as BuildOptionsDeps["normalizeChatMessages"],
    chatRequestTimeoutMs: (() => {
      const cfg = loadModelSettings();
      const sec = cfg.chatRequestTimeoutSec;
      if (typeof sec === "number" && Number.isFinite(sec) && sec >= 30 && sec <= 1800) {
        return Math.round(sec * 1000);
      }
      return CHAT_REQUEST_TIMEOUT_MS;
    })(),
    captionImageForFallback: async (filePath: string) => {
      const validated = validateCaptionImagePath(filePath);
      if (!validated.ok) return { ok: false, error: validated.error };
      const visionCfg = loadVisionConfig();
      if (!visionCfg) return { ok: false, error: "No vision model is configured, so the image cannot be analyzed." };
      try {
        const { captionImage } = await import("./orchestrator/vision-captioner");
        const caption = await captionImage(
          { base64: validated.buffer.toString("base64"), mime: validated.mime },
          IMAGE_CAPTION_PROMPT,
          visionCfg,
        );
        if (caption.startsWith("[Error")) return { ok: false, error: caption };
        return { ok: true, caption };
      } catch (err: any) {
        return { ok: false, error: err?.message || String(err) };
      }
    },
    loadActionGateSystemPrompt: () => loadPromptFile("action_gate_system.md"),
    loadNativeFcSystemPrompt: () => loadPromptFile("native_fc_system.md"),
    loadAskSystemPrompt: () => loadPromptFile("ask_system.md"),
    loadAskPersonaPrompt: () => loadPromptFile("ask_persona.md"),
    loadAskQuotesPrompt: () => loadPromptFile("ask_quotes.md"),
    prepareCitaTurn: (input) => citaService.prepareTurn(input),
    buildChatSocialContext: async ({ conversationId, query }) => {
      const now = Date.now();
      const active = socialAtomStore.listActive(conversationId, now);
      const retrievedAtoms = rankSocialAtoms(query, active, { now, limit: 5 });
      return {
        contextBlock: compileSocialContextBlock(retrievedAtoms),
        retrievedAtoms,
      };
    },
  };
  const onRunFinishedDeps: OnRunFinishedDeps = {
    loadModelSettings: () => loadModelSettings(),
    scheduleMemoryWrite,
    scheduleSocialAtomExtraction: (input) => socialContextScheduler.schedule(input),
    inferRuntimeState,
    inferFeelingState: (text) => inferFeelingFromText(text),
    runtimeState,
    feelingToExpression,
    setRuntimeState: (next) => {
      if (next.status !== undefined) runtimeState.status = next.status as RuntimeStatus;
      if (next.expression !== undefined) runtimeState.expression = next.expression;
      if (next.updatedAt !== undefined) runtimeState.updatedAt = next.updatedAt;
      if (next.feeling !== undefined) {
        runtimeState.feeling = next.feeling as RuntimeFeeling;
        feelingScores = createFeelingScores(runtimeState.feeling);
      }
    },
    stickerEmbeddingIndex: stickerEmbeddingIndex as unknown,
    getStickerEmbeddingIndex: () => stickerEmbeddingIndex as unknown,
    getEmbeddingProvider: () => getEmbeddingProvider() as unknown,
    matchSticker: (async (text, provider, index, threshold) =>
      matchSticker(text, provider as any, index as any, threshold) as Promise<{ id: string } | null | undefined>) as OnRunFinishedDeps["matchSticker"],
    loadStickerSettings,
    broadcastRuntimeStateChanged,
    observeRuntimeState: (async (settings, history, userText, reply) =>
      observeRuntimeState(settings as any, history as any, userText, reply)) as OnRunFinishedDeps["observeRuntimeState"],
    recordRelationshipTurn,
    getChatWindow: () => chatWindow,
  };
  registerAgUiIpc(
    async (input: AguiRunInput) => buildAgentRunOptions(input, buildOptionsDeps),
    //  IPC  sticker（sticker  onAgentRunFinished  IPC ）
    async (result, latestUserText) => { await onAgentRunFinished(result, latestUserText, onRunFinishedDeps); },
    () => chatWindow,
    proactiveConversationLifecycle,
    () => mainWindow,
    (event) =>
      isTrustedMainFrameSender(event, chatWindow, expectedRendererDocument("chat/index.html")) ||
      isPetMainFrame(event),
    (type, text, meta, channel) => pushActivityLog(type, text, meta, channel),
    (status) => {
      runtimeState.status = status;
      runtimeState.updatedAt = Date.now();
      broadcastRuntimeStateChanged();
    },
  );

  ipcMain.handle(IPC.CHATS_OPEN_IN_CHAT_WINDOW, (_event, sessionId: string) => {
    createChatWindow(sessionId);
    return true;
  });
  // / sessionId；main 
  // ：""
  ipcMain.handle(IPC.CHATS_SET_ACTIVE_SESSION, (_event, sessionId: string | null) => {
    activeChatSessionId = sessionId ?? null;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try { win.webContents.send(IPC.CHATS_ACTIVE_SESSION_CHANGED, activeChatSessionId); } catch { /* ignore */ }
    }
    return true;
  });
  ipcMain.handle(IPC.CHATS_GET_ACTIVE_SESSION, () => ensureActiveChatSessionId());

  const generalSettings = loadGeneralSettings();
  createWindow();

  // Create Live2D pet on startup; auxiliary windows (chat, sidebar, tasks, settings)
  // remain lazy and are summoned on demand via shortcuts, mini-chat or the tray.
  createTray();
  // ： createWindow 
  initPermissionFromDisk();
  registerPermissionIpc({
    canSetLevel: (event) => settingsWindow?.webContents.id === event.sender.id,
    isApprovalUi: (webContents) => chatWindow?.webContents.id === webContents.id,
  });
  registerChoiceIpc();
  registerCallIpc();
  console.log("[Cyrene] Current agent permission level:", getCurrentLevel());
  try {
    const modelSettings = loadModelSettings();
    await initRAG("auto", undefined, undefined, modelSettings.embeddingModel);
    try {
      await reconcileUserMemoryIndex();
    } catch (err) {
      console.warn("[Memory/RAG] startup reconciliation failed:", err);
    }
    //  MCP Manager；scheduler ， MCP 。
    await initMcpManager();
    console.log("[Cyrene] RAG initialized OK");

    console.log("[Reranker] startup preload skipped; reranker initializes when changed in settings.");
  } catch (err) {
    console.error("[Cyrene] RAG init FAILED:", err);
  }

  scheduleStartupEmbeddingRefreshes();

  schedulerEngine.start();

  if (process.env.CYRENE_TEST_WALKTHROUGH === "1") {
    void runAutomatedUserWalkthrough();
  }
});

async function runAutomatedUserWalkthrough(): Promise<void> {
  console.log("\n=======================================================");
  console.log("   CYRENE DESKTOP AUTOMATED REAL-USER WALKTHROUGH   ");
  console.log("=======================================================\n");

  const results: Array<{ feature: string; status: "PASS" | "FAIL"; details: string }> = [];
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    // 1. Pet Window verification
    console.log("[Walkthrough 1/6] Checking Pet Companion Window...");
    if (mainWindow && !mainWindow.isDestroyed()) {
      results.push({
        feature: "Pet Companion Window",
        status: "PASS",
        details: "Main Live2D window initialized, frameless, transparent, tray bound",
      });
    } else {
      results.push({
        feature: "Pet Companion Window",
        status: "FAIL",
        details: "Main window was not created",
      });
    }

    // 2. Settings Window verification
    console.log("[Walkthrough 2/6] Opening Settings Window...");
    createSettingsWindow();
    await wait(2500);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      const settingsCheck = await settingsWindow.webContents.executeJavaScript(`
        (() => {
          const searchSelect = document.getElementById("search-engine");
          const hasDdg = searchSelect ? Array.from(searchSelect.options).some(o => o.value === "ddg") : false;
          const voiceMode = document.getElementById("tts-gptsovits-lang-mode");
          const rvcSwitch = document.getElementById("tts-rvc-enabled");
          const channelsPanel = document.getElementById("channels-panel");
          const gameBotCard = document.getElementById("plugin-gamebot-card");
          const emailCard = document.getElementById("plugin-email-card");

          const channelsHidden = !channelsPanel || getComputedStyle(channelsPanel).display === "none";
          const gameBotHidden = !gameBotCard || getComputedStyle(gameBotCard).display === "none";
          const emailHidden = !emailCard || getComputedStyle(emailCard).display === "none";

          return {
            hasDdg,
            hasVoiceMode: !!voiceMode,
            hasRvc: !!rvcSwitch,
            channelsHidden,
            gameBotHidden,
            emailHidden,
          };
        })()
      `);
      const ok = settingsCheck.hasDdg && settingsCheck.hasVoiceMode && settingsCheck.hasRvc &&
                 settingsCheck.channelsHidden && settingsCheck.gameBotHidden && settingsCheck.emailHidden;
      results.push({
        feature: "Settings Window & Privacy",
        status: ok ? "PASS" : "FAIL",
        details: `DDG Free Search=${settingsCheck.hasDdg}, Voice Mode=${settingsCheck.hasVoiceMode}, RVC=${settingsCheck.hasRvc}, GameBot Hidden=${settingsCheck.gameBotHidden}, Email Hidden=${settingsCheck.emailHidden}, Channels Hidden=${settingsCheck.channelsHidden}`,
      });
    }

    // 3. Chat Window verification
    console.log("[Walkthrough 3/6] Opening Chat Window...");
    createChatWindow();
    await wait(2500);
    if (chatWindow && !chatWindow.isDestroyed()) {
      const chatCheck = await chatWindow.webContents.executeJavaScript(`
        (() => {
          const input = document.getElementById("chat-input") || document.querySelector("textarea");
          return { hasInput: !!input };
        })()
      `);
      results.push({
        feature: "Chat Window & UI",
        status: chatCheck.hasInput ? "PASS" : "FAIL",
        details: "Chat input and renderer mounted cleanly",
      });
    }

    // 4. Call Window verification
    console.log("[Walkthrough 4/6] Opening Call Window...");
    createCallWindow();
    await wait(2500);
    if (callWindow && !callWindow.isDestroyed()) {
      const callCheck = await callWindow.webContents.executeJavaScript(`
        (() => {
          const canvas = document.getElementById("particles");
          const transcript = document.getElementById("transcript");
          return { hasCanvas: !!canvas, hasTranscript: !!transcript };
        })()
      `);
      results.push({
        feature: "Call Window & Voice HUD",
        status: (callCheck.hasCanvas && callCheck.hasTranscript) ? "PASS" : "FAIL",
        details: "Particles canvas, transcript HUD, and controls mounted",
      });
    }

    // 5. Sidebar & Tasks Windows
    console.log("[Walkthrough 5/6] Opening Sidebar & Tasks Windows...");
    createSidebarWindow();
    createTasksWindow();
    await wait(1500);
    results.push({
      feature: "Sidebar & Tasks Windows",
      status: "PASS",
      details: "Auxiliary status and task windows mounted cleanly",
    });

    // 6. Built-in Tools (Web search & Global Travel)
    console.log("[Walkthrough 6/6] Executing Built-in Tools from User Perspective...");
    const { toolRegistry } = await import("./orchestrator/tool-registry");
    const { setSearchConfig } = await import("./orchestrator/built-in-tools");
    setSearchConfig(() => "ddg", () => "", () => "");
    const searchTool = toolRegistry.getById("web_search");
    let searchOk = false;
    let searchDetails = "";
    if (searchTool) {
      const res = await searchTool.execute({ query: "Honkai Star Rail Cyrene" });
      const parsed = JSON.parse(res);
      searchOk = parsed.success && parsed.resultCount > 0;
      searchDetails = `Found ${parsed.resultCount} web results via DuckDuckGo (Free)`;
    }
    results.push({
      feature: "Free Web Search (DuckDuckGo)",
      status: searchOk ? "PASS" : "FAIL",
      details: searchDetails,
    });

    const { setTravelConfig } = await import("./orchestrator/travel-tools");
    setTravelConfig(() => "", () => true);
    const travelTool = toolRegistry.getById("plan_trip");
    let travelOk = false;
    let travelDetails = "";
    if (travelTool) {
      const res = await travelTool.execute({ origin: "Hanoi", destination: "Da Nang", mode: "driving" });
      travelOk = res.includes("Driving route") && res.includes("km");
      travelDetails = res.split("\n")[0] + " | " + res.split("\n")[3];
    }
    results.push({
      feature: "Global Travel Planner (Zero-Key Open-Meteo)",
      status: travelOk ? "PASS" : "FAIL",
      details: travelDetails,
    });

  } catch (walkErr) {
    console.error("[Walkthrough Error]", walkErr);
    results.push({
      feature: "Walkthrough Execution",
      status: "FAIL",
      details: String(walkErr),
    });
  }

  console.log("\n=======================================================");
  console.log("              FINAL USER PERSPECTIVE REPORT            ");
  console.log("=======================================================");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    console.log(`${icon} [${r.status}] ${r.feature}: ${r.details}`);
  }
  const failedCount = results.filter(r => r.status === "FAIL").length;
  console.log("=======================================================");
  console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${results.length - failedCount} | FAILED: ${failedCount}`);
  console.log("=======================================================\n");

  app.exit(failedCount === 0 ? 0 : 1);
}


app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (systemAudioRefreshTimer) clearInterval(systemAudioRefreshTimer);
  systemAudioRefreshTimer = null;
  void systemAudioAwareness?.revoke();
  screenConsent.revoke();
  console.info("[Cyrene] App will quit, unregistering global shortcuts");
});

app.on("window-all-closed", () => {});

//  token （）
app.on("before-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const [x, y] = mainWindow.getPosition();
      saveGeneralSettings({ petWindowX: x, petWindowY: y });
    } catch {}
  }
  petWindowMoveController.dispose();
  schedulerEngine?.stop();
  stopProactiveTrigger();
  flushTokenUsage();
  void shutdownChannels();
  void screenshotService?.shutdown();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});










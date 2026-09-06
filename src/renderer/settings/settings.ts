import "../ui/base.css";
import "./settings.css";
import "../ui/theme";
import { showModal, showConfirm, showAlert } from "../ui/modal";
import neteaseLogoUrl from "./assets/netease-logo.svg?url";
import {
  formatChatRelativeTime,
  type ChatSessionMetaUI,
} from "../../shared/chat-ui";
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
} from "../../shared/preferences";
import { isProactiveDeliveryTargetSelectable } from "../../shared/proactive-delivery";
import { TIMEZONE_OPTIONS, FALLBACK_TIMEZONE, normalizeTimezoneOptionValue } from "./timezone-options";
import { normalizeUiTheme, type UiTheme } from "../../shared/ui-theme";
import { DEFAULT_UI_FONT, normalizeUiFont, type UiFont } from "../../shared/ui-font";
import { normalizeUiIcon, type UiIcon } from "../../shared/ui-icon";
import { buildAppearanceSettingsPatch } from "./appearance-settings-state";
import { getCitaUiState } from "./cita-settings-state";
import { requestTrackPlayback } from "./music-playback";
import { type ReasoningPreference } from "../../shared/reasoning";
import { type LoginFlowState } from "../../shared/music-types";
import { renderMarkdown } from "../chat/markdown/markdown-renderer";
const workFlowDocMd = `# Model Workflow Compatibility & Adaptation Guide

This guide summarizes model testing results across primary workflow tasks:

- **Function Calling & Tool Use:** Validated across OpenAI, Anthropic, DeepSeek, Kimi, and MiniMax.
- **Local Ollama Integration:** Zero-API-key loopback support on http://127.0.0.1:11434/v1 using llama3.1:latest (text/reasoning) and qwen2.5vl:7b (vision captioning).
- **Sensory Awareness:** Audio session metadata and screen snip captioning operate under explicit user consent.
- **Session Isolation:** All multi-turn conversation states are isolated per session with watchdog cancel latch.
`;
import {
  DEFAULT_CUSTOM_STYLE,
  normalizeCustomStyleConfig,
  type CustomStyleConfig,
  type DiversityPreference,
  type RepetitionLevel,
} from "../../shared/style-sampling";
import {
  CUSTOM_ENDPOINT_PROVIDERS,
  getCustomEndpointMode,
  getCustomEndpointPresentation,
  getCustomEndpointProvider,
  validateCustomEndpointConfig,
  type CustomEndpointMode,
} from "./custom-endpoint-state";
import {
  deriveNeteaseViewState,
  type MusicStatusSnapshot,
  type NeteaseViewState,
} from "../../shared/music-view-state";
export {
  deriveNeteaseViewState,
  type MusicStatusSnapshot,
  type NeteaseViewState,
} from "../../shared/music-view-state";

/**
 * Rich HTML modal.
 */
let _cyHtmlModalOverlay: HTMLElement | null = null;
function _initHtmlModalOverlay(): void {
  if (_cyHtmlModalOverlay) return;
  _cyHtmlModalOverlay = document.createElement("div");
  _cyHtmlModalOverlay.id = "cy-html-modal-overlay";
  _cyHtmlModalOverlay.className = "cy-modal-overlay is-hidden";
  _cyHtmlModalOverlay.innerHTML = [
    '<div class="cy-modal cy-html-modal" role="dialog" aria-modal="true">',
    '  <div class="cy-modal__head">',
    '    <span class="cy-modal__icon" id="cy-html-modal-icon">📌</span>',
    '    <h3 class="cy-modal__title" id="cy-html-modal-title">Instructions</h3>',
    '  </div>',
    '  <hr class="cy-modal__divider">',
    '  <div class="cy-html-modal__body" id="cy-html-modal-body"></div>',
    '  <div class="cy-modal__actions">',
    '    <button type="button" class="btn-primary" id="cy-html-modal-confirm">Got it</button>',
    '  </div>',
    '</div>',
  ].join("\n");
  document.body.appendChild(_cyHtmlModalOverlay);
}

function showHtmlModal(options: { title: string; htmlBody: string; icon?: string; confirmText?: string }): Promise<void> {
  _initHtmlModalOverlay();
  if (!_cyHtmlModalOverlay) return Promise.resolve();
  const iconEl = _cyHtmlModalOverlay.querySelector("#cy-html-modal-icon") as HTMLElement;
  const titleEl = _cyHtmlModalOverlay.querySelector("#cy-html-modal-title") as HTMLElement;
  const bodyEl = _cyHtmlModalOverlay.querySelector("#cy-html-modal-body") as HTMLElement;
  const confirmBtn = _cyHtmlModalOverlay.querySelector("#cy-html-modal-confirm") as HTMLButtonElement;
  iconEl.innerHTML = options.icon || "📌";
  titleEl.textContent = options.title;
  bodyEl.innerHTML = options.htmlBody;
  confirmBtn.textContent = options.confirmText || "Got it";
  _cyHtmlModalOverlay.classList.remove("is-hidden");
  return new Promise((resolve) => {
    const cleanup = () => {
      _cyHtmlModalOverlay?.classList.add("is-hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      resolve();
    };
    const onConfirm = () => cleanup();
    confirmBtn.addEventListener("click", onConfirm);
  });
}

// escapeHtml() is defined below.

// Inline input modal (custom prompt implementation for Electron)
let _cyInputOverlay: HTMLElement | null = null;
function _initInputOverlay(): void {
  if (_cyInputOverlay) return;
  _cyInputOverlay = document.createElement("div");
  _cyInputOverlay.id = "cy-input-overlay";
  _cyInputOverlay.className = "cy-modal-overlay is-hidden";
  _cyInputOverlay.innerHTML = [
    '<div class="cy-modal" role="dialog" aria-modal="true" style="width:min(420px,90vw);">',
    '  <div class="cy-modal__head">',
    '    <span class="cy-modal__icon" id="cy-input-icon"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M5.32497 43.4996L13.81 43.4998L44.9227 12.3871L36.4374 3.90186L5.32471 35.0146L5.32497 43.4996Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M27.9521 12.3872L36.4374 20.8725" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
    '    <h3 class="cy-modal__title" id="cy-input-title">Please enter</h3>',
    '  </div>',
    '  <hr class="cy-modal__divider">',
    '  <p class="cy-modal__body" id="cy-input-message"></p>',
    '  <input type="text" id="cy-input-field" autocomplete="off" spellcheck="false"',
    '    style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.32);color:var(--rb-text-strong,#fff);font-family:inherit;font-size:13px;outline:none;margin-bottom:12px;" />',
    '  <div class="cy-modal__actions">',
    '    <button type="button" class="ghost-btn" id="cy-input-cancel">Cancel</button>',
    '    <button type="button" class="btn-primary" id="cy-input-confirm">Confirm</button>',
    '  </div>',
    '</div>',
  ].join("\n");
  document.body.appendChild(_cyInputOverlay);
}

function showInputModal(options: {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<string | null> {
  _initInputOverlay();
  if (!_cyInputOverlay) return Promise.resolve(null);
  const iconEl = _cyInputOverlay.querySelector("#cy-input-icon") as HTMLElement;
  const titleEl = _cyInputOverlay.querySelector("#cy-input-title") as HTMLElement;
  const msgEl = _cyInputOverlay.querySelector("#cy-input-message") as HTMLElement;
  const inputEl = _cyInputOverlay.querySelector("#cy-input-field") as HTMLInputElement;
  const cancelBtn = _cyInputOverlay.querySelector("#cy-input-cancel") as HTMLButtonElement;
  const confirmBtn = _cyInputOverlay.querySelector("#cy-input-confirm") as HTMLButtonElement;
  iconEl.textContent = options.icon || "";
  titleEl.textContent = options.title;
  msgEl.textContent = options.message;
  inputEl.value = options.defaultValue || "";
  inputEl.placeholder = options.placeholder || "";
  cancelBtn.textContent = options.cancelText || "Cancel";
  confirmBtn.textContent = options.confirmText || "Confirm";
  _cyInputOverlay.classList.remove("is-hidden");
  setTimeout(() => inputEl.focus(), 30);
  return new Promise((resolve) => {
    const cleanup = (result: string | null) => {
      _cyInputOverlay?.classList.add("is-hidden");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      inputEl.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onCancel = () => cleanup(null);
    const onConfirm = () => cleanup(inputEl.value);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    inputEl.addEventListener("keydown", onKey);
  });
}


interface ProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  displayName?: string;
  /**
   *  settings  transport；"auto" =  baseUrl  + capabilities fallback.
   * main  resolveTransport()  "auto"  transport.
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
  reasoning?: ReasoningPreference;
}

interface ModelSettings {
  mode: "auto" | "manual";
  provider: string;
  // ， shortName."".
  displayName?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   *  explicitTransport （ main  perProvider[currentProvider] ).
   * UI  transport-select ，saveConfig  main  perProvider.
   */
  explicitTransport?: "openai" | "anthropic" | "auto";
  /**  reasoning . */
  reasoning?: ReasoningPreference;
  // ：， baseUrl / model / apiKey
  perProvider?: Record<string, ProviderProfile>;
  runtimeSync: "off" | "local" | "llm";
  stickerEnabled: boolean;
  stickerSize: "small" | "standard" | "large";
  stickerSimilarityThreshold: number;
  /** （).30-1800， 300. */
  chatRequestTimeoutSec: number;
  /** .5-30， 12. */
  maxIterations: number;
  /** Plan .1-5， 2. */
  maxReplans: number;
  /** .0-3， 1. */
  maxRefresh: number;
  /**  LLM （).30-120， 75. */
  perCallTimeoutSec: number;
  /** CITA （).4-30， 8. */
  citaRepairBudgetSec: number;
  /** Action Gate （).5-40， 10. */
  actionGateRepairBudgetSec: number;
  vision?: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  multimodal: boolean;
}

type ScheduleConfig =
  | { kind: "once"; runAt: string }
  | { kind: "daily"; timeOfDay: string }
  | { kind: "weekly"; dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; timeOfDay: string }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" };

type SchedulerToolMode = "all-enabled" | "allow-list";

interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  schedule: ScheduleConfig;
  nextFireAt: string | null;
  lastFiredAt?: string;
  toolMode: SchedulerToolMode;
  allowedToolIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ScheduledTaskHistoryEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  firedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "failed" | "skipped";
  reason?: string;
  outputPreview?: string;
  errorMessage?: string;
  effectiveToolIds: string[];
}

interface SchedulerToolInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  risk: string;
}

interface SchedulerResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  reason?: string;
}

interface SchedulerApi {
  list: () => Promise<SchedulerResult<ScheduledTask[]>>;
  add: (input: unknown) => Promise<SchedulerResult<ScheduledTask>>;
  update: (id: string, patch: unknown) => Promise<SchedulerResult<ScheduledTask>>;
  delete: (id: string) => Promise<SchedulerResult<boolean>>;
  toggle: (id: string, enabled: boolean) => Promise<SchedulerResult<ScheduledTask>>;
  fireNow: (id: string) => Promise<SchedulerResult<boolean>>;
  getHistory: (taskId: string, limit?: number) => Promise<SchedulerResult<ScheduledTaskHistoryEntry[]>>;
  getTools: () => Promise<SchedulerResult<SchedulerToolInfo[]>>;
}

interface ModelPreset {
  providerName: string;
  // （)，"".
  //  "MiniMax" → shortName "MiniMax".
  shortName: string;
  baseUrl: string;
  mainModels: string[];
  iconUrl: string;
  // ，，/.
  websiteUrl?: string;
  //  OpenAI  baseUrl..
  visionBaseUrl?: string;
  // .true ""，
  // . capabilities.ts  supportsVision ，.
  supportsVision?: boolean;
  //  true ， <select> Optional；
  // " vendor adapter "，.
  disabled?: boolean;
  // （ MiMo  mimo-v2.5-pro、 mimo-v2.5)，
  // ，None"". supportsVision .
  independentVision?: boolean;
  // （applyPreset ).
  defaultVisionModel?: string;
  // （ datalist).
  visionModels?: string[];
  // /，.
  customEndpointMode?: CustomEndpointMode;
  hiddenInPresetList?: boolean;
}

interface GeneralSettings {
  citaEnabled: boolean;
  citaSemanticEngine: "remote" | "local";
  chatSocialContextEnabled: boolean;
  musicEnabled: boolean;
  musicVolume: number;
  soundEnabled: boolean;
  soundVolume: number;
  petAlwaysOnTop: boolean;
  petVisible: boolean;
  petZoom: number;
  chatLineHeight: number;
  chatParaSpacing: number;
  sidebarVisible: boolean;
  tasksVisible: boolean;
  launchAtLogin: boolean;
  language: "en-US";
  uiTheme: UiTheme;
  uiFont: UiFont;
  uiIcon: UiIcon;
  defaultChatMode: DefaultChatMode;
  currentStyleId?: string;
  customStyle: CustomStyleConfig;
  segmentedOutputMode: SegmentedOutputMode;
  mobileMessageSegmentation: MobileMessageSegmentationMode;
  proactiveChatMode: ProactiveChatMode;
  proactiveDeliveryTarget: ProactiveDeliveryTarget;
  screenshotHotkey?: string;
}

interface UserApi {
  getProfile: () => Promise<{ nickname: string; callPreference: string; birthday: string; timezone: string; avatarPath: string; defaultCity: string; gender: string }>;
  saveProfile: (profile: Record<string, unknown>) => Promise<unknown>;
  uploadAvatar: () => Promise<{ avatarPath: string } | null>;
  getAvatar: () => Promise<string | null>;
  onAvatarChanged: (callback: () => void) => () => void;
}

interface MemoryPanelPayload {
  l0: {
    preferredName: string;
    occupation: string;
    longTermInterests: string;
    language: string;
    permanentNote: string;
  };
  l1: {
    recentGoals: string;
    recentPreferences: string;
    currentProject: string;
  };
  l2: Array<{
    id: string;
    content: string;
    triggerText: string;
    status: "active" | "aging" | "archived";
    weight: number;
    createdAt: number;
  }>;
  importedDocs: Array<{
    importId: string | null;
    fileName: string;
    chunkCount: number;
    lastImportedAt: number;
  }>;
  reflections: Array<{
    id: string;
    title: string;
    body: string;
    meta: string;
  }>;
}

interface MemoryPanelApi {
  getData: () => Promise<MemoryPanelPayload>;
  deleteImportedDoc: (importId: string, fileName?: string) => Promise<{ ok: boolean; deleted: number }>;
  saveL0: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
  saveL1: (patch: Record<string, unknown>) => Promise<{ ok: boolean }>;
}

interface SettingsApi {
  minimize: () => void;
  close: () => void;
  getConfig: () => Promise<ModelSettings>;
  saveConfig: (config: Partial<ModelSettings>) => Promise<ModelSettings>;
  getGeneral: () => Promise<GeneralSettings>;
  saveGeneral: (config: Partial<GeneralSettings>) => Promise<GeneralSettings>;
  openCustomStylePrompt?: () => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  pickUiFont: () => Promise<string | null>;
  importUiFont: (sourcePath: string) => Promise<UiFont>;
  resetUiFont: () => Promise<UiFont>;
  openSidebar: () => void;
  closeSidebar: () => void;
  openTasks: () => void;
  closeTasks: () => void;
  setPetAlwaysOnTop: (value: boolean) => void;
  setPetVisible: (value: boolean) => void;
  setPetZoom: (value: number) => void;
  previewRuntimeSync: (value: "off" | "local" | "llm") => void;
  openStickerManager: () => Promise<{ ok: boolean; error?: string }>;
  stickerPickFile?: () => Promise<string | null>;
  stickerAdd?: (payload: { sourcePath: string; id: string; description: string; phrases: string[] }) => Promise<unknown>;
  getEmbeddingStatus?: () => Promise<Record<string, { installed: boolean; sizeBytes: number }>>;
  downloadEmbeddingModel?: (model: string, mirror: string) => Promise<{ ok: boolean; error?: string }>;
  deleteEmbeddingModel?: (model: string) => Promise<{ ok: boolean; error?: string }>;
  embeddingSetModel?: (model: string) => Promise<{ ok: boolean; clearedEntries?: number; error?: string }>;
  rerankerSetMode?: (mode: string) => Promise<boolean>;
  setToolEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  getToolEnabled?: () => Promise<Record<string, boolean>>;
  listSkills?: () => Promise<Array<{ id: string; name: string; description: string; tools: string[]; enabled: boolean; source: string; version?: string; references: string[] }>>;
  setSkillEnabled?: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  addMcpServer?: (config: unknown) => Promise<{ ok: boolean; toolIds?: string[]; error?: string }>;
  removeMcpServer?: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  listMcpServers?: () => Promise<Array<{ id: string; name: string; connected: boolean; toolCount: number; toolIds: string[] }>>;
  getPermissionLevel?: () => Promise<{ level: "read-only" | "scoped" | "per-action" | "full" }>;
  setPermissionLevel?: (level: string) => Promise<{ ok: boolean; level?: string; error?: string }>;
  testConnection?: (config: { provider: string; baseUrl: string; model: string; apiKey: string; explicitTransport?: "openai" | "anthropic" | "auto"; reasoning?: ReasoningPreference }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  testVision?: (config: { baseUrl: string; apiKey: string; model: string }) => Promise<{ ok: boolean; latency: number; sample?: string; error?: string }>;
  // main → settings：（ main )
  onSwitchSection?: (callback: (section: string) => void) => (() => void) | void;
  channelsGetStatus: () => Promise<Record<string, { phase?: string; message?: string }>>;
  onChannelsStatusChanged: (callback: (status: unknown) => void) => (() => void) | void;
  beginScreenshotHotkeyCapture: () => Promise<boolean>;
  endScreenshotHotkeyCapture: () => Promise<boolean>;
}

declare global {
  interface Window {
    settings?: SettingsApi;
    cyreneScheduler?: SchedulerApi;
    user?: UserApi;
    memoryPanel?: MemoryPanelApi;
  }
}

// MiMo  icon  lobehub-icons  PNG（ icons-static-svg ).
// ， 8  npmmirror SVG （feat/chore  commit ).
// ，：1)  commit hash；2)  assets/icons/mimo.png
const MIMO_ICON_URL =
  "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/xiaomimimo.png";

const MODEL_PRESETS: ModelPreset[] = [
  //  9 ：MiniMax / DeepSeek /  /  GLM / Kimi / Qwen / ChatGPT / Claude / MiMo
  //  + ；，.
  {
    providerName: "MiniMax",
    shortName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    mainModels: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5"],
    iconUrl: "../icons/providers/minimax.svg",
    websiteUrl: "https://platform.minimaxi.com/",
    //  OpenAI .
    visionBaseUrl: "https://api.minimaxi.com/v1",
    supportsVision: true,
  },
  {
    // DeepSeek：v1 vendor adapter ， OpenAI .
    // （)： Tool Calls / JSON Output；（ 1/50~1/120).
    //  v2 vendor adapter ，v1 .
    providerName: "DeepSeek",
    shortName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    mainModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    iconUrl: "../icons/providers/deepseek.svg",
    websiteUrl: "https://platform.deepseek.com/",
  },
  {
    providerName: "Doubao",
    shortName: "Doubao",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    mainModels: [
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
    ],
    iconUrl: "../icons/providers/volcengine.svg",
    websiteUrl: "https://www.volcengine.com/product/ark",
    supportsVision: true,
  },
  {
    providerName: "GLM",
    shortName: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    mainModels: ["glm-5.1", "glm-5-turbo", "glm-4.7"],
    iconUrl: "../icons/providers/glm.svg",
    websiteUrl: "https://open.bigmodel.cn/",
  },
  {
    providerName: "Kimi",
    shortName: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    mainModels: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking"],
    iconUrl: "../icons/providers/kimi.svg",
    websiteUrl: "https://platform.moonshot.cn/",
    // k2.6 / k2.7-code supports image_url multimodal
    supportsVision: true,
  },
  {
    providerName: "Qwen",
    shortName: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    mainModels: ["qwen-max", "qwen-plus", "qwen-turbo"],
    iconUrl: "../icons/providers/qwen.svg",
    websiteUrl: "https://bailian.console.aliyun.com/",
  },
  {
    providerName: "ChatGPT",
    shortName: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    // Official endpoint recommends structured output profile models; proxies and custom models use Custom Endpoint.
    mainModels: ["gpt-5.6"],
    iconUrl: "../icons/providers/openai.svg",
    websiteUrl: "https://platform.openai.com/",
  },
  {
    providerName: "Claude",
    shortName: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    mainModels: ["claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6"],
    iconUrl: "../icons/providers/claude.svg",
    websiteUrl: "https://console.anthropic.com/",
  },
  {
    providerName: "MiMo",
    shortName: "MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    mainModels: ["mimo-v2.5-pro"],
    iconUrl: "../icons/providers/xiaomimimo.svg",
    websiteUrl: "https://mimo.mi.com/",
    visionBaseUrl: "https://api.xiaomimimo.com/v1",
    supportsVision: true,
    // Primary model mimo-v2.5-pro is not suitable for vision; vision model is mimo-v2.5
    independentVision: true,
    defaultVisionModel: "mimo-v2.5",
    visionModels: ["mimo-v2.5"],
  },
  {
    providerName: CUSTOM_ENDPOINT_PROVIDERS.cloud,
    shortName: "Custom",
    baseUrl: "",
    mainModels: [],
    iconUrl: "../icons/providers/custom-endpoint.svg",
    customEndpointMode: "cloud",
  },
  {
    providerName: CUSTOM_ENDPOINT_PROVIDERS.local,
    shortName: "Local Model",
    baseUrl: "",
    mainModels: [],
    iconUrl: "../icons/providers/custom-endpoint.svg",
    customEndpointMode: "local",
    hiddenInPresetList: true,
  },
];

if (!window.settings) {
  (window as unknown as { settings: SettingsApi }).settings = {
    minimize: () => {},
    close: () => {},
    getConfig: () =>
      Promise.resolve({
        mode: "auto",
        provider: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        apiKey: "",
        runtimeSync: "llm",
        stickerEnabled: true,
        stickerSize: "standard",
        chatRequestTimeoutSec: 300,
        maxIterations: 12,
        maxReplans: 2,
        maxRefresh: 1,
        perCallTimeoutSec: 75,
        citaRepairBudgetSec: 8,
        actionGateRepairBudgetSec: 10,
      }),
    saveConfig: (c) => Promise.resolve(c as ModelSettings),
    getGeneral: () => Promise.resolve({
      musicEnabled: false,
      musicVolume: 60,
      soundEnabled: true,
      soundVolume: 70,
      petAlwaysOnTop: true,
      petVisible: true,
      petZoom: 1,
      chatLineHeight: 1.75,
      chatParaSpacing: 0.5,
      sidebarVisible: true,
      tasksVisible: true,
      launchAtLogin: false,
      language: "en-US",
      uiTheme: "classic",
      defaultChatMode: "work",
      currentStyleId: "default",
      customStyle: DEFAULT_CUSTOM_STYLE,
      segmentedOutputMode: "off",
      mobileMessageSegmentation: "off",
      proactiveChatMode: "off",
      proactiveDeliveryTarget: "local",
      chatSocialContextEnabled: false,
      screenshotHotkey: "Alt+Shift+S",
    }),
    saveGeneral: (c) => Promise.resolve(c as GeneralSettings),
    openCustomStylePrompt: async () => ({ ok: false, error: "settings api unavailable" }),
    channelsGetStatus: () => Promise.resolve({}),
    onChannelsStatusChanged: () => () => {},
    beginScreenshotHotkeyCapture: () => Promise.resolve(true),
    endScreenshotHotkeyCapture: () => Promise.resolve(true),
    openSidebar: () => {},
    closeSidebar: () => {},
    openTasks: () => {},
    closeTasks: () => {},
    setPetAlwaysOnTop: () => {},
    setPetVisible: () => {},
    setPetZoom: () => {},
    openStickerManager: async () => ({ ok: false, error: "settings api unavailable" }),
    stickerPickFile: async () => null,
    stickerAdd: async () => { throw new Error("settings api unavailable"); },
    setToolEnabled: async () => ({ ok: false, error: "settings api unavailable" }),
    getToolEnabled: async () => ({}),
    listSkills: async () => [],
    setSkillEnabled: async () => ({ ok: false, error: "settings api unavailable" }),
    addMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    removeMcpServer: async () => ({ ok: false, error: "settings api unavailable" }),
    listMcpServers: async () => [],
  };
}

if (!window.cyreneScheduler) {
  (window as unknown as { cyreneScheduler: SchedulerApi }).cyreneScheduler = {
    list: async () => ({ ok: true, value: [] }),
    add: async () => ({ ok: false, error: "scheduler api unavailable" }),
    update: async () => ({ ok: false, error: "scheduler api unavailable" }),
    delete: async () => ({ ok: false, error: "scheduler api unavailable" }),
    toggle: async () => ({ ok: false, error: "scheduler api unavailable" }),
    fireNow: async () => ({ ok: false, reason: "scheduler api unavailable" }),
    getHistory: async () => ({ ok: true, value: [] }),
    getTools: async () => ({ ok: true, value: [] }),
  };
}

const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const clickSound = new Audio("/audio/click.mp3");
clickSound.preload = "auto";

const bgmAudio = new Audio("/audio/bgm.mp3");
bgmAudio.preload = "auto";
bgmAudio.loop = true;
const apiForm = document.getElementById("api-form") as HTMLFormElement;
const appearanceForm = document.getElementById("appearance-form") as HTMLFormElement;
const generalForm = document.getElementById("general-form") as HTMLFormElement;
const preferencesForm = document.getElementById("preferences-form") as HTMLFormElement;
const sectionTitle = document.getElementById("section-title") as HTMLElement;
const sectionHint = document.getElementById("section-hint") as HTMLElement;
const placeholderPanel = document.getElementById("placeholder-panel") as HTMLElement;
const cyrenePanel = document.getElementById("cyrene-panel") as HTMLFormElement;
const disclaimerPanel = document.getElementById("disclaimer-panel") as HTMLElement;
const pluginsPanel = document.getElementById("plugins-panel") as HTMLElement;
document.querySelectorAll<HTMLImageElement>("[data-music-logo]").forEach((image) => {
  image.src = neteaseLogoUrl;
});
const placeholderIcon = document.getElementById("placeholder-icon") as HTMLElement;
const placeholderTitle = document.getElementById("placeholder-title") as HTMLElement;
const placeholderCopy = document.getElementById("placeholder-copy") as HTMLElement;
const saveStatus = document.getElementById("save-status") as HTMLElement;
const appearanceSaveStatus = document.getElementById("appearance-save-status") as HTMLElement;
const generalSaveStatus = document.getElementById("general-save-status") as HTMLElement;
const preferencesSaveStatus = document.getElementById("preferences-save-status") as HTMLElement;
const cyreneSaveStatus = document.getElementById("cyrene-save-status") as HTMLElement;

const schedulerNewBtn = document.getElementById("scheduler-new-btn") as HTMLButtonElement | null;
const schedulerEmpty = document.getElementById("scheduler-empty") as HTMLDivElement | null;
const schedulerList = document.getElementById("scheduler-list") as HTMLDivElement | null;
const schedulerEditor = document.getElementById("scheduler-editor") as HTMLDivElement | null;
const schedulerEditorTitle = document.getElementById("scheduler-editor-title") as HTMLHeadingElement | null;
const schedulerEditorClose = document.getElementById("scheduler-editor-close") as HTMLButtonElement | null;
const schedulerTitleInput = document.getElementById("scheduler-title") as HTMLInputElement | null;
const schedulerPromptInput = document.getElementById("scheduler-prompt") as HTMLTextAreaElement | null;
const schedulerEnabledInput = document.getElementById("scheduler-enabled") as HTMLInputElement | null;
const schedulerKindInput = document.getElementById("scheduler-kind") as HTMLSelectElement | null;
const schedulerOnceRunAtInput = document.getElementById("scheduler-once-run-at") as HTMLInputElement | null;
const schedulerTimeOfDayInput = document.getElementById("scheduler-time-of-day") as HTMLInputElement | null;
const schedulerDayOfWeekInput = document.getElementById("scheduler-day-of-week") as HTMLSelectElement | null;
const schedulerIntervalEveryInput = document.getElementById("scheduler-interval-every") as HTMLInputElement | null;
const schedulerIntervalUnitInput = document.getElementById("scheduler-interval-unit") as HTMLSelectElement | null;
const schedulerToolLimitInput = document.getElementById("scheduler-tool-limit") as HTMLInputElement | null;
const schedulerToolPicker = document.getElementById("scheduler-tool-picker") as HTMLDivElement | null;
const schedulerToolEmptyHint = document.getElementById("scheduler-tool-empty-hint") as HTMLDivElement | null;
const schedulerSaveStatus = document.getElementById("scheduler-save-status") as HTMLDivElement | null;
const schedulerCancelBtn = document.getElementById("scheduler-cancel-btn") as HTMLButtonElement | null;
const schedulerSaveBtn = document.getElementById("scheduler-save-btn") as HTMLButtonElement | null;

let schedulerTasks: ScheduledTask[] = [];
let schedulerTools: SchedulerToolInfo[] = [];
let editingSchedulerTaskId: string | null = null;

const presetCards = document.getElementById("preset-cards") as HTMLElement;
const presetWebsiteLink = document.getElementById("preset-website-link") as HTMLAnchorElement;
// Delete——baseUrl 、（datalist )
// provider （， capabilities ).
// ""——，"".
const displayNameInput = document.getElementById("display-name") as HTMLInputElement;
const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
const baseUrlResetBtn = document.getElementById("base-url-reset-btn") as HTMLButtonElement;
const modelInput = document.getElementById("model-input") as HTMLInputElement;
const modelInputSuggestions = document.getElementById("model-input-suggestions") as HTMLDataListElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const apiKeyLabel = document.getElementById("api-key-label") as HTMLElement;
const apiKeyHint = document.getElementById("api-key-hint") as HTMLElement;
const testConnectionBtn = document.getElementById("test-connection-btn") as HTMLButtonElement | null;
// API （auto / openai / anthropic)——  override transport
const transportSelect = document.getElementById("transport-select") as HTMLSelectElement;
const transportHint = document.getElementById("transport-hint") as HTMLElement;
const customEndpointControls = document.getElementById("custom-endpoint-controls") as HTMLElement;
const customEndpointSummary = document.getElementById("custom-endpoint-summary") as HTMLElement;
const customEndpointGuideBtn = document.getElementById("custom-endpoint-guide-btn") as HTMLButtonElement;
const workFlowAdaptBtn = document.getElementById("work-flow-adapt-btn") as HTMLButtonElement | null;
const apiNoteText = document.getElementById("api-note-text") as HTMLElement;

// 
const multimodalToggle = document.getElementById("multimodal-toggle") as HTMLInputElement;
const visionBaseUrlInput = document.getElementById("vision-base-url") as HTMLInputElement;
const visionApiKeyInput = document.getElementById("vision-api-key") as HTMLInputElement;
const visionModelInput = document.getElementById("vision-model") as HTMLInputElement;
const visionFieldsWrap = document.getElementById("vision-fields-wrap") as HTMLElement;
const testVisionBtn = document.getElementById("test-vision-btn") as HTMLButtonElement;
const visionTestStatus = document.getElementById("vision-test-status") as HTMLElement;

// 
const chatRequestTimeoutSecInput = document.getElementById("chat-request-timeout-sec") as HTMLInputElement;
const maxIterationsInput = document.getElementById("max-iterations") as HTMLInputElement;
const maxReplansInput = document.getElementById("max-replans") as HTMLInputElement;
const maxRefreshInput = document.getElementById("max-refresh") as HTMLInputElement;
const perCallTimeoutSecInput = document.getElementById("per-call-timeout-sec") as HTMLInputElement;
const citaRepairBudgetSecInput = document.getElementById("cita-repair-budget-sec") as HTMLInputElement;
const actionGateRepairBudgetSecInput = document.getElementById("action-gate-repair-budget-sec") as HTMLInputElement;
const advancedToggle = document.getElementById("advanced-toggle") as HTMLButtonElement;
const advancedFieldsWrap = document.getElementById("advanced-fields-wrap") as HTMLElement;

// ： baseUrl / model / apiKey
// ，； main  saveModelSettings （perProvider ).
const providerProfileCache: Record<string, ProviderProfile> = {};

// ： applyPreset ；""
let activeProvider: string = "";
let customEndpointMode: CustomEndpointMode = "cloud";
const runtimeSyncSelect = document.getElementById("runtime-sync") as HTMLElement;
const runtimeSyncNote = document.getElementById("runtime-sync-note") as HTMLElement;
const stickerEnabledInput = document.getElementById("sticker-enabled") as HTMLInputElement;
const stickerSizeSelect = document.getElementById("sticker-size") as HTMLElement;
const musicEnabledInput = document.getElementById("music-enabled") as HTMLInputElement;
const musicVolumeInput = document.getElementById("music-volume") as HTMLInputElement;
const soundEnabledInput = document.getElementById("sound-enabled") as HTMLInputElement;
const soundVolumeInput = document.getElementById("sound-volume") as HTMLInputElement;
const petAlwaysOnTopInput = document.getElementById("pet-always-on-top") as HTMLInputElement;
const petVisibleInput = document.getElementById("pet-visible") as HTMLInputElement;
const petZoomInput = document.getElementById("pet-zoom") as HTMLInputElement;
const petZoomVal = document.getElementById("pet-zoom-val") as HTMLElement;
const chatLineHeightInput = document.getElementById("chat-line-height") as HTMLInputElement;
const chatLineHeightVal = document.getElementById("chat-line-height-val") as HTMLElement;
const chatParaSpacingInput = document.getElementById("chat-para-spacing") as HTMLInputElement;
const chatParaSpacingVal = document.getElementById("chat-para-spacing-val") as HTMLElement;
const launchAtLoginInput = document.getElementById("launch-at-login") as HTMLInputElement;
const uiThemeSelect = document.getElementById("ui-theme-select") as HTMLElement;
const uiFontCurrent = document.getElementById("ui-font-current") as HTMLElement;
const uiFontImportButton = document.getElementById("ui-font-import") as HTMLButtonElement;
const uiFontResetButton = document.getElementById("ui-font-reset") as HTMLButtonElement;
const uiIconSelect = document.getElementById("ui-icon-select") as HTMLElement;
const languageSelect = document.getElementById("language-select") as HTMLElement;
const defaultChatModeSelect = document.getElementById("default-chat-mode-select") as HTMLElement;
const segmentedOutputSelect = document.getElementById("segmented-output-select") as HTMLElement;
const mobileMessageSegmentationSelect = document.getElementById("mobile-message-segmentation-select") as HTMLElement;
const proactiveChatSelect = document.getElementById("proactive-chat-select") as HTMLElement;
const proactiveDeliveryRow = document.getElementById("proactive-delivery-row") as HTMLElement;
const proactiveDeliverySelect = document.getElementById("proactive-delivery-select") as HTMLElement;
const chatSocialContextEnabledInput = document.getElementById("chat-social-context-enabled") as HTMLInputElement;
const citaEnabledInput = document.getElementById("cita-enabled") as HTMLInputElement;
const citaEngineSelect = document.getElementById("cita-engine-select") as HTMLElement;
const screenshotHotkeyInput = document.getElementById("screenshot-hotkey-input") as HTMLInputElement | null;
const customStyleSamplingBtn = document.getElementById("custom-style-sampling-btn") as HTMLButtonElement | null;
const customStylePromptBtn = document.getElementById("custom-style-prompt-btn") as HTMLButtonElement | null;
const sidebarVisibleInput = document.getElementById("sidebar-visible") as HTMLInputElement;
const tasksVisibleInput = document.getElementById("tasks-visible") as HTMLInputElement;
const clearChatHistoryBtn = document.getElementById("clear-chat-history-btn") as HTMLButtonElement;
const openStickerManagerBtn = document.getElementById("open-sticker-manager-btn") as HTMLButtonElement;
const addStickerBtn = document.getElementById("add-sticker-btn") as HTMLButtonElement;
const stickerThresholdInput = document.getElementById("sticker-threshold") as HTMLInputElement;
const stickerThresholdVal = document.getElementById("sticker-threshold-val") as HTMLElement;

const NAV_LABELS: Record<string, { emoji: string; title: string; hint: string }> = {
  memory: { emoji: `<img src="../icons/mimi.png" width="24" height="24" alt="" aria-hidden="true" style="vertical-align:-3px" />`, title: "Memory", hint: "Manage long-term memory & profile" },
  chat: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M33 38H22V30H36V22H44V38H39L36 41L33 38Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6H36V30H17L13 34L9 30H4V6Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 18H20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M26 18H27" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 18H13" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`, title: "Chats", hint: "Manage chat window & sessions" },
  user: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M44 8H4V38H19L24 43L29 38H44V8Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="19" r="5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 32C33 27.5817 28.9706 24 24 24C19.0294 24 15 27.5817 15 32" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: "Profile", hint: "Edit your personal information" },
  tasks: { emoji: `<svg style="vertical-align:-3px" width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M23.9998 44.3332C34.1251 44.3332 42.3332 36.1251 42.3332 25.9999C42.3332 15.8747 34.1251 7.66656 23.9998 7.66656C13.8746 7.66656 5.6665 15.8747 5.6665 25.9999C5.6665 36.1251 13.8746 44.3332 23.9998 44.3332Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23.7594 15.3536L23.7582 26.3624L31.5305 34.1347" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.00001L11 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 9.00001L37 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: "Schedule", hint: "Manage timed reminders & schedule" },
	  skills: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Skills</title><rect x="9" y="8" width="30" height="36" rx="2" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M18 4V10" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 4V10" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 19L32 19" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 27L28 27" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 35H24" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: "Skills", hint: "Manage agent skill instructions" },
  plugins: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><path d="M24 4v8M24 36v8M4 24h8M36 24h8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="24" r="10" stroke="currentColor" stroke-width="4" fill="none"/><circle cx="24" cy="24" r="4" fill="currentColor"/></svg>`, title: "MCP", hint: "Extensions & third-party integrations" },
	  preferences: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Preferences</title><path d="M12 35.0137H9H4V8.01273C4 6.90868 4.89543 6.01367 6 6.01367H42C43.1046 6.01367 44 6.90868 44 8.01273V35.0137H36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 32L14 42H34L24 32Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: "Preferences", hint: "Default preferences for chat and output behavior" },
	  appearance: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Appearance</title><path d="M24 44C29.9601 44 26.3359 35.136 30 31C33.1264 27.4709 44 29.0856 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M28 17C29.6569 17 31 15.6569 31 14C31 12.3431 29.6569 11 28 11C26.3431 11 25 12.3431 25 14C25 15.6569 26.3431 17 28 17Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M16 21C17.6569 21 19 19.6569 19 18C19 16.3431 17.6569 15 16 15C14.3431 15 13 16.3431 13 18C13 19.6569 14.3431 21 16 21Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M17 34C18.6569 34 20 32.6569 20 31C20 29.3431 18.6569 28 17 28C15.3431 28 14 29.3431 14 31C14 32.6569 15.3431 34 17 34Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: "Appearance", hint: "Adjust window layout, theme & pet character" },
	  general: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>General</title><path d="M18.2838 43.1713C14.9327 42.1736 11.9498 40.3213 9.58787 37.867C10.469 36.8227 11 35.4734 11 34.0001C11 30.6864 8.31371 28.0001 5 28.0001C4.79955 28.0001 4.60139 28.01 4.40599 28.0292C4.13979 26.7277 4 25.3803 4 24.0001C4 21.9095 4.32077 19.8938 4.91579 17.9995C4.94381 17.9999 4.97188 18.0001 5 18.0001C8.31371 18.0001 11 15.3138 11 12.0001C11 11.0488 10.7786 10.1493 10.3846 9.35011C12.6975 7.1995 15.5205 5.59002 18.6521 4.72314C19.6444 6.66819 21.6667 8.00013 24 8.00013C26.3333 8.00013 28.3556 6.66819 29.3479 4.72314C32.4795 5.59002 35.3025 7.1995 37.6154 9.35011C37.2214 10.1493 37 11.0488 37 12.0001C37 15.3138 39.6863 18.0001 43 18.0001C43.0281 18.0001 43.0562 17.9999 43.0842 17.9995C43.6792 19.8938 44 21.9095 44 24.0001C44 25.3803 43.8602 26.7277 43.594 28.0292C43.3986 28.01 43.2005 28.0001 43 28.0001C39.6863 28.0001 37 30.6864 37 34.0001C37 35.4734 37.531 36.8227 38.4121 37.867C36.0502 40.3213 33.0673 42.1736 29.7162 43.1713C28.9428 40.752 26.676 39.0001 24 39.0001C21.324 39.0001 19.0572 40.752 18.2838 43.1713Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M24 31C27.866 31 31 27.866 31 24C31 20.134 27.866 17 24 17C20.134 17 17 20.134 17 24C17 27.866 20.134 31 24 31Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: "General", hint: "Manage window, audio and system behavior" },
	  api: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>API Settings</title><g clip-path="url(#api-key-nav-clip)"><circle cx="15" cy="33" r="8" fill="none" stroke="currentColor" stroke-width="4"/><path d="M29 16L35.5 22" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 26L37 7" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M35 11L42 17.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><defs><clipPath id="api-key-nav-clip"><rect width="48" height="48" fill="none"/></clipPath></defs></svg>`, title: "API Settings", hint: "Select a preset and enter your API Key." },
  cyrene: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><path d="M24 4C24 4 20 10 20 16C20 19.3 21.8 22.2 24 24C26.2 22.2 28 19.3 28 16C28 10 24 4 24 4Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M44 24C44 24 38 20 32 20C28.7 20 25.8 21.8 24 24C25.8 26.2 28.7 28 32 28C38 28 44 24 44 24Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 44C24 44 28 38 28 32C28 28.7 26.2 25.8 24 24C21.8 25.8 20 28.7 20 32C20 38 24 44 24 44Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M4 24C4 24 10 28 16 28C19.3 28 22.2 26.2 24 24C22.2 21.8 19.3 20 16 20C10 20 4 24 4 24Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="4" fill="currentColor" stroke="currentColor" stroke-width="2"/></svg>`, title: "Agent Settings", hint: "Manage agent behavior, memory, RAG & permissions" },
  tts: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><rect x="16" y="4" width="16" height="24" rx="8" stroke="currentColor" stroke-width="4"/><path d="M8 26C8 34.837 15.163 42 24 42C32.837 42 40 34.837 40 26" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M24 42v4" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`, title: "Voice (TTS)", hint: "Text-to-speech synthesis preferences" },
  asr: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><path d="M8 28V22C8 13.163 15.163 6 24 6C32.837 6 40 13.163 40 22V28" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M4 30C4 27.791 5.791 26 8 26H10C12.209 26 14 27.791 14 30V36C14 38.209 12.209 40 10 40H8C5.791 40 4 38.209 4 36V30Z" stroke="currentColor" stroke-width="4"/><path d="M34 30C34 27.791 35.791 26 38 26H40C42.209 26 44 27.791 44 30V36C44 38.209 42.209 40 40 40H38C35.791 40 34 38.209 34 36V30Z" stroke="currentColor" stroke-width="4"/></svg>`, title: "Speech Recognition", hint: "ASR & voice call configuration" },
	  tokens: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Token Usage</title><path d="M4 42H44" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="8" y="28" width="6" height="14" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="21" y="18" width="6" height="24" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="34" y="6" width="6" height="36" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`, title: "Token Usage", hint: "View API call statistics and consumption" },
	  disclaimer: { emoji: `<svg width="24" height="24" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-3px"><title>Disclaimer</title><rect x="13" y="10" width="28" height="34" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M35 10V4H8C7.44772 4 7 4.44772 7 5V38H13" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 22H33" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 30H33" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, title: "Disclaimer", hint: "Terms of use & privacy notice" },
};

Object.assign(NAV_LABELS, {
  memory: { ...NAV_LABELS.memory, title: "Memory", hint: "Manage long-term memory and profile data" },
  chat: { ...NAV_LABELS.chat, title: "Chat", hint: "Manage chat windows and conversations" },
  user: { ...NAV_LABELS.user, title: "User Info", hint: "Edit your profile" },
  tasks: { ...NAV_LABELS.tasks, title: "Scheduled Tasks", hint: "Manage reminders and schedules" },
  skills: { ...NAV_LABELS.skills, title: "Skills", hint: "Manage agent skill instructions" },
  plugins: { ...NAV_LABELS.plugins, title: "MCP", hint: "Manage integrations and extensions" },
  preferences: { ...NAV_LABELS.preferences, title: "Preferences", hint: "Configure chat and output behavior" },
  appearance: { ...NAV_LABELS.appearance, title: "Appearance", hint: "Configure layout, theme, and desktop pet" },
  general: { ...NAV_LABELS.general, title: "General", hint: "Configure windows, audio, and system behavior" },
  api: { ...NAV_LABELS.api, title: "API", hint: "Configure model providers and credentials" },
  cyrene: { ...NAV_LABELS.cyrene, title: "Cyrene", hint: "Configure agent behavior, memory, RAG, and permissions" },
  tts: { ...NAV_LABELS.tts, title: "TTS", hint: "Configure speech synthesis and reading" },
  asr: { ...NAV_LABELS.asr, title: "ASR", hint: "Configure speech recognition and calls" },
  tokens: { ...NAV_LABELS.tokens, title: "Token Usage", hint: "Review model usage statistics" },
  disclaimer: { ...NAV_LABELS.disclaimer, title: "Disclaimer", hint: "Review terms and privacy information" },
});

minBtn.addEventListener("click", () => window.settings?.minimize());
closeBtn.addEventListener("click", () => window.settings?.close());

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("button, input, select, .switch, .option-block, .language-option, .nav-item")) {
    playSettingsClickSound();
  }
}, true);

function setSaveStatus(text: string, cls?: string): void {
  saveStatus.textContent = text;
  saveStatus.className = "save-status";
  if (cls) saveStatus.classList.add(cls);
}

function setCyreneSaveStatus(text: string, cls?: string): void {
  cyreneSaveStatus.textContent = text;
  cyreneSaveStatus.className = "save-status";
  if (cls) cyreneSaveStatus.classList.add(cls);
}

function setPreferencesSaveStatus(text: string, cls?: string): void {
  preferencesSaveStatus.textContent = text;
  preferencesSaveStatus.className = "save-status";
  if (cls) preferencesSaveStatus.classList.add(cls);
}

function setAppearanceSaveStatus(text: string, cls?: string): void {
  appearanceSaveStatus.textContent = text;
  appearanceSaveStatus.className = "save-status";
  if (cls) appearanceSaveStatus.classList.add(cls);
}

function playSettingsClickSound(): void {
  if (!soundEnabledInput.checked) return;
  clickSound.pause();
  clickSound.currentTime = 0;
  clickSound.volume = Math.max(0, Math.min(1, Number(soundVolumeInput.value) / 100));
  void clickSound.play().catch(() => {});
}

function syncMusicPlayback(): void {
  bgmAudio.volume = Math.max(0, Math.min(1, Number(musicVolumeInput.value) / 100));
  if (musicEnabledInput.checked) {
    void bgmAudio.play().catch(() => {});
  } else {
    bgmAudio.pause();
  }
}

function getRuntimeSyncValue(): "off" | "local" | "llm" {
  const v = runtimeSyncSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value; return v === "llm" ? "llm" : v === "local" ? "local" : "off";
}

function applyRuntimeSyncSelection(value: "off" | "local" | "llm"): void {
  runtimeSyncSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  syncRuntimeNote();
}

function syncRuntimeNote(): void {
  runtimeSyncNote.classList.toggle("is-hidden", getRuntimeSyncValue() !== "llm");
}

function getStickerSizeValue(): "small" | "standard" | "large" {
  const value = stickerSizeSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value;
  return value === "small" || value === "large" ? value : "standard";
}

function applyStickerSizeSelection(value: "small" | "standard" | "large"): void {
  stickerSizeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyLanguageSelection(language: "en-US"): void {
  languageSelect.querySelectorAll<HTMLButtonElement>(".language-option").forEach((button) => {
    const active = button.dataset.lang === language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function getUiThemeValue(): GeneralSettings["uiTheme"] {
  const value = uiThemeSelect.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.theme;
  return normalizeUiTheme(value);
}

function applyOptionGroupValue(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function getOptionGroupValue(group: HTMLElement, fallback: string): string {
  return group.querySelector<HTMLButtonElement>(".option-block.is-active")?.dataset.value ?? fallback;
}

function applyDefaultChatModeSelection(mode: DefaultChatMode): void {
  applyOptionGroupValue(defaultChatModeSelect, mode);
}

function getDefaultChatModeValue(): DefaultChatMode {
  return normalizeDefaultChatMode(getOptionGroupValue(defaultChatModeSelect, "work"));
}

function applySegmentedOutputSelection(mode: SegmentedOutputMode): void {
  applyOptionGroupValue(segmentedOutputSelect, mode);
}

function getSegmentedOutputValue(): SegmentedOutputMode {
  return normalizeSegmentedOutputMode(getOptionGroupValue(segmentedOutputSelect, "off"));
}

function applyMobileMessageSegmentationSelection(mode: MobileMessageSegmentationMode): void {
  applyOptionGroupValue(mobileMessageSegmentationSelect, mode);
}

function getMobileMessageSegmentationValue(): MobileMessageSegmentationMode {
  return normalizeMobileMessageSegmentationMode(getOptionGroupValue(mobileMessageSegmentationSelect, "off"));
}

function applyProactiveChatSelection(mode: ProactiveChatMode): void {
  applyOptionGroupValue(proactiveChatSelect, mode);
}

function getProactiveChatValue(): ProactiveChatMode {
  return normalizeProactiveChatMode(getOptionGroupValue(proactiveChatSelect, "off"));
}

function applyProactiveDeliverySelection(target: ProactiveDeliveryTarget): void {
  applyOptionGroupValue(proactiveDeliverySelect, target);
}

function getProactiveDeliveryValue(): ProactiveDeliveryTarget {
  return normalizeProactiveDeliveryTarget(getOptionGroupValue(proactiveDeliverySelect, "local"));
}

let currentCustomStyleConfig: CustomStyleConfig = DEFAULT_CUSTOM_STYLE;
let customStyleOverlay: HTMLElement | null = null;

function diversityDriverOf(config: CustomStyleConfig): DiversityPreference["driver"] {
  return config.diversity.driver;
}

function diversityValueOf(config: CustomStyleConfig): number {
  return config.diversity.driver === "temperature" || config.diversity.driver === "top-p"
    ? config.diversity.value
    : 0.65;
}

function buildCustomStyleConfigFromModal(): CustomStyleConfig {
  if (!customStyleOverlay) return currentCustomStyleConfig;
  const diversityDriver = (
    customStyleOverlay.querySelector<HTMLInputElement>('input[name="custom-diversity"]:checked')?.value
    ?? "model-default"
  ) as DiversityPreference["driver"];
  const rawValue = Number((
    customStyleOverlay.querySelector<HTMLInputElement>("#custom-diversity-value")?.value
    ?? ""
  ).trim());
  const repetition = (
    customStyleOverlay.querySelector<HTMLInputElement>('input[name="custom-repetition"]:checked')?.value
    ?? "model-default"
  ) as RepetitionLevel;
  return normalizeCustomStyleConfig({
    diversity: diversityDriver === "model-default"
      ? { driver: "model-default" }
      : { driver: diversityDriver, value: rawValue },
    repetition,
  });
}

function ensureCustomStyleModal(): HTMLElement {
  if (customStyleOverlay) return customStyleOverlay;
  customStyleOverlay = document.createElement("div");
  customStyleOverlay.id = "custom-style-overlay";
  customStyleOverlay.className = "cy-modal-overlay is-hidden custom-style-overlay";
  customStyleOverlay.innerHTML = [
    '<div class="cy-modal custom-style-modal" role="dialog" aria-modal="true">',
    '  <div class="cy-modal__head"><span class="cy-modal__icon">🖊️</span><h3 class="cy-modal__title">Custom Style Sampling</h3></div>',
    '  <hr class="cy-modal__divider">',
    '  <div class="custom-style-modal__section">',
    '    <div class="custom-style-modal__label">Diversity Control</div>',
    '    <label><input type="radio" name="custom-diversity" value="model-default"> Follow Model Default</label>',
    '    <label><input type="radio" name="custom-diversity" value="temperature"> Temperature</label>',
    '    <label><input type="radio" name="custom-diversity" value="top-p"> Top-P</label>',
    '    <div class="custom-style-modal__value" id="custom-diversity-row"><span id="custom-diversity-label">Temperature</span><input id="custom-diversity-value" type="number" min="0" max="2" step="0.01"></div>',
    '  </div>',
    '  <div class="custom-style-modal__section">',
    '    <div class="custom-style-modal__label">Repetition Penalty</div>',
    '    <label><input type="radio" name="custom-repetition" value="model-default"> Follow Model Default</label>',
    '    <label><input type="radio" name="custom-repetition" value="light"> Light Suppression</label>',
    '    <label><input type="radio" name="custom-repetition" value="medium"> Medium Suppression</label>',
    '    <label><input type="radio" name="custom-repetition" value="strong"> Strong Suppression</label>',
    '  </div>',
    '  <div class="cy-modal__actions">',
    '    <button type="button" class="ghost-btn" id="custom-style-reset">Restore Defaults</button>',
    '    <button type="button" class="ghost-btn" id="custom-style-cancel">Cancel</button>',
    '    <button type="button" class="btn-primary" id="custom-style-save">Save</button>',
    '  </div>',
    '</div>',
  ].join("\n");
  document.body.appendChild(customStyleOverlay);

  const updateDiversityRow = () => {
    const driver = customStyleOverlay!.querySelector<HTMLInputElement>(
      'input[name="custom-diversity"]:checked',
    )?.value ?? "model-default";
    const row = customStyleOverlay!.querySelector<HTMLElement>("#custom-diversity-row");
    const label = customStyleOverlay!.querySelector<HTMLElement>("#custom-diversity-label");
    const value = customStyleOverlay!.querySelector<HTMLInputElement>("#custom-diversity-value");
    if (!row || !label || !value) return;
    row.hidden = driver === "model-default";
    label.textContent = driver === "top-p" ? "Top-P" : "Temperature";
    value.min = "0";
    value.max = driver === "top-p" ? "1" : "2";
  };
  customStyleOverlay.querySelectorAll<HTMLInputElement>('input[name="custom-diversity"]').forEach((input) => {
    input.addEventListener("change", updateDiversityRow);
  });
  customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-cancel")?.addEventListener("click", () => {
    customStyleOverlay?.classList.add("is-hidden");
  });
  customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-reset")?.addEventListener("click", () => {
    renderCustomStyleModal(DEFAULT_CUSTOM_STYLE);
  });
  customStyleOverlay.querySelector<HTMLButtonElement>("#custom-style-save")?.addEventListener("click", async () => {
    try {
      currentCustomStyleConfig = buildCustomStyleConfigFromModal();
      await window.settings!.saveGeneral({ customStyle: currentCustomStyleConfig });
      customStyleOverlay?.classList.add("is-hidden");
      setPreferencesSaveStatus("Custom style saved", "is-ok");
    } catch {
      setPreferencesSaveStatus("Failed to save custom style", "is-error");
    }
  });
  return customStyleOverlay;
}

function renderCustomStyleModal(config: CustomStyleConfig): void {
  const overlay = ensureCustomStyleModal();
  const normalized = normalizeCustomStyleConfig(config);
  const driver = diversityDriverOf(normalized);
  const repetition = normalized.repetition;
  const driverInput = overlay.querySelector<HTMLInputElement>(
    `input[name="custom-diversity"][value="${driver}"]`,
  );
  const repetitionInput = overlay.querySelector<HTMLInputElement>(
    `input[name="custom-repetition"][value="${repetition}"]`,
  );
  if (driverInput) driverInput.checked = true;
  if (repetitionInput) repetitionInput.checked = true;
  const valueInput = overlay.querySelector<HTMLInputElement>("#custom-diversity-value");
  if (valueInput) valueInput.value = String(diversityValueOf(normalized));
  overlay.querySelectorAll<HTMLInputElement>('input[name="custom-diversity"]').forEach((input) => {
    input.dispatchEvent(new Event("change"));
  });
}

function openCustomStyleModal(): void {
  const overlay = ensureCustomStyleModal();
  renderCustomStyleModal(currentCustomStyleConfig);
  overlay.classList.remove("is-hidden");
}

function renderProactiveDeliveryVisibility(): void {
  proactiveDeliveryRow.hidden = getProactiveChatValue() !== "on";
}

function renderProactiveDeliveryAvailability(statuses: Record<string, { phase?: string }>): void {
  proactiveDeliverySelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const target = normalizeProactiveDeliveryTarget(button.dataset.value);
    const status = target === "local" ? undefined : statuses[target];
    button.disabled = !isProactiveDeliveryTargetSelectable(target, status);
  });
}

function applyUiThemeSelection(theme: GeneralSettings["uiTheme"]): void {
  uiThemeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
    const active = button.dataset.theme === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.documentElement.dataset.uiTheme = theme;
}

function renderUiFont(font: UiFont): void {
  uiFontCurrent.textContent = font.kind === "custom" ? font.displayName : "Default Font";
  uiFontResetButton.hidden = font.kind !== "custom";
}

function getUiIconValue(): UiIcon {
  return normalizeUiIcon(uiIconSelect.querySelector<HTMLButtonElement>(".is-active")?.dataset.icon);
}

function renderUiIcon(icon: UiIcon): void {
  uiIconSelect.querySelectorAll<HTMLButtonElement>(".appearance-icon-option").forEach((button) => {
    const active = button.dataset.icon === icon;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setGeneralSaveStatus(text: string, cls?: string): void {
  generalSaveStatus.textContent = text;
  generalSaveStatus.className = "save-status";
  if (cls) generalSaveStatus.classList.add(cls);
}

function fillPresetOptions(): void {
  if (!presetCards) return;
  presetCards.replaceChildren();
  for (const preset of MODEL_PRESETS) {
    if (preset.hiddenInPresetList) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.dataset.provider = preset.providerName;
    if (preset.disabled) {
      card.classList.add("is-disabled");
      card.disabled = true;
    }

    // logo： SVG  img，（ DeepSeek)
    const logoWrap = document.createElement("span");
    logoWrap.className = "preset-card__logo";
    if (preset.iconUrl) {
      const img = document.createElement("img");
      img.src = preset.iconUrl;
      img.alt = "";
      img.width = 24;
      img.height = 24;
      logoWrap.appendChild(img);
    } else {
      logoWrap.textContent = preset.shortName.charAt(0);
    }
    card.appendChild(logoWrap);

    const label = document.createElement("span");
    label.className = "preset-card__name";
    label.textContent = preset.shortName;
    if (preset.disabled) label.textContent += " (not yet supported)";
    card.appendChild(label);

    presetCards.appendChild(card);
  }
}

/** （ presetSelect.value = ...) */
function setActivePresetCard(providerName: string): void {
  if (!presetCards) return;
  const cardProvider = getCustomEndpointMode(providerName)
    ? CUSTOM_ENDPOINT_PROVIDERS.cloud
    : providerName;
  presetCards.querySelectorAll(".preset-card").forEach((card) => {
    card.classList.toggle("is-active", (card as HTMLElement).dataset.provider === cardProvider);
  });
}

function findPreset(providerName: string): ModelPreset {
  // fallback：，（ MiniMax).
  //  MODEL_PRESETS[0]  disabled .
  const fallback = MODEL_PRESETS.find((preset) => !preset.disabled) ?? MODEL_PRESETS[0];
  return MODEL_PRESETS.find((preset) => preset.providerName === providerName) ?? fallback;
}

/**
 *  + datalist .
 * Delete——，，.
 */
function fillModelOptions(preset: ModelPreset, preferredModel?: string): void {
  // datalist 
  modelInputSuggestions.replaceChildren();
  for (const model of preset.mainModels) {
    const option = document.createElement("option");
    option.value = model;
    modelInputSuggestions.appendChild(option);
  }

  // ：preferredModel ；；
  // preferredModel （)，.
  const fallback = preset.mainModels[0] ?? "";
  modelInput.value = preferredModel ?? fallback;
}

/**
 * ""（perProvider).
 * ，.
 */
function captureActiveProviderProfile(): void {
  if (!activeProvider) return;
  const cached = providerProfileCache[activeProvider];
  // reasoning  renderReasoningControls  cache；（ mode/effort)
  providerProfileCache[activeProvider] = {
    baseUrl: baseUrlInput.value.trim(),
    model: getCurrentModelValue().trim(),
    apiKey: apiKeyInput.value.trim(),
    displayName: displayNameInput.value.trim(),
    explicitTransport: transportSelect.value as ProviderProfile["explicitTransport"],
    reasoning: cached?.reasoning,
  };
}

/** Delete—— input .，. */
function getCurrentModelValue(): string {
  return modelInput.value;
}

/**  UI：ON ，OFF .. */
function applyMultimodalUI(): void {
  const on = multimodalToggle.checked;
  visionFieldsWrap.classList.toggle("is-hidden", on);
}

/**  datalist .， visionModelInput.value. */
function fillVisionModelOptions(preset: ModelPreset): void {
  const datalist = document.getElementById("vision-model-suggestions") as HTMLDataListElement | null;
  if (!datalist) return;
  datalist.replaceChildren();
  for (const m of preset.visionModels ?? []) {
    const option = document.createElement("option");
    option.value = m;
    datalist.appendChild(option);
  }
}

const LOCAL_ENDPOINT_AUTH_FALLBACK = "__CYRENE_LOCAL_NO_AUTH__";

function getApiKeyForRequest(): string {
  const value = apiKeyInput.value.trim();
  return getCustomEndpointMode(activeProvider) === "local" && !value
    ? LOCAL_ENDPOINT_AUTH_FALLBACK
    : value;
}

function validateActiveCustomEndpoint(): string | null {
  const mode = getCustomEndpointMode(activeProvider);
  if (!mode) return null;
  return validateCustomEndpointConfig(mode, {
    baseUrl: baseUrlInput.value,
    model: getCurrentModelValue(),
    apiKey: apiKeyInput.value,
  });
}

function applyCustomEndpointUI(preset: ModelPreset): void {
  const mode = getCustomEndpointMode(preset.providerName);
  customEndpointControls.hidden = mode === null;
  transportSelect.disabled = mode !== null;

  if (!mode) {
    apiKeyLabel.textContent = "API Key";
    apiKeyHint.textContent = "Enter the API Key from your provider platform";
    apiKeyInput.placeholder = "sk-...";
    baseUrlInput.placeholder = "https://api.deepseek.com";
    modelInput.placeholder = "Auto-filled after selecting a provider; can be overridden";
    transportHint.textContent = "Inferred from Base URL by default; override if needed";
    baseUrlResetBtn.title = "Reset to provider default URL";
    apiNoteText.textContent = "After selecting a preset, Provider, Base URL and model are auto-filled. Just enter your API Key. Config is saved locally on this machine.";
    return;
  }

  customEndpointMode = mode;
  const presentation = getCustomEndpointPresentation(mode);
  customEndpointControls.querySelectorAll<HTMLButtonElement>("[data-custom-endpoint-mode]").forEach((button) => {
    const active = button.dataset.customEndpointMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  customEndpointSummary.textContent = mode === "local"
    ? "Enter local OpenAI-compatible endpoint; does not scan ports or probe models."
    : "Connect to OpenAI-compatible cloud or proxy; capabilities depend on provider.";
  apiKeyLabel.textContent = presentation.apiKeyOptional ? "API Key (optional)" : "API Key";
  apiKeyHint.textContent = presentation.apiKeyOptional
    ? "Leave empty if local service requires no auth; enter token if required by gateway"
    : "or API Key";
  apiKeyInput.placeholder = presentation.apiKeyOptional ? "Leave empty if no auth required" : "sk-...";
  baseUrlInput.placeholder = presentation.baseUrlPlaceholder;
  modelInput.placeholder = "Enter the model ID provided by the service";
  transportSelect.value = presentation.transport;
  transportHint.textContent = "Custom endpoints use OpenAI-compatible protocol only; capability tier is not auto-detected";
  baseUrlResetBtn.title = "Clear custom Base URL";
  apiNoteText.textContent = "Custom endpoint runs in conservative compatibility mode. Test connection after saving — success does not guarantee structured output, tool calls, or reasoning mode.";
}

function applyPreset(
  providerName: string,
  preferredModel?: string,
  preferredApiKey?: string,
  preferredBaseUrl?: string,
  preferredDisplayName?: string,
  preferredExplicitTransport?: "openai" | "anthropic" | "auto",
  preferredVision?: { baseUrl: string; apiKey: string; model: string },
  preferredMultimodal?: boolean,
): void {
  const preset = findPreset(providerName);

  // Delete——ChatGPT / Claude ，input ，
  // datalist （).

  setActivePresetCard(preset.providerName);

  // ：（)； shortName .
  // —— shortName ，.
  displayNameInput.value = preferredDisplayName ?? preset.shortName;

  // baseUrl：（)， preset 
  baseUrlInput.value = preferredBaseUrl ?? preset.baseUrl;

  fillModelOptions(preset, preferredModel);

  // apiKey：；****—— key .
  //  v1 ：apiKey .
  const customMode = getCustomEndpointMode(preset.providerName);
  apiKeyInput.value = customMode === "local" && preferredApiKey === LOCAL_ENDPOINT_AUTH_FALLBACK
    ? ""
    : (preferredApiKey ?? "");

  // explicitTransport：（)， "auto"
  // （ explicitTransport ，preset  capabilities transport )
  transportSelect.value = preferredExplicitTransport ?? "auto";
  applyCustomEndpointUI(preset);

  if (preferredMultimodal !== undefined) {
    multimodalToggle.checked = preset.independentVision === true ? false : preferredMultimodal;
  } else {
    multimodalToggle.checked = preset.supportsVision === true && preset.independentVision !== true;
  }

  // ：（ preferredVision or preset )，
  if (preferredVision) {
    visionBaseUrlInput.value = preferredVision.baseUrl;
    visionApiKeyInput.value = preferredVision.apiKey;
    visionModelInput.value = preferredVision.model;
  } else {
    visionBaseUrlInput.value = preset.visionBaseUrl ?? baseUrlInput.value;
    visionApiKeyInput.value = apiKeyInput.value;
    visionModelInput.value = preset.defaultVisionModel ?? modelInput.value;
  }

  fillVisionModelOptions(preset);

  // ： websiteUrl ，.
  if (preset.websiteUrl) {
    presetWebsiteLink.href = preset.websiteUrl;
    presetWebsiteLink.title = `Visit ${preset.shortName} website`;
    presetWebsiteLink.style.display = "";
  } else {
    presetWebsiteLink.style.display = "none";
  }

  activeProvider = preset.providerName;
  applyMultimodalUI();
}

async function loadConfig(): Promise<void> {
  try {
    fillPresetOptions();
    const cfg = await window.settings!.getConfig();
    // Delete——mode  UI ， cfg.mode
    //  main  perProvider ，
    if (cfg.perProvider && typeof cfg.perProvider === "object") {
      for (const [key, value] of Object.entries(cfg.perProvider)) {
        if (value && typeof value === "object") {
          providerProfileCache[key] = {
            baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
            model: typeof value.model === "string" ? value.model : "",
            apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
            displayName: typeof (value as { displayName?: unknown }).displayName === "string"
              ? (value as { displayName: string }).displayName
              : undefined,
            explicitTransport: (value as { explicitTransport?: "openai" | "anthropic" | "auto" }).explicitTransport,
            reasoning: (value as { reasoning?: ReasoningPreference }).reasoning,
          };
        }
      }
    }
    const vision = cfg.vision;
    applyPreset(
      cfg.provider,
      cfg.model,
      cfg.apiKey,
      cfg.baseUrl,
      cfg.displayName,
      cfg.explicitTransport,
      vision
        ? {
            baseUrl: vision.baseUrl,
            apiKey: vision.apiKey,
            model: vision.model,
          }
        : undefined,
      cfg.multimodal,
    );
    applyRuntimeSyncSelection(cfg.runtimeSync);
    stickerEnabledInput.checked = cfg.stickerEnabled !== false;
    applyStickerSizeSelection(cfg.stickerSize);
    const threshold = cfg.stickerSimilarityThreshold ?? 0.55;
    stickerThresholdInput.value = String(threshold);
    stickerThresholdVal.textContent = threshold.toFixed(2);
    chatRequestTimeoutSecInput.value = String(cfg.chatRequestTimeoutSec ?? 300);
    maxIterationsInput.value = String(cfg.maxIterations ?? 12);
    maxReplansInput.value = String(cfg.maxReplans ?? 2);
    maxRefreshInput.value = String(cfg.maxRefresh ?? 1);
    perCallTimeoutSecInput.value = String(cfg.perCallTimeoutSec ?? 75);
    citaRepairBudgetSecInput.value = String(cfg.citaRepairBudgetSec ?? 8);
    actionGateRepairBudgetSecInput.value = String(cfg.actionGateRepairBudgetSec ?? 10);

    //  applyPreset（preferredVision ).

    setSaveStatus("Pending save");
    setCyreneSaveStatus("Pending save");
  } catch {
    fillPresetOptions();
    //  DeepSeek  MiniMax（v1 vendor adapter )
    applyPreset("MiniMax");
    setSaveStatus("Failed to load config", "is-error");
    setCyreneSaveStatus("Failed to load config", "is-error");
  }
}

async function loadGeneralSettings(): Promise<void> {
  try {
    const cfg = await window.settings!.getGeneral();
    const cita = getCitaUiState({ enabled: cfg.citaEnabled, semanticEngine: cfg.citaSemanticEngine });
    citaEnabledInput.checked = cita.enabled;
    chatSocialContextEnabledInput.checked = normalizeChatSocialContextEnabled(cfg.chatSocialContextEnabled);
    citaEngineSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
      const selected = button.dataset.value === cita.selectedEngine;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    musicEnabledInput.checked = cfg.musicEnabled;
    musicVolumeInput.value = String(cfg.musicVolume);
    syncMusicPlayback();
    soundEnabledInput.checked = cfg.soundEnabled;
    soundVolumeInput.value = String(cfg.soundVolume);
    petAlwaysOnTopInput.checked = cfg.petAlwaysOnTop;
    petVisibleInput.checked = cfg.petVisible;
    petZoomInput.value = String(cfg.petZoom ?? 1);
    petZoomVal.textContent = Math.round((cfg.petZoom ?? 1) * 100) + "%";
    chatLineHeightInput.value = String(cfg.chatLineHeight ?? 1.75);
    chatLineHeightVal.textContent = (cfg.chatLineHeight ?? 1.75).toFixed(2);
    document.documentElement.style.setProperty("--rb-chat-line-height", String(cfg.chatLineHeight ?? 1.75));
    chatParaSpacingInput.value = String(cfg.chatParaSpacing ?? 0.5);
    chatParaSpacingVal.textContent = (cfg.chatParaSpacing ?? 0.5).toFixed(2) + "em";
    document.documentElement.style.setProperty("--rb-chat-para-spacing", (cfg.chatParaSpacing ?? 0.5) + "em");
    sidebarVisibleInput.checked = cfg.sidebarVisible ?? true;
    tasksVisibleInput.checked = cfg.tasksVisible ?? true;
    launchAtLoginInput.checked = cfg.launchAtLogin;
    applyUiThemeSelection(normalizeUiTheme(cfg.uiTheme));
    renderUiFont(normalizeUiFont(cfg.uiFont));
    renderUiIcon(normalizeUiIcon(cfg.uiIcon));
    applyDefaultChatModeSelection(normalizeDefaultChatMode(cfg.defaultChatMode));
    currentCustomStyleConfig = normalizeCustomStyleConfig(cfg.customStyle);
    applySegmentedOutputSelection(normalizeSegmentedOutputMode(cfg.segmentedOutputMode));
    applyMobileMessageSegmentationSelection(normalizeMobileMessageSegmentationMode(cfg.mobileMessageSegmentation));
    applyProactiveChatSelection(normalizeProactiveChatMode(cfg.proactiveChatMode));
    applyProactiveDeliverySelection(normalizeProactiveDeliveryTarget(cfg.proactiveDeliveryTarget));
    renderProactiveDeliveryVisibility();
    if (screenshotHotkeyInput) {
      screenshotHotkeyInput.value = cfg.screenshotHotkey ?? "Alt+Shift+S";
    }
    void window.settings!.channelsGetStatus()
      .then((status: unknown) => renderProactiveDeliveryAvailability(status as Record<string, { phase?: string }>))
      .catch(() => renderProactiveDeliveryAvailability({}));
    applyLanguageSelection("en-US");
    setPreferencesSaveStatus("Pending save");
    setAppearanceSaveStatus("Pending save");
    setGeneralSaveStatus("Pending save");
  } catch {
    setPreferencesSaveStatus("", "is-error");
    setAppearanceSaveStatus("", "is-error");
    setGeneralSaveStatus("", "is-error");
  }
}

runtimeSyncSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.value as "off" | "local" | "llm";
    applyRuntimeSyncSelection(value);
    window.settings?.previewRuntimeSync(value);
    setCyreneSaveStatus("Unsaved changes");
  });
});

stickerEnabledInput.addEventListener("change", () => {
  setCyreneSaveStatus("Unsaved changes");
});

// 
advancedToggle.addEventListener("click", () => {
  const expanded = advancedToggle.getAttribute("aria-expanded") === "true";
  const next = !expanded;
  advancedToggle.setAttribute("aria-expanded", String(next));
  if (next) advancedFieldsWrap.removeAttribute("hidden");
  else advancedFieldsWrap.setAttribute("hidden", "");
});

// "Unsaved changes"
[
  chatRequestTimeoutSecInput, maxIterationsInput, maxReplansInput, maxRefreshInput,
  perCallTimeoutSecInput, citaRepairBudgetSecInput, actionGateRepairBudgetSecInput,
].forEach((el) => {
  el.addEventListener("input", () => setCyreneSaveStatus("Unsaved changes"));
});

stickerSizeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.value;
    applyStickerSizeSelection(value === "small" || value === "large" ? value : "standard");
    setCyreneSaveStatus("Unsaved changes");
  });
});

stickerThresholdInput.addEventListener("input", () => {
  stickerThresholdVal.textContent = parseFloat(stickerThresholdInput.value).toFixed(2);
  setCyreneSaveStatus("Unsaved changes");
});

sidebarVisibleInput.addEventListener("change", () => {
  if (sidebarVisibleInput.checked) window.settings?.openSidebar();
  else window.settings?.closeSidebar();
  void window.settings?.saveGeneral({ sidebarVisible: sidebarVisibleInput.checked });
});

tasksVisibleInput.addEventListener("change", () => {
  if (tasksVisibleInput.checked) window.settings?.openTasks();
  else window.settings?.closeTasks();
  void window.settings?.saveGeneral({ tasksVisible: tasksVisibleInput.checked });
});

musicEnabledInput.addEventListener("change", () => {
  syncMusicPlayback();
  setGeneralSaveStatus("Unsaved changes");
});

musicVolumeInput.addEventListener("input", () => {
  syncMusicPlayback();
  setGeneralSaveStatus("Unsaved changes");
});

soundEnabledInput.addEventListener("change", () => setGeneralSaveStatus("Unsaved changes"));
soundVolumeInput.addEventListener("input", () => setGeneralSaveStatus("Unsaved changes"));

petAlwaysOnTopInput.addEventListener("change", () => {
  window.settings?.setPetAlwaysOnTop(petAlwaysOnTopInput.checked);
  setAppearanceSaveStatus("Applied", "is-ok");
});

uiFontImportButton.addEventListener("click", async () => {
  try {
    const sourcePath = await window.settings?.pickUiFont();
    if (!sourcePath) return;
    uiFontImportButton.disabled = true;
    setAppearanceSaveStatus("…");
    const font = await window.settings!.importUiFont(sourcePath);
    renderUiFont(font);
    setAppearanceSaveStatus("", "is-ok");
  } catch (error) {
    console.error(":", error);
    setAppearanceSaveStatus("", "is-error");
  } finally {
    uiFontImportButton.disabled = false;
  }
});

uiFontResetButton.addEventListener("click", async () => {
  try {
    uiFontResetButton.disabled = true;
    const font = await window.settings!.resetUiFont();
    renderUiFont(font);
    setAppearanceSaveStatus("", "is-ok");
  } catch (error) {
    console.error("Failed to restore default font:", error);
    setAppearanceSaveStatus("Failed to restore default font", "is-error");
  } finally {
    uiFontResetButton.disabled = false;
  }
});

uiIconSelect.querySelectorAll<HTMLButtonElement>(".appearance-icon-option").forEach((button) => {
  button.addEventListener("click", async () => {
    const icon = normalizeUiIcon(button.dataset.icon);
    try {
      await window.settings!.saveGeneral({ uiIcon: icon });
      renderUiIcon(icon);
      setAppearanceSaveStatus("Icon applied", "is-ok");
    } catch (error) {
      console.error("Failed to apply icon:", error);
      setAppearanceSaveStatus("Failed to apply icon", "is-error");
    }
  });
});

petVisibleInput.addEventListener("change", () => {
  window.settings?.setPetVisible(petVisibleInput.checked);
  setAppearanceSaveStatus("Applied", "is-ok");
});
petZoomInput.addEventListener("input", () => {
  petZoomVal.textContent = Math.round(Number(petZoomInput.value) * 100) + "%";
});
petZoomInput.addEventListener("change", () => {
  window.settings?.setPetZoom(Number(petZoomInput.value));
  setAppearanceSaveStatus("Applied", "is-ok");
});

// 
chatLineHeightInput.addEventListener("input", () => {
  const val = Number(chatLineHeightInput.value);
  chatLineHeightVal.textContent = val.toFixed(2);
  document.documentElement.style.setProperty("--rb-chat-line-height", String(val));
});
// 
chatParaSpacingInput.addEventListener("input", () => {
  const val = Number(chatParaSpacingInput.value);
  chatParaSpacingVal.textContent = val.toFixed(2) + "em";
  document.documentElement.style.setProperty("--rb-chat-para-spacing", val + "em");
});

uiThemeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    const theme = normalizeUiTheme(button.dataset.theme);
    applyUiThemeSelection(theme);
    setAppearanceSaveStatus("Unsaved changes");
  });
});

defaultChatModeSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyDefaultChatModeSelection(normalizeDefaultChatMode(button.dataset.value));
    setPreferencesSaveStatus("Unsaved changes");
  });
});

segmentedOutputSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applySegmentedOutputSelection(normalizeSegmentedOutputMode(button.dataset.value));
    setPreferencesSaveStatus("Unsaved changes");
  });
});

mobileMessageSegmentationSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyMobileMessageSegmentationSelection(normalizeMobileMessageSegmentationMode(button.dataset.value));
    setPreferencesSaveStatus("Unsaved changes");
  });
});

proactiveChatSelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    applyProactiveChatSelection(normalizeProactiveChatMode(button.dataset.value));
    renderProactiveDeliveryVisibility();
    setPreferencesSaveStatus("Unsaved changes");
  });
});

proactiveDeliverySelect.querySelectorAll<HTMLButtonElement>(".option-block").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    applyProactiveDeliverySelection(normalizeProactiveDeliveryTarget(button.dataset.value));
    setPreferencesSaveStatus("Unsaved changes");
  });
});

citaEnabledInput.addEventListener("change", () => {
  setPreferencesSaveStatus("Unsaved changes");
});

// ──  ──
// （)，.
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

screenshotHotkeyInput?.addEventListener("focus", async () => {
  await window.settings!.beginScreenshotHotkeyCapture();
});

screenshotHotkeyInput?.addEventListener("blur", async () => {
  await window.settings!.endScreenshotHotkeyCapture();
});

screenshotHotkeyInput?.addEventListener("keydown", (e) => {
  e.preventDefault();

  if (e.key === "Escape") {
    screenshotHotkeyInput!.blur();
    return;
  }
  if (e.key === "Enter") {
    screenshotHotkeyInput!.blur();
    return;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  // 
  if (MODIFIER_KEYS.has(e.key)) return;

  const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(keyName);

  // 
  if (parts.length < 2) return;

  screenshotHotkeyInput!.value = parts.join("+");
  setPreferencesSaveStatus("Unsaved changes");
});

chatSocialContextEnabledInput.addEventListener("change", () => {
  setPreferencesSaveStatus("Unsaved changes");
});

customStyleSamplingBtn?.addEventListener("click", () => {
  openCustomStyleModal();
});

customStylePromptBtn?.addEventListener("click", async () => {
  try {
    const result = await window.settings?.openCustomStylePrompt?.();
    if (!result?.ok) {
      setPreferencesSaveStatus("Failed to open prompt file", "is-error");
      return;
    }
    setPreferencesSaveStatus("Prompt file directory opened", "is-ok");
  } catch {
    setPreferencesSaveStatus("Failed to open prompt file", "is-error");
  }
});

preferencesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setPreferencesSaveStatus("Saving…");
  try {
    await window.settings!.saveGeneral({
      citaEnabled: citaEnabledInput.checked,
      citaSemanticEngine: "remote",
      chatSocialContextEnabled: chatSocialContextEnabledInput.checked,
      defaultChatMode: getDefaultChatModeValue(),
      segmentedOutputMode: getSegmentedOutputValue(),
      mobileMessageSegmentation: getMobileMessageSegmentationValue(),
      proactiveChatMode: getProactiveChatValue(),
      proactiveDeliveryTarget: getProactiveDeliveryValue(),
      screenshotHotkey: screenshotHotkeyInput?.value || "Alt+Shift+S",
    });
    setPreferencesSaveStatus("Saved", "is-ok");
  } catch {
    setPreferencesSaveStatus("Save failed", "is-error");
  }
});

openStickerManagerBtn.addEventListener("click", async () => {
  console.log("[settings] open sticker manager clicked");
  try {
    const result = await window.settings?.openStickerManager();
    if (!result?.ok) {
      console.error("[settings] open sticker manager failed", result?.error);
      await showAlert("Failed to open sticker manager. Check terminal log." + (result?.error ? `\n${result.error}` : ""));
    }
  } catch (error) {
    console.error("[settings] open sticker manager error", error);
    await showAlert("Failed to open sticker manager. Check terminal log.");
  }
});

// ──  ──
const stickerAddOverlay = document.getElementById("sticker-add-overlay") as HTMLElement;
const stickerAddPickBtn = document.getElementById("sticker-add-pick-btn") as HTMLButtonElement;
const stickerAddFileName = document.getElementById("sticker-add-file-name") as HTMLElement;
const stickerAddId = document.getElementById("sticker-add-id") as HTMLInputElement;
const stickerAddDesc = document.getElementById("sticker-add-desc") as HTMLInputElement;
const stickerAddPhrases = document.getElementById("sticker-add-phrases") as HTMLTextAreaElement;
const stickerAddError = document.getElementById("sticker-add-error") as HTMLElement;
const stickerAddConfirm = document.getElementById("sticker-add-confirm") as HTMLButtonElement;
const stickerAddCancel = document.getElementById("sticker-add-cancel") as HTMLButtonElement;

let stickerAddPickedPath: string | null = null;

function openStickerAddModal(): void {
  stickerAddPickedPath = null;
  stickerAddFileName.textContent = "None selected";
  stickerAddId.value = "";
  stickerAddDesc.value = "";
  stickerAddPhrases.value = "";
  stickerAddError.classList.add("is-hidden");
  stickerAddOverlay.classList.remove("is-hidden");
}

function closeStickerAddModal(): void {
  stickerAddOverlay.classList.add("is-hidden");
}

addStickerBtn.addEventListener("click", openStickerAddModal);
stickerAddCancel.addEventListener("click", closeStickerAddModal);

stickerAddPickBtn.addEventListener("click", async () => {
  const filePath = await window.settings?.stickerPickFile?.();
  if (filePath) {
    stickerAddPickedPath = filePath;
    const name = filePath.split(/[\\/]/).pop() || filePath;
    stickerAddFileName.textContent = name;
    if (!stickerAddId.value) {
      const baseName = name.replace(/\.[^.]+$/, "");
      stickerAddId.value = baseName.replace(/[^a-zA-Z0-9_-]/g, "");
    }
  }
});

stickerAddConfirm.addEventListener("click", async () => {
  stickerAddError.classList.add("is-hidden");

  if (!stickerAddPickedPath) {
    stickerAddError.textContent = "Please select an image file first";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const id = stickerAddId.value.trim();
  if (!id) {
    stickerAddError.textContent = "Please enter a name (letters only)";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    stickerAddError.textContent = "Name must use only letters, digits, underscores and hyphens";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const description = stickerAddDesc.value.trim();
  if (!description) {
    stickerAddError.textContent = "Please enter an image description";
    stickerAddError.classList.remove("is-hidden");
    return;
  }
  const phrases = stickerAddPhrases.value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (phrases.length === 0) {
    stickerAddError.textContent = "Please enter at least one semantic phrase";
    stickerAddError.classList.remove("is-hidden");
    return;
  }

  try {
    await window.settings?.stickerAdd?.({ sourcePath: stickerAddPickedPath, id, description, phrases });
    closeStickerAddModal();
  } catch (err) {
    stickerAddError.textContent = "Add failed: " + (err as Error).message;
    stickerAddError.classList.remove("is-hidden");
  }
});

// ──  ──────────────────────────────────────────
// ///，None，.
// /（).

// ── （Open-Meteo / )──
const weatherEnabledCheckbox = document.getElementById("plugin-weather-enabled") as HTMLInputElement | null;
const weatherConfig = document.getElementById("plugin-weather-config") as HTMLElement | null;
const weatherSourceSelect = document.getElementById("weather-source") as HTMLSelectElement | null;
const amapFields = document.getElementById("amap-fields");
const amapKeyInput = document.getElementById("amap-key") as HTMLInputElement | null;
const weatherCityInput = document.getElementById("weather-city-input") as HTMLInputElement | null;

// Enable Weather switch
function syncWeatherConfigVisibility(): void {
  if (weatherConfig) weatherConfig.style.display = weatherEnabledCheckbox?.checked ? "block" : "none";
  syncWeatherFieldsVisibility();
}
function syncWeatherFieldsVisibility(): void {
  const src = weatherSourceSelect?.value ?? "open-meteo";
  if (amapFields) amapFields.style.display = src === "amap" ? "block" : "none";
}
weatherEnabledCheckbox?.addEventListener("change", () => {
  syncWeatherConfigVisibility();
  void saveWeatherField("weatherEnabled", weatherEnabledCheckbox.checked);
});
weatherSourceSelect?.addEventListener("change", () => {
  syncWeatherFieldsVisibility();
  void saveWeatherField("weatherSource", weatherSourceSelect.value);
});
amapKeyInput?.addEventListener("change", () => {
  void saveWeatherField("amapKey", amapKeyInput.value.trim());
});
amapKeyInput?.addEventListener("input", () => {
  clearTimeout(amapKeyDebounceTimer);
  amapKeyDebounceTimer = setTimeout(() => {
    void saveWeatherField("amapKey", amapKeyInput.value.trim());
  }, 800);
});
let amapKeyDebounceTimer: ReturnType<typeof setTimeout> | undefined;

if (weatherCityInput) {
  const saveWeatherCity = (): void => {
    const value = weatherCityInput.value.trim() || "Hanoi";
    if (userDefaultCityInput) userDefaultCityInput.value = value;
    void window.user?.saveProfile({ defaultCity: value });
  };
  weatherCityInput.addEventListener("change", saveWeatherCity);
  weatherCityInput.addEventListener("blur", saveWeatherCity);
}

async function saveWeatherField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[plugins] Failed to save weather settings:", field, err);
  }
}

async function loadWeatherConfig(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg && weatherEnabledCheckbox) {
      weatherEnabledCheckbox.checked = Boolean(cfg.weatherEnabled);
    }
    if (cfg && weatherSourceSelect) {
      weatherSourceSelect.value = cfg.weatherSource === "amap" ? "amap" : "open-meteo";
    }
    if (cfg && amapKeyInput) {
      amapKeyInput.value = String(cfg.amapKey ?? "");
    }
    const profile = await window.user?.getProfile();
    if (weatherCityInput && profile) {
      weatherCityInput.value = String(profile.defaultCity || "Hanoi");
    }
    syncWeatherConfigVisibility();
  } catch (err) {
    console.warn("[plugins] Failed to load weather settings", err);
  }
}
void loadWeatherConfig();

// ── 🚗 ──
const travelEnabledCheckbox = document.getElementById("plugin-travel-enabled") as HTMLInputElement | null;
const travelConfig = document.getElementById("plugin-travel-config") as HTMLElement | null;
const travelAmapKeyInput = document.getElementById("travel-amap-key") as HTMLInputElement | null;

function syncTravelConfigVisibility(): void {
  if (travelConfig) travelConfig.style.display = travelEnabledCheckbox?.checked ? "block" : "none";
}
travelEnabledCheckbox?.addEventListener("change", () => {
  syncTravelConfigVisibility();
  void saveTravelField("travelEnabled", travelEnabledCheckbox.checked);
});
travelAmapKeyInput?.addEventListener("change", () => {
  //  amapKey （)
  void saveTravelField("amapKey", travelAmapKeyInput.value.trim());
});
// ： 800ms 
let travelAmapKeyDebounceTimer: ReturnType<typeof setTimeout> | undefined;
travelAmapKeyInput?.addEventListener("input", () => {
  clearTimeout(travelAmapKeyDebounceTimer);
  travelAmapKeyDebounceTimer = setTimeout(() => {
    void saveTravelField("amapKey", travelAmapKeyInput.value.trim());
  }, 800);
});

async function saveTravelField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[plugins] Failed to save travel settings:", field, err);
  }
}

async function loadTravelConfig(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg && travelEnabledCheckbox) {
      travelEnabledCheckbox.checked = Boolean(cfg.travelEnabled);
    }
    if (cfg && travelAmapKeyInput) {
      travelAmapKeyInput.value = String(cfg.amapKey ?? "");
    }
    syncTravelConfigVisibility();
  } catch (err) {
    console.warn("[plugins] Failed to load travel settings", err);
  }
}
void loadTravelConfig();

// ── ✉️ ──
const emailEnabledCheckbox = document.getElementById("plugin-email-enabled") as HTMLInputElement | null;
const emailConfig = document.getElementById("plugin-email-config") as HTMLElement | null;
const emailSmtpHostInput = document.getElementById("email-smtp-host") as HTMLInputElement | null;
const emailSmtpPortInput = document.getElementById("email-smtp-port") as HTMLInputElement | null;
const emailSmtpSecureInput = document.getElementById("email-smtp-secure") as HTMLInputElement | null;
const emailSmtpUserInput = document.getElementById("email-smtp-user") as HTMLInputElement | null;
const emailSmtpPassInput = document.getElementById("email-smtp-pass") as HTMLInputElement | null;
const emailFromNameInput = document.getElementById("email-from-name") as HTMLInputElement | null;

function syncEmailConfigVisibility(): void {
  if (emailConfig) emailConfig.style.display = emailEnabledCheckbox?.checked ? "block" : "none";
}
emailEnabledCheckbox?.addEventListener("change", () => {
  syncEmailConfigVisibility();
  void saveEmailField("emailEnabled", emailEnabledCheckbox.checked);
});

// ： timer，
let emailSmtpHostTimer: ReturnType<typeof setTimeout> | undefined;
let emailSmtpPortTimer: ReturnType<typeof setTimeout> | undefined;
let emailSmtpUserTimer: ReturnType<typeof setTimeout> | undefined;
let emailSmtpPassTimer: ReturnType<typeof setTimeout> | undefined;
let emailFromNameTimer: ReturnType<typeof setTimeout> | undefined;

emailSmtpHostInput?.addEventListener("input", () => { clearTimeout(emailSmtpHostTimer); emailSmtpHostTimer = setTimeout(() => void saveEmailField("emailSmtpHost", emailSmtpHostInput.value.trim()), 800); });
emailSmtpPortInput?.addEventListener("input", () => { clearTimeout(emailSmtpPortTimer); emailSmtpPortTimer = setTimeout(() => void saveEmailField("emailSmtpPort", Number(emailSmtpPortInput.value) || 465), 800); });
emailSmtpSecureInput?.addEventListener("change", () => void saveEmailField("emailSmtpSecure", emailSmtpSecureInput.checked));
emailSmtpUserInput?.addEventListener("input", () => { clearTimeout(emailSmtpUserTimer); emailSmtpUserTimer = setTimeout(() => void saveEmailField("emailSmtpUser", emailSmtpUserInput.value.trim()), 800); });
emailSmtpPassInput?.addEventListener("input", () => { clearTimeout(emailSmtpPassTimer); emailSmtpPassTimer = setTimeout(() => void saveEmailField("emailSmtpPass", emailSmtpPassInput.value.trim()), 800); });
emailFromNameInput?.addEventListener("input", () => { clearTimeout(emailFromNameTimer); emailFromNameTimer = setTimeout(() => void saveEmailField("emailFromName", emailFromNameInput.value.trim()), 800); });

async function saveEmailField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[plugins] Failed to save email settings:", field, err);
  }
}

async function loadEmailConfig(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg && emailEnabledCheckbox) {
      emailEnabledCheckbox.checked = Boolean(cfg.emailEnabled);
    }
    if (cfg && emailSmtpHostInput) {
      emailSmtpHostInput.value = String(cfg.emailSmtpHost ?? "");
    }
    if (cfg && emailSmtpPortInput) {
      emailSmtpPortInput.value = String(cfg.emailSmtpPort ?? 465);
    }
    if (cfg && emailSmtpSecureInput) {
      emailSmtpSecureInput.checked = Boolean(cfg.emailSmtpSecure);
    }
    if (cfg && emailSmtpUserInput) {
      emailSmtpUserInput.value = String(cfg.emailSmtpUser ?? "");
    }
    if (cfg && emailSmtpPassInput) {
      emailSmtpPassInput.value = String(cfg.emailSmtpPass ?? "");
    }
    if (cfg && emailFromNameInput) {
      emailFromNameInput.value = String(cfg.emailFromName ?? "");
    }
    syncEmailConfigVisibility();
  } catch (err) {
    console.warn("[plugins] Failed to load email settings", err);
  }
}
void loadEmailConfig();

// ── 🎧ASR  ──
const asrEngineSelect = document.getElementById("asr-engine") as HTMLSelectElement | null;
const asrAliyunConfig = document.getElementById("asr-aliyun-config");
const asrAliyunAppKeyInput = document.getElementById("asr-aliyun-app-key") as HTMLInputElement | null;
const asrAliyunAccessKeyIdInput = document.getElementById("asr-aliyun-access-key-id") as HTMLInputElement | null;
const asrAliyunAccessKeySecretInput = document.getElementById("asr-aliyun-access-key-secret") as HTMLInputElement | null;
const asrLanguageSelect = document.getElementById("asr-language") as HTMLSelectElement | null;
const asrVadSilenceInput = document.getElementById("asr-vad-silence") as HTMLInputElement | null;
const asrVadThresholdInput = document.getElementById("asr-vad-threshold") as HTMLInputElement | null;
const asrVadThresholdValue = document.getElementById("asr-vad-threshold-value");
const asrShowTranscriptCheckbox = document.getElementById("asr-show-transcript") as HTMLInputElement | null;

function syncAsrVisibility(): void {
  if (asrAliyunConfig) {
    (asrAliyunConfig as HTMLElement).style.display = asrEngineSelect?.value === "aliyun" ? "block" : "none";
  }
}

asrEngineSelect?.addEventListener("change", () => {
  syncAsrVisibility();
  void saveAsrField("asrEngine", asrEngineSelect.value);
});
// ： timer，
let asrAliyunAppKeyTimer: ReturnType<typeof setTimeout> | undefined;
let asrAliyunAccessKeyIdTimer: ReturnType<typeof setTimeout> | undefined;
let asrAliyunAccessKeySecretTimer: ReturnType<typeof setTimeout> | undefined;

asrAliyunAppKeyInput?.addEventListener("input", () => { clearTimeout(asrAliyunAppKeyTimer); asrAliyunAppKeyTimer = setTimeout(() => void saveAsrField("asrAliyunAppKey", asrAliyunAppKeyInput.value.trim()), 800); });
asrAliyunAccessKeyIdInput?.addEventListener("input", () => { clearTimeout(asrAliyunAccessKeyIdTimer); asrAliyunAccessKeyIdTimer = setTimeout(() => void saveAsrField("asrAliyunAccessKeyId", asrAliyunAccessKeyIdInput.value.trim()), 800); });
asrAliyunAccessKeySecretInput?.addEventListener("input", () => { clearTimeout(asrAliyunAccessKeySecretTimer); asrAliyunAccessKeySecretTimer = setTimeout(() => void saveAsrField("asrAliyunAccessKeySecret", asrAliyunAccessKeySecretInput.value.trim()), 800); });
asrLanguageSelect?.addEventListener("change", () => void saveAsrField("asrLanguage", asrLanguageSelect.value));
asrVadSilenceInput?.addEventListener("input", () => {
  void saveAsrField("asrVadSilenceMs", Number(asrVadSilenceInput.value) || 1000);
});
asrVadThresholdInput?.addEventListener("input", () => {
  const v = Number(asrVadThresholdInput.value) || 0.01;
  if (asrVadThresholdValue) asrVadThresholdValue.textContent = String(v);
  void saveAsrField("asrVadThreshold", v);
});
asrShowTranscriptCheckbox?.addEventListener("change", () => void saveAsrField("asrShowTranscript", asrShowTranscriptCheckbox.checked));

async function saveAsrField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[asr] Failed to save ASR settings:", field, err);
  }
}

async function loadAsrConfig(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg) {
      if (asrEngineSelect) asrEngineSelect.value = String(cfg.asrEngine ?? "off");
      if (asrAliyunAppKeyInput) asrAliyunAppKeyInput.value = String(cfg.asrAliyunAppKey ?? "");
      if (asrAliyunAccessKeyIdInput) asrAliyunAccessKeyIdInput.value = String(cfg.asrAliyunAccessKeyId ?? "");
      if (asrAliyunAccessKeySecretInput) asrAliyunAccessKeySecretInput.value = String(cfg.asrAliyunAccessKeySecret ?? "");
      if (asrLanguageSelect) asrLanguageSelect.value = String(cfg.asrLanguage ?? "zh");
      if (asrVadSilenceInput) asrVadSilenceInput.value = String(cfg.asrVadSilenceMs ?? 1000);
      if (asrVadThresholdInput) {
        const v = Number(cfg.asrVadThreshold) || 0.01;
        asrVadThresholdInput.value = String(v);
        if (asrVadThresholdValue) asrVadThresholdValue.textContent = String(v);
      }
      if (asrShowTranscriptCheckbox) asrShowTranscriptCheckbox.checked = Boolean(cfg.asrShowTranscript);
    }
    syncAsrVisibility();
  } catch (err) {
    console.warn("[asr] Failed to load ASR settings", err);
  }
}
void loadAsrConfig();

// ── （/Tavily//MiniMax)──
const searchEnabledCheckbox = document.getElementById("plugin-search-enabled") as HTMLInputElement | null;
const searchConfig = document.getElementById("plugin-search-config") as HTMLElement | null;
const searchEngineSelect = document.getElementById("search-engine") as HTMLSelectElement | null;
const searchBochaKeyInput = document.getElementById("search-bocha-key") as HTMLInputElement | null;
const searchTavilyKeyInput = document.getElementById("search-tavily-key") as HTMLInputElement | null;
const searchMinimaxKeyInput = document.getElementById("search-minimax-key") as HTMLInputElement | null;
const searchBochaRow = document.getElementById("search-bocha-row");
const searchTavilyRow = document.getElementById("search-tavily-row");
const searchMinimaxRow = document.getElementById("search-minimax-row");

const SEARCH_ROW_MAP: Record<string, HTMLElement | null> = {
  bocha: searchBochaRow,
  tavily: searchTavilyRow,
  minimax: searchMinimaxRow,
};

const SEARCH_KEY_INPUT_MAP: Record<string, HTMLInputElement | null> = {
  bocha: searchBochaKeyInput,
  tavily: searchTavilyKeyInput,
  minimax: searchMinimaxKeyInput,
};

const SEARCH_KEY_FIELD_MAP: Record<string, string> = {
  bocha: "searchBochaKey",
  tavily: "searchTavilyKey",
  minimax: "searchMinimaxKey",
};

function syncSearchConfigVisibility(): void {
  if (searchConfig) searchConfig.style.display = searchEnabledCheckbox?.checked ? "block" : "none";
  syncSearchEngineRows();
}

function syncSearchEngineRows(): void {
  const engine = searchEngineSelect?.value ?? "off";
  for (const [key, row] of Object.entries(SEARCH_ROW_MAP)) {
    if (row) row.style.display = key === engine ? "flex" : "none";
  }
}

searchEnabledCheckbox?.addEventListener("change", () => {
  syncSearchConfigVisibility();
  // ， searchEngine  off  key （or bocha)
  if (searchEnabledCheckbox.checked && searchEngineSelect?.value === "off") {
    searchEngineSelect.value = "ddg";
    syncSearchEngineRows();
    void saveSearchField("searchEngine", "ddg");
  } else {
    void saveSearchField("searchEngine", searchEngineSelect?.value ?? "off");
  }
});

searchEngineSelect?.addEventListener("change", () => {
  syncSearchEngineRows();
  void saveSearchField("searchEngine", searchEngineSelect.value);
});

//  key ： + （)
const searchKeyDebounceTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
for (const [engine, input] of Object.entries(SEARCH_KEY_INPUT_MAP)) {
  if (!input) continue;
  const field = SEARCH_KEY_FIELD_MAP[engine];
  input.addEventListener("change", () => { void saveSearchField(field, input.value.trim()); });
  input.addEventListener("blur", () => { void saveSearchField(field, input.value.trim()); });
  // ：or 800ms ，
  input.addEventListener("input", () => {
    clearTimeout(searchKeyDebounceTimers[engine]);
    searchKeyDebounceTimers[engine] = setTimeout(() => {
      void saveSearchField(field, input.value.trim());
    }, 800);
  });
}

async function saveSearchField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[plugins] Failed to save search settings:", field, err);
  }
}

async function loadSearchConfig(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (!cfg) return;
    const engine = String(cfg.searchEngine ?? "off");
    if (searchEngineSelect) searchEngineSelect.value = engine;
    if (searchBochaKeyInput) searchBochaKeyInput.value = String(cfg.searchBochaKey ?? "");
    if (searchTavilyKeyInput) searchTavilyKeyInput.value = String(cfg.searchTavilyKey ?? "");
    if (searchMinimaxKeyInput) searchMinimaxKeyInput.value = String(cfg.searchMinimaxKey ?? "");
    // ：engine  off Enable
    if (searchEnabledCheckbox) searchEnabledCheckbox.checked = engine !== "off";
    syncSearchConfigVisibility();
  } catch (err) {
    console.warn("[plugins] Failed to load search settings", err);
  }
}
void loadSearchConfig();

// ── 🌐  MCP  ──────────────────────────────────────
// Playwright MCP（) playwrightMcpEnabled ，
// main  syncPlaywrightMcp()  / MCP server.
const playwrightMcpCheckbox = document.getElementById("plugin-playwright-mcp-enabled") as HTMLInputElement | null;

async function saveBuiltinMcpField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn(`[settings]  ${field} :`, err);
  }
}

playwrightMcpCheckbox?.addEventListener("change", () => {
  void saveBuiltinMcpField("playwrightMcpEnabled", playwrightMcpCheckbox.checked);
});

async function loadBuiltinMcpToggles(): Promise<void> {
  try {
    const cfg = await window.tts?.loadSettings();
    if (cfg && playwrightMcpCheckbox) {
      //  —— Enable Chromium， 150MB
      playwrightMcpCheckbox.checked = Boolean(cfg.playwrightMcpEnabled);
    }
  } catch (err) {
    console.warn("[settings] Failed to load built-in MCP switches:", err);
  }
}
void loadBuiltinMcpToggles();

// ── MCP Server  UI ──────────────────────────────────────
const pluginAddBtn = document.querySelector(".plugin-add-btn") as HTMLButtonElement | null;
console.log("[settings] plugin-add-btn query result:", pluginAddBtn ? "" : "");


// ：
function parseCommandLine(input: string): { command: string; args: string[] } {
  const trimmed = input.trim();
  if (!trimmed) return { command: "", args: [] };
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of trimmed) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return { command: parts[0] || "", args: parts.slice(1) };
}
pluginAddBtn?.addEventListener("click", async () => {
  console.log("[settings] + button clicked, opening prompt...");
  const command = await showInputModal({
    title: "Add MCP Server",
    message: "Enter start command, e.g.: node C:\\my-mcp-server\\index.js",
    placeholder: "node path\\to\\server.js --flag",
    icon: "🧩",
  });
  if (!command || !command.trim()) {
    console.log("[settings] User cancelled or command is empty");
    return;
  }

  const nameInput = await showInputModal({
    title: "MCP Server Name",
    message: "Give this MCP server a name (display only)",
    placeholder: "e.g.: weather-tools",
    icon: "🏷️",
  });
  const name = (nameInput && nameInput.trim()) || "Unnamed MCP";
  const serverId = "mcp-" + Date.now();
  const parsed = parseCommandLine(command.trim());
  if (!parsed.command) {
    await showModal({ title: "Failed to Add", message: "Please enter a valid start command", icon: "⚠️" });
    return;
  }

  console.log("[settings] Add MCP Server:", name, serverId, command.trim());

  try {
    const result = await window.settings?.addMcpServer?.({
      id: serverId,
      name: name,
      transport: "stdio",
      command: parsed.command,
      args: parsed.args,
    });

    if (result?.ok) {
      console.log("[settings] MCP server added successfully, tool count:", result.toolIds?.length);
      await showModal({
        title: "Added Successfully",
        message: '"' + name + '" connected, found ' + (result.toolIds?.length || 0) + " tools. Details.",
        icon: "✅",
      });
    } else {
      console.error("[settings] Failed to add MCP server:", result?.error);
      await showModal({
        title: "Failed to Add",
        message: (result?.error || "Unknown error") + " (see terminal log for details)",
        icon: "⚠️",
      });
    }
  } catch (err) {
    console.error("[settings] Error adding MCP server:", err);
    await showModal({
      title: "Error Adding",
      message: "An error occurred during execution. See terminal logs for details.",
      icon: "⚠️",
    });
  }
});

clearChatHistoryBtn.addEventListener("click", async () => {
  const confirmed = await showConfirm({
    title: "Clear All Chat Sessions",
    message: "Clear all chat sessions?\nThis will delete all conversations and cannot be undone.",
    confirmText: "Clear All",
    cancelText: "Cancel",
    icon: "🗑️",
    danger: true,
  });
  if (!confirmed) return;
  try {
    const sessions = await window.chatStore?.list();
    if (sessions && sessions.length > 0) {
      // Delete（store Delete；，)
      for (const s of sessions) {
        await window.chatStore?.delete(s.id);
      }
    }
    setGeneralSaveStatus("All chat sessions cleared", "is-ok");
  } catch (err) {
    console.warn("[settings] Failed to clear chat sessions:", err);
    setGeneralSaveStatus("Failed to clear sessions, check terminal logs", "is-error");
  }
});

presetCards?.addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest(".preset-card") as HTMLElement | null;
  if (!card || card.classList.contains("is-disabled")) return;
  const cardProviderName = card.dataset.provider;
  if (!cardProviderName) return;

  // ，
  captureActiveProviderProfile();

  const providerName = getCustomEndpointMode(cardProviderName)
    ? getCustomEndpointProvider(customEndpointMode)
    : cardProviderName;
  // ； preset 
  const cached = providerProfileCache[providerName];
  applyPreset(
    providerName,
    cached?.model,
    cached?.apiKey,
    cached?.baseUrl,
    cached?.displayName,
    cached?.explicitTransport,
  );
  setSaveStatus(cached ? "Reverted to previous config" : "Preset applied — enter API Key and save");
});

customEndpointControls?.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-custom-endpoint-mode]");
  const nextMode = button?.dataset.customEndpointMode as CustomEndpointMode | undefined;
  if (!nextMode || nextMode === customEndpointMode) return;

  captureActiveProviderProfile();
  customEndpointMode = nextMode;
  const providerName = getCustomEndpointProvider(nextMode);
  const cached = providerProfileCache[providerName];
  applyPreset(
    providerName,
    cached?.model,
    cached?.apiKey,
    cached?.baseUrl,
    cached?.displayName,
    cached?.explicitTransport,
  );
  setSaveStatus(cached ? "Reverted to previous config" : nextMode === "local"
    ? "Please enter local service URL and model ID"
    : "Please enter cloud service URL, API Key, and model ID");
});

const CUSTOM_ENDPOINT_GUIDE_BODY = [
  '<section class="custom-endpoint-guide-section">',
  '  <h4>Official Cloud Models</h4>',
  '  <p>Select an adapted provider from the list (OpenAI, Claude, Kimi, DeepSeek, MiniMax, Zhipu GLM, Qwen, Doubao, Xiaomi MiMo) and fill in the API Key obtained from the platform. Base URL and recommended model ID are pre-filled.</p>',
  '  <p class="custom-endpoint-guide-note">Different models from the same provider may differ in structured output, tool calling, and reasoning abilities. Please prioritize using the recommended models in the list.</p>',
  '</section>',
  '<section class="custom-endpoint-guide-section">',
  '  <h4>Custom Endpoints <span>Advanced</span></h4>',
  '  <p>Connect cloud services, local inference services, or third-party proxies that provide OpenAI-compatible APIs. Please fill in the complete Base URL and model ID provided by the service.</p>',
  '  <div class="custom-endpoint-guide-warning"><strong>Local models and custom endpoints are not officially supported.</strong> Actual capabilities depend on the specific inference service implementation. The system does not scan ports, probe models, or auto-upgrade capability tiers. Assess privacy and data security risks before using third-party proxies.</div>',
  '  <p>After saving, click "<strong>Test Connection</strong>" for basic verification. Successful connection only indicates that the service responds, not that structured output, tool calling, and reasoning modes are fully functional.</p>',
  '  <p class="custom-endpoint-guide-security">🔒 Your API Key is only stored locally on your device and will never be uploaded to Cyrene\'s servers.</p>',
  '</section>',
  '<section class="custom-endpoint-guide-section custom-endpoint-faq">',
  '  <h4>Frequently Asked Questions</h4>',
  '  <details>',
  '    <summary>Local model response format error</summary>',
  '    <p>Many local inference services lack stable constrained decoding or full protocol implementations; occasionally outputting extraneous text, Markdown fences, or incomplete JSON is common. The system uses local validation and automatic repair fallbacks; for higher stability, official cloud models are recommended.</p>',
  '  </details>',
  '  <details>',
  '    <summary>MiniMax Reasoning Mode Failed</summary>',
  '    <p>MiniMax does not recommend enabling reasoning while in JSON mode. The system automatically handles this conflict according to verified configurations, prioritizing the stability of structured results.</p>',
  '  </details>',
  '  <details>',
  '    <summary>Fewer configs for Claude</summary>',
  '    <p>Claude\'s API specification differs from OpenAI-compatible interfaces; certain parameters and structured output tiers do not apply, so fewer configuration items are shown. This is normal and does not affect supported capabilities.</p>',
  '  </details>',
  '</section>',
].join("\n");

customEndpointGuideBtn?.addEventListener("click", () => {
  void showHtmlModal({
    title: "Model Service Integration Guide",
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.5V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7.25" r="1.1" fill="currentColor"/></svg>',
    htmlBody: CUSTOM_ENDPOINT_GUIDE_BODY,
  });
});

// ──  Work  ──────────────────────────────
// ；"" app .
const WORK_FLOW_COMPAT_MD = `## Model Compatibility

> Cyrene automatically selects the corresponding Structured Output Profile based on the provider.

| Provider | Support Status | Tier | Tested Models | Notes |
| OpenAI | Documented | A | - | Protocol implemented, ready for testing. |
| Claude | Documented | A | - | Protocol implemented, ready for testing. |
| Doubao | Verified | A | Seed 2.1 Turbo / Pro | Recommended, stable workflow execution. |
| Kimi | Verified | A | K2.6, K2.7 Code | Recommended with standard API. |
| DeepSeek | Verified | B | V4 Flash, V4 Pro | Recommended, fast and stable. |
| Qwen | Verified | B | Qwen3.7 Max | Recommended, stable performance. |
| GLM | Verified | B | GLM 5.1, 5.2 | Recommended. |
| MiMo | Verified | B | MiMo 2.5, 2.5 Pro | Recommended, stable performance. |
| MiniMax | Verified | M | MiniMax M3 | Recommended, requires Tier M adaptation. |
| Other | Documented | D | - | Generic compatibility mode. |

### Tier Descriptions
- **A**: Native JSON Schema / Function Calling
- **B**: JSON Object + Local Validation
- **M**: MiniMax dedicated adapter
- **D**: Generic compatibility mode (unknown models / custom endpoints)
`;

function buildWorkFlowAdaptBody(): string {
  const rendered = renderMarkdown(WORK_FLOW_COMPAT_MD);
  const tableHtml = rendered.mode === "html" ? rendered.content : "";
  return [
    '<div class="custom-endpoint-guide-warning work-flow-adapt-meta">',
    "  <strong>Model Provider Workflow Adaptation</strong>",
    '  <span class="work-flow-adapt-date">Updated July 2026</span>',
    '  <p class="work-flow-adapt-disclaimer">Compatibility conclusions based on tests for reference; full details in documentation..</p>',
    "</div>",
    '<p class="work-flow-adapt-doc-line">',
    '  Full test pipeline and evaluation rules available at',
    '  <button type="button" class="work-flow-adapt-doc-link" id="work-flow-adapt-doc-link"> ↗</button>',
    "</p>",
    `<div class="work-flow-adapt-table">${tableHtml}</div>`,
  ].join("\n");
}

workFlowAdaptBtn?.addEventListener("click", () => {
  void showHtmlModal({
    title: "Model Provider Workflow Adaptation",
    icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.5V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="7.25" r="1.1" fill="currentColor"/></svg>',
    htmlBody: buildWorkFlowAdaptBody(),
  });
  // "" app （?raw  md + renderMarkdown)
  const docLink = document.querySelector(
    "#cy-html-modal-body #work-flow-adapt-doc-link",
  ) as HTMLButtonElement | null;
  docLink?.addEventListener("click", () => {
    const rendered = renderMarkdown(workFlowDocMd);
    const docHtml = rendered.mode === "html" ? rendered.content : "";
    void showHtmlModal({
      title: "Detailed Documentation",
      icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 3h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
      htmlBody: `<div class="work-flow-doc">${docHtml}</div>`,
    });
    // （ chat  code-block controller，)
    const copyBtns = document.querySelectorAll<HTMLButtonElement>(
      "#cy-html-modal-body .code-block__copy",
    );
    copyBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const code =
          btn.closest(".code-block")?.querySelector(".code-block__code")?.textContent ?? "";
        void navigator.clipboard.writeText(code).then(() => {
          const orig = btn.textContent;
          btn.textContent = "Copied";
          window.setTimeout(() => {
            btn.textContent = orig;
          }, 1200);
        });
      });
    });
  });
});

// ： adapter 
if (testConnectionBtn) {
  testConnectionBtn.addEventListener("click", async () => {
    const provider = activeProvider;
    const baseUrl = baseUrlInput.value;
    const model = getCurrentModelValue().trim();
    const customValidationError = validateActiveCustomEndpoint();
    if (customValidationError) {
      setSaveStatus(customValidationError, "is-error");
      return;
    }
    const apiKey = getApiKeyForRequest();
    if (!apiKey) { setSaveStatus("Enter an API key before testing.", "is-error"); return; }
    if (!model) { setSaveStatus("Please select/enter a model before testing", "is-error"); return; }
    setSaveStatus("Testing connection…");
    testConnectionBtn.disabled = true;
    try {
      const result = await window.settings!.testConnection({
        provider,
        baseUrl,
        model,
        apiKey,
        explicitTransport: transportSelect.value as ProviderProfile["explicitTransport"],
        reasoning: providerProfileCache[activeProvider]?.reasoning,
      });
      if (result.ok) setSaveStatus("Connected " + result.latency + "ms · " + (result.sample ?? ""), "is-ok");
      else setSaveStatus("Connection failed: " + (result.error ?? "Unknown error"), "is-error");
    } catch (e) {
      setSaveStatus("Connection failed: " + (e instanceof Error ? e.message : String(e)), "is-error");
    } finally {
      testConnectionBtn.disabled = false;
    }
  });
}

// ──  ──────────────────────────────────────
// ：ON ，OFF 
multimodalToggle.addEventListener("change", () => {
  applyMultimodalUI();
  setSaveStatus("Unsaved changes");
});

// Base URL ： baseUrl
baseUrlResetBtn.addEventListener("click", () => {
  const preset = findPreset(activeProvider);
  if (preset) {
    baseUrlInput.value = preset.baseUrl;
    setSaveStatus("Reset to provider default URL");
  }
});

// （ OFF )
testVisionBtn.addEventListener("click", async () => {
  const baseUrl = visionBaseUrlInput.value;
  const apiKey = visionApiKeyInput.value;
  const model = visionModelInput.value;
  const isLocal = !baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("::1");
  if (!apiKey && !isLocal) { visionTestStatus.textContent = "Enter an API key first."; return; }
  if (!model) { visionTestStatus.textContent = "Enter a vision model first."; return; }
  visionTestStatus.textContent = "Testing…";
  testVisionBtn.disabled = true;
  try {
    const result = await window.settings!.testVision?.({ baseUrl, apiKey, model });
    if (result?.ok) visionTestStatus.textContent = "✅ Connected " + result.latency + "ms · " + (result.sample ?? "");
    else visionTestStatus.textContent = "❌ " + (result?.error ?? "Unknown error");
  } catch (e) {
    visionTestStatus.textContent = "❌ " + (e instanceof Error ? e.message : String(e));
  } finally {
    testVisionBtn.disabled = false;
  }
});

function toLocalDateTimeInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatSchedulerDate(value: string | null | undefined): string {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid time";
  return date.toLocaleString();
}

function describeSchedule(schedule: ScheduleConfig): string {
  if (schedule.kind === "once") return "Once " + formatSchedulerDate(schedule.runAt);
  if (schedule.kind === "daily") return "Daily " + schedule.timeOfDay;
  if (schedule.kind === "weekly") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${names[schedule.dayOfWeek]} ${schedule.timeOfDay}`;
  }
  return `Every ${schedule.every} ${schedule.unit === "minutes" ? "minutes" : "hours"}`;
}

function setSchedulerStatus(text: string, className = ""): void {
  if (!schedulerSaveStatus) return;
  schedulerSaveStatus.textContent = text;
  schedulerSaveStatus.className = "save-status" + (className ? " " + className : "");
}

function renderSchedulerTools(selectedIds: string[] = []): void {
  if (!schedulerToolPicker) return;
  schedulerToolPicker.replaceChildren();
  const selected = new Set(selectedIds);
  for (const tool of schedulerTools) {
    const label = document.createElement("label");
    label.className = "scheduler-tool-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tool.id;
    checkbox.checked = selected.has(tool.id);
    checkbox.addEventListener("change", updateSchedulerConditionalFields);
    const copy = document.createElement("span");
    copy.textContent = `${tool.name} (${tool.id}) · ${tool.risk}${tool.enabled ? "" : " · globally disabled"}`;
    label.appendChild(checkbox);
    label.appendChild(copy);
    schedulerToolPicker.appendChild(label);
  }
}

async function renderSchedulerList(): Promise<void> {
  if (!schedulerList || !schedulerEmpty) return;
  schedulerList.replaceChildren();
  schedulerEmpty.classList.toggle("is-hidden", schedulerTasks.length > 0);
  for (const task of schedulerTasks) {
    const card = document.createElement("article");
    card.className = "scheduler-card";
    card.innerHTML = `
      <div class="scheduler-card__head">
        <div class="scheduler-card__title"><span><svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M23.9998 44.3332C34.1251 44.3332 42.3332 36.1251 42.3332 25.9999C42.3332 15.8747 34.1251 7.66656 23.9998 7.66656C13.8746 7.66656 5.6665 15.8747 5.6665 25.9999C5.6665 36.1251 13.8746 44.3332 23.9998 44.3332Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23.7594 15.3536L23.7582 26.3624L31.5305 34.1347" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.00001L11 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 9.00001L37 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><strong></strong><span class="scheduler-badge"></span></div>
      </div>
      <div class="scheduler-card__meta"></div>
      <div class="scheduler-card__actions"></div>
      <div class="scheduler-history is-hidden"></div>
    `;
    const strong = card.querySelector("strong");
    if (strong) strong.textContent = task.title;
    const badge = card.querySelector(".scheduler-badge") as HTMLSpanElement | null;
    if (badge) {
      badge.textContent = task.enabled ? "Enabled" : "Disabled";
      badge.classList.toggle("is-disabled", !task.enabled);
    }
    const meta = card.querySelector(".scheduler-card__meta");
    if (meta) meta.textContent = `${describeSchedule(task.schedule)} · Next run: ${formatSchedulerDate(task.nextFireAt)} · Tools: ${task.toolMode === "all-enabled" ? "All enabled tools" : task.allowedToolIds.join(", ") || "None"}`;
    const actions = card.querySelector(".scheduler-card__actions") as HTMLDivElement | null;
    if (actions) {
      const fireBtn = document.createElement("button");
      fireBtn.type = "button";
      fireBtn.className = "ghost-btn";
      fireBtn.textContent = "Run Now";
      fireBtn.addEventListener("click", () => void fireSchedulerTask(task.id));
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => void openSchedulerEditor(task));
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "ghost-btn";
      toggleBtn.textContent = task.enabled ? "Disable" : "Enable";
      toggleBtn.addEventListener("click", () => void toggleSchedulerTask(task.id, !task.enabled));
      const historyBtn = document.createElement("button");
      historyBtn.type = "button";
      historyBtn.className = "ghost-btn";
      historyBtn.textContent = "History";
      historyBtn.addEventListener("click", () => void toggleSchedulerHistory(task.id, card));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => void deleteSchedulerTask(task.id));
      actions.append(fireBtn, editBtn, toggleBtn, historyBtn, deleteBtn);
    }
    schedulerList.appendChild(card);
  }
}

appearanceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAppearanceSaveStatus("Saving…");
  try {
    await window.settings!.saveGeneral(buildAppearanceSettingsPatch({
      uiTheme: getUiThemeValue(),
      uiIcon: getUiIconValue(),
      petAlwaysOnTop: petAlwaysOnTopInput.checked,
      petVisible: petVisibleInput.checked,
      petZoom: Number(petZoomInput.value),
      chatLineHeight: Number(chatLineHeightInput.value),
      chatParaSpacing: Number(chatParaSpacingInput.value),
    }));
    setAppearanceSaveStatus("Saved", "is-ok");
  } catch {
    setAppearanceSaveStatus("Save failed", "is-error");
  }
});

generalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setGeneralSaveStatus("Saving…");
  try {
    await window.settings!.saveGeneral({
      musicEnabled: musicEnabledInput.checked,
      musicVolume: Number(musicVolumeInput.value),
      soundEnabled: soundEnabledInput.checked,
      soundVolume: Number(soundVolumeInput.value),
      sidebarVisible: sidebarVisibleInput.checked,
      tasksVisible: tasksVisibleInput.checked,
      launchAtLogin: launchAtLoginInput.checked,
      language: "en-US",
    });
    setGeneralSaveStatus("Saved", "is-ok");
  } catch {
    setGeneralSaveStatus("Save failed", "is-error");
  }
});

cyrenePanel.addEventListener("submit", async (e) => {
  e.preventDefault();
  setCyreneSaveStatus("Saving…");
  try {
    const parsedTimeoutSec = Math.max(30, Math.min(1800, parseInt(chatRequestTimeoutSecInput.value, 10) || 300));
    const parsedMaxIterations = Math.max(5, Math.min(30, parseInt(maxIterationsInput.value, 10) || 12));
    const parsedMaxReplans = Math.max(1, Math.min(5, parseInt(maxReplansInput.value, 10) || 2));
    const parsedMaxRefresh = Math.max(0, Math.min(3, parseInt(maxRefreshInput.value, 10) || 1));
    const parsedPerCallSec = Math.max(30, Math.min(120, parseInt(perCallTimeoutSecInput.value, 10) || 75));
    const parsedCitaSec = Math.max(4, Math.min(30, parseInt(citaRepairBudgetSecInput.value, 10) || 8));
    const parsedAgSec = Math.max(5, Math.min(40, parseInt(actionGateRepairBudgetSecInput.value, 10) || 10));
    await window.settings!.saveConfig({
      runtimeSync: getRuntimeSyncValue(),
      stickerEnabled: stickerEnabledInput.checked,
      stickerSize: getStickerSizeValue(),
      stickerSimilarityThreshold: parseFloat(stickerThresholdInput.value),
      chatRequestTimeoutSec: parsedTimeoutSec,
      maxIterations: parsedMaxIterations,
      maxReplans: parsedMaxReplans,
      maxRefresh: parsedMaxRefresh,
      perCallTimeoutSec: parsedPerCallSec,
      citaRepairBudgetSec: parsedCitaSec,
      actionGateRepairBudgetSec: parsedAgSec,
    });
    setCyreneSaveStatus("Saved", "is-ok");
  } catch {
    setCyreneSaveStatus("Save failed", "is-error");
  }
});

apiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const customValidationError = validateActiveCustomEndpoint();
  if (customValidationError) {
    setSaveStatus(customValidationError, "is-error");
    return;
  }
  setSaveStatus("Saving…");
  try {
    //  perProvider （main ，，
    // )
    captureActiveProviderProfile();
    // mode  UI Delete， main （).
    //  "manual"（baseUrl 、， Manual).
    await window.settings!.saveConfig({
      mode: "manual",
      provider: activeProvider,
      displayName: displayNameInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      model: getCurrentModelValue().trim(),
      apiKey: getApiKeyForRequest(),
      explicitTransport: transportSelect.value as "openai" | "anthropic" | "auto",
      reasoning: providerProfileCache[activeProvider]?.reasoning,
      perProvider: { ...providerProfileCache },
      multimodal: multimodalToggle.checked,
      // ，（ ON )
      vision: {
        baseUrl: visionBaseUrlInput.value.trim(),
        apiKey: visionApiKeyInput.value.trim(),
        model: visionModelInput.value.trim(),
      },
    });
    setSaveStatus("Saved", "is-ok");
  } catch {
    setSaveStatus("Save failed", "is-error");
  }
});

async function loadSchedulerPanel(): Promise<void> {
  const [tasksResult, toolsResult] = await Promise.all([
    window.cyreneScheduler!.list(),
    window.cyreneScheduler!.getTools(),
  ]);
  if (tasksResult.ok) schedulerTasks = tasksResult.value ?? [];
  if (toolsResult.ok) schedulerTools = toolsResult.value ?? [];
  renderSchedulerTools();
  await renderSchedulerList();
}

async function openSchedulerEditor(task?: ScheduledTask): Promise<void> {
  editingSchedulerTaskId = task?.id ?? null;
  schedulerEditor?.classList.remove("is-hidden");
  // 
  if (schedulerTools.length === 0) {
    const toolsResult = await window.cyreneScheduler!.getTools();
    if (toolsResult.ok) schedulerTools = toolsResult.value ?? [];
  }
  if (schedulerEditorTitle) schedulerEditorTitle.textContent = task ? "Edit Scheduled Task" : "New Scheduled Task";
  if (schedulerTitleInput) schedulerTitleInput.value = task?.title ?? "";
  if (schedulerPromptInput) schedulerPromptInput.value = task?.prompt ?? "";
  if (schedulerEnabledInput) schedulerEnabledInput.checked = task?.enabled ?? true;
  if (schedulerKindInput) schedulerKindInput.value = task?.schedule.kind ?? "daily";
  if (schedulerOnceRunAtInput) schedulerOnceRunAtInput.value = "";
  if (schedulerTimeOfDayInput) schedulerTimeOfDayInput.value = "08:00";
  if (schedulerDayOfWeekInput) schedulerDayOfWeekInput.value = "1";
  if (schedulerIntervalEveryInput) schedulerIntervalEveryInput.value = "1";
  if (schedulerIntervalUnitInput) schedulerIntervalUnitInput.value = "minutes";
  if (task?.schedule.kind === "once" && schedulerOnceRunAtInput) schedulerOnceRunAtInput.value = toLocalDateTimeInputValue(task.schedule.runAt);
  if ((task?.schedule.kind === "daily" || task?.schedule.kind === "weekly") && schedulerTimeOfDayInput) schedulerTimeOfDayInput.value = task.schedule.timeOfDay;
  if (task?.schedule.kind === "weekly" && schedulerDayOfWeekInput) schedulerDayOfWeekInput.value = String(task.schedule.dayOfWeek);
  if (task?.schedule.kind === "interval") {
    if (schedulerIntervalEveryInput) schedulerIntervalEveryInput.value = String(task.schedule.every);
    if (schedulerIntervalUnitInput) schedulerIntervalUnitInput.value = task.schedule.unit;
  }
  if (schedulerToolLimitInput) schedulerToolLimitInput.checked = task?.toolMode === "allow-list";
  renderSchedulerTools(task?.allowedToolIds ?? []);
  updateSchedulerConditionalFields();
  setSchedulerStatus("Waiting for action");
}

function closeSchedulerEditor(): void {
  editingSchedulerTaskId = null;
  schedulerEditor?.classList.add("is-hidden");
}

function updateSchedulerConditionalFields(): void {
  const kind = schedulerKindInput?.value ?? "daily";
  document.querySelectorAll(".scheduler-once-field").forEach(el => el.classList.toggle("is-hidden", kind !== "once"));
  document.querySelectorAll(".scheduler-time-field").forEach(el => el.classList.toggle("is-hidden", kind !== "daily" && kind !== "weekly"));
  document.querySelectorAll(".scheduler-weekly-field").forEach(el => el.classList.toggle("is-hidden", kind !== "weekly"));
  document.querySelectorAll(".scheduler-interval-field").forEach(el => el.classList.toggle("is-hidden", kind !== "interval"));
  const allowListEnabled = Boolean(schedulerToolLimitInput?.checked);
  schedulerToolPicker?.classList.toggle("is-hidden", !allowListEnabled);
  const selectedCount = collectAllowedToolIds().length;
  schedulerToolEmptyHint?.classList.toggle("is-hidden", !allowListEnabled || selectedCount > 0);
}

function collectSchedule(): ScheduleConfig {
  const kind = schedulerKindInput?.value ?? "daily";
  if (kind === "once") {
    const value = schedulerOnceRunAtInput?.value;
    if (!value) throw new Error("Please select one-time run time");
    const runAt = new Date(value);
    if (Number.isNaN(runAt.getTime())) throw new Error("One-time run time is invalid");
    if (runAt.getTime() <= Date.now()) throw new Error("One-time task time must be in the future");
    return { kind: "once", runAt: runAt.toISOString() };
  }
  if (kind === "weekly") {
    const timeOfDay = schedulerTimeOfDayInput?.value || "08:00";
    if (!isValidTimeOfDay(timeOfDay)) throw new Error("Weekly time format must be HH:mm");
    const dayOfWeek = Number(schedulerDayOfWeekInput?.value ?? 1);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error("");
    return { kind: "weekly", dayOfWeek: dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6, timeOfDay };
  }
  if (kind === "interval") {
    const every = Number(schedulerIntervalEveryInput?.value ?? 1);
    const unit = schedulerIntervalUnitInput?.value === "hours" ? "hours" : "minutes";
    if (!Number.isInteger(every) || every <= 0) throw new Error("Interval must be a positive integer");
    if (unit === "minutes" && every > 1440) throw new Error("Minute interval cannot exceed 1440");
    if (unit === "hours" && every > 168) throw new Error("Hour interval cannot exceed 168");
    return { kind: "interval", every, unit };
  }
  const timeOfDay = schedulerTimeOfDayInput?.value || "08:00";
  if (!isValidTimeOfDay(timeOfDay)) throw new Error("Daily schedule time format must be HH:mm");
  return { kind: "daily", timeOfDay };
}

function collectAllowedToolIds(): string[] {
  if (!schedulerToolPicker) return [];
  return Array.from(schedulerToolPicker.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(input => input.value);
}

async function saveSchedulerTask(): Promise<void> {
  try {
    setSchedulerStatus("Saving…");
    const title = (schedulerTitleInput?.value ?? "").trim();
    const prompt = (schedulerPromptInput?.value ?? "").trim();
    if (!title) throw new Error("Title cannot be empty");
    if (!prompt) throw new Error("Prompt cannot be empty");
    const input = {
      title,
      prompt,
      enabled: schedulerEnabledInput?.checked ?? true,
      schedule: collectSchedule(),
      toolMode: schedulerToolLimitInput?.checked ? "allow-list" : "all-enabled",
      allowedToolIds: collectAllowedToolIds(),
    };
    const result = editingSchedulerTaskId
      ? await window.cyreneScheduler!.update(editingSchedulerTaskId, input)
      : await window.cyreneScheduler!.add(input);
    if (!result.ok) throw new Error(result.error ?? "Save failed");
    await loadSchedulerPanel();
    closeSchedulerEditor();
  } catch (err) {
    setSchedulerStatus(err instanceof Error ? err.message : String(err), "is-error");
  }
}

async function toggleSchedulerTask(id: string, enabled: boolean): Promise<void> {
  const result = await window.cyreneScheduler!.toggle(id, enabled);
  if (!result.ok) await showAlert(result.error ?? "Switch failed");
  await loadSchedulerPanel();
}

async function fireSchedulerTask(id: string): Promise<void> {
  const result = await window.cyreneScheduler!.fireNow(id);
  if (!result.ok) await showAlert(result.reason === "task already running" ? "This task is already running" : (result.error ?? result.reason ?? "Failed to run task"));
}

async function deleteSchedulerTask(id: string): Promise<void> {
  const ok = await showModal({ title: "Delete Scheduled Task", message: "Delete this scheduled task?", icon: '<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-2px"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15H40L37 44H11L8 15Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M20.002 25.0024V35.0026" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M28.0024 24.9995V34.9972" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 14.9999L28.3242 3L36 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>', confirmText: "Delete", danger: true });
  if (!ok) return;
  const result = await window.cyreneScheduler!.delete(id);
  if (!result.ok) await showAlert(result.error ?? "Delete failed");
  await loadSchedulerPanel();
}

async function toggleSchedulerHistory(taskId: string, card: Element): Promise<void> {
  const box = card.querySelector(".scheduler-history") as HTMLDivElement | null;
  if (!box) return;
  if (!box.classList.contains("is-hidden")) {
    box.classList.add("is-hidden");
    return;
  }
  const result = await window.cyreneScheduler!.getHistory(taskId, 10);
  const rows = result.value ?? [];
  box.replaceChildren();
  if (!result.ok || rows.length === 0) {
    box.textContent = result.ok ? "No run history yet" : (result.error ?? "Failed to load history");
  } else {
    for (const row of rows) {
      const div = document.createElement("div");
      div.textContent = `${formatSchedulerDate(row.firedAt)} ${row.status}${row.durationMs ? ` ${Math.round(row.durationMs / 100) / 10}s` : ""}：${row.outputPreview ?? row.errorMessage ?? row.reason ?? ""}`;
      box.appendChild(div);
    }
  }
  box.classList.remove("is-hidden");
}

function switchSection(section: string): void {
  const label = NAV_LABELS[section] ?? NAV_LABELS.api;
  sectionTitle.textContent = label.title;
  sectionHint.textContent = label.hint;

  const isApi = section === "api";
  const isAppearance = section === "appearance";
  const isGeneral = section === "general";
  const isPreferences = section === "preferences";
  const isCyrene = section === "cyrene";
  const isDisclaimer = section === "disclaimer";
  const isMemory = section === "memory";
  const isUser = section === "user";
  const isChat = section === "chat";
  const isTasks = section === "tasks";
  const isPlugins = section === "plugins";
  const isSkills = section === "skills";
  const isTokens = section === "tokens";
  const isChannels = section === "channels";
  const isTts = section === "tts";
  const isAsr = section === "asr";
  const isMusic = section === "music";
  apiForm.classList.toggle("is-hidden", !isApi);
  appearanceForm.classList.toggle("is-hidden", !isAppearance);
  generalForm.classList.toggle("is-hidden", !isGeneral);
  preferencesForm.classList.toggle("is-hidden", !isPreferences);
  cyrenePanel.classList.toggle("is-hidden", !isCyrene);
  disclaimerPanel.classList.toggle("is-hidden", !isDisclaimer);
  const memoryPanel = document.getElementById("memory-panel");
  if (memoryPanel) memoryPanel.classList.toggle("is-hidden", !isMemory);
  const userPanel = document.getElementById("user-panel");
  if (userPanel) userPanel.classList.toggle("is-hidden", !isUser);
  const chatPanel = document.getElementById("chat-panel");
  if (chatPanel) chatPanel.classList.toggle("is-hidden", !isChat);
  //  💬 （cross-window  onChanged )
  if (isChat) void renderChatSessions();
  const tasksPanel = document.getElementById("tasks-panel");
  if (tasksPanel) tasksPanel.classList.toggle("is-hidden", !isTasks);
  if (isTasks) void loadSchedulerPanel();
  pluginsPanel.classList.toggle("is-hidden", !isPlugins);
  const skillsPanel = document.getElementById("skills-panel");
  if (skillsPanel) skillsPanel.classList.toggle("is-hidden", !isSkills);
  if (isSkills) void renderSkills();
  const tokenPanel = document.getElementById("token-panel");
  if (tokenPanel) tokenPanel.classList.toggle("is-hidden", !isTokens);
  const channelsPanel = document.getElementById("channels-panel");
  if (channelsPanel) channelsPanel.classList.toggle("is-hidden", !isChannels);
  if (isChannels) void loadChannelsPanel();
  const ttsPanel = document.getElementById("tts-panel");
  if (ttsPanel) ttsPanel.classList.toggle("is-hidden", !isTts);
  const asrPanel = document.getElementById("asr-panel");
  if (asrPanel) asrPanel.classList.toggle("is-hidden", !isAsr);
  const musicPanel = document.getElementById("music-panel");
  if (musicPanel) musicPanel.classList.toggle("is-hidden", !isMusic);
  if (isMusic) void loadMusicPanel();
  else disposeMusicPanel();
  placeholderPanel.classList.toggle(
    "is-hidden",
    isApi || isAppearance || isGeneral || isPreferences || isCyrene || isDisclaimer || isMemory || isUser || isChat || isTasks || isPlugins || isSkills || isTokens || isChannels || isTts || isAsr || isMusic,
  );

  if (
    !isApi &&
    !isAppearance &&
    !isGeneral &&
    !isPreferences &&
    !isCyrene &&
    !isDisclaimer &&
    !isMemory &&
    !isUser &&
	    !isChat &&
	    !isTasks &&
	    !isPlugins &&
    !isSkills &&
    !isTokens &&
    !isChannels &&
    !isTts &&
    !isAsr &&
    !isMusic
  ) {
	    placeholderIcon.innerHTML = label.emoji;
    placeholderTitle.textContent = label.title;
    placeholderCopy.textContent = "This module is reserved for future expansion.";
  }

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("is-active", (el as HTMLElement).dataset.section === section);
  });
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => {
    const section = (el as HTMLElement).dataset.section;
    if (section) switchSection(section);
  });
});

schedulerNewBtn?.addEventListener("click", () => void openSchedulerEditor());
schedulerEditorClose?.addEventListener("click", closeSchedulerEditor);
schedulerCancelBtn?.addEventListener("click", closeSchedulerEditor);
schedulerSaveBtn?.addEventListener("click", () => void saveSchedulerTask());
schedulerKindInput?.addEventListener("change", updateSchedulerConditionalFields);
schedulerToolLimitInput?.addEventListener("change", updateSchedulerConditionalFields);
updateSchedulerConditionalFields();

// ===== （ plugins ，MCP 、)=====
function initGameBotPluginCard(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gb = (window as any).gameBot as {
    getConfig: () => Promise<{ enabled: boolean; exePath: string; activeRecipe: string; vlm: { baseUrl: string; apiKey: string; model: string } }>;
    saveConfig: (c: unknown) => Promise<unknown>;
    listRecipes: () => Promise<{ id: string; name: string }[]>;
    listRefs: (r: string) => Promise<string[]>;
    refsDir: (r: string) => Promise<string>;
    start: () => Promise<{ ok: boolean; error?: string }>;
    stop: () => Promise<unknown>;
    onProgress: (cb: (i: unknown) => void) => (() => void) | void;
  } | undefined;
  if (!gb) return;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const enabledCb = $<HTMLInputElement>("plugin-gamebot-enabled");
  const configEl = $("plugin-gamebot-config");
  const exe = $<HTMLInputElement>("gamebot-exe");
  const url = $<HTMLInputElement>("gamebot-vlm-url");
  const key = $<HTMLInputElement>("gamebot-vlm-key");
  const model = $<HTMLInputElement>("gamebot-vlm-model");
  const recipeSel = $<HTMLSelectElement>("gamebot-recipe");
  const refsDirEl = $("gamebot-refs-dir");
  const refsListEl = $("gamebot-refs-list");
  const startBtn = $<HTMLButtonElement>("gamebot-start-btn");
  const stopBtn = $<HTMLButtonElement>("gamebot-stop-btn");
  const logEl = $("gamebot-log");
  if (!enabledCb || !configEl || !exe || !url || !key || !model || !recipeSel) return;

  let currentRecipe = "star-rail-daily";

  function appendLog(line: string): void {
    if (!logEl) return;
    logEl.textContent = new Date().toLocaleTimeString() + " " + line + "\n" + (logEl.textContent ?? "");
  }

  async function refreshRefs(): Promise<void> {
    if (refsDirEl) refsDirEl.textContent = await gb!.refsDir(currentRecipe);
    const refs = await gb!.listRefs(currentRecipe);
    if (refsListEl) {
      refsListEl.innerHTML = refs.length
        ? "Available reference images: " + refs.map((r) => "<code>" + r + "</code>").join(" ")
        : "(No reference images yet. Place cropped images into the directory above)";
    }
  }

  async function refresh(): Promise<void> {
    const cfg = await gb!.getConfig();
    enabledCb!.checked = cfg.enabled;
    configEl!.style.display = cfg.enabled ? "block" : "none";
    exe.value = cfg.exePath;
    url.value = cfg.vlm.baseUrl;
    key.value = cfg.vlm.apiKey;
    model.value = cfg.vlm.model;
    currentRecipe = cfg.activeRecipe;
    const recipes = await gb!.listRecipes();
    recipeSel.innerHTML = "";
    for (const r of recipes) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name + " (" + r.id + ")";
      if (r.id === currentRecipe) opt.selected = true;
      recipeSel.appendChild(opt);
    }
    await refreshRefs();
  }

  // ：/ enabled 
  enabledCb.addEventListener("change", async () => {
    configEl.style.display = enabledCb.checked ? "block" : "none";
    await gb.saveConfig({ enabled: enabledCb.checked });
  });

  // 
  const saveFields = () => gb.saveConfig({
    exePath: exe.value.trim(),
    activeRecipe: recipeSel.value,
    vlm: { baseUrl: url.value.trim(), apiKey: key.value.trim(), model: model.value.trim() },
  });
  for (const el of [exe, url, key, model]) el.addEventListener("change", () => void saveFields());
  recipeSel.addEventListener("change", () => { currentRecipe = recipeSel.value; void saveFields().then(refreshRefs); });

  startBtn?.addEventListener("click", async () => {
    const r = await gb.start();
    appendLog(r.ok ? "Automation started" : "Failed to start: " + (r.error ?? ""));
  });
  stopBtn?.addEventListener("click", () => { void gb.stop(); appendLog("Stop requested"); });

  gb.onProgress((info) => {
    const i = info as { index: number; total: number; desc: string };
    appendLog(i.desc + (i.index >= 0 ? " (" + (i.index + 1) + "/" + i.total + ")" : ""));
  });

  void refresh();
}

initGameBotPluginCard();
void loadConfig();
void loadGeneralSettings();
window.settings?.onChannelsStatusChanged((status) => {
  renderProactiveDeliveryAvailability(status as Record<string, { phase?: string }>);
});

// ===== channels panel () =====
const channelsWechatEnabledEl = document.getElementById("channels-wechat-enabled") as HTMLInputElement | null;
const channelsFeishuEnabledEl = document.getElementById("channels-feishu-enabled") as HTMLInputElement | null;
const channelsWechatStatusEl = document.getElementById("channels-wechat-status");
const channelsFeishuStatusEl = document.getElementById("channels-feishu-status");
const channelsRateUserEl = document.getElementById("channels-rate-user") as HTMLInputElement | null;
const channelsRateChannelEl = document.getElementById("channels-rate-channel") as HTMLInputElement | null;
const channelsTtsEl = document.getElementById("channels-tts-enabled") as HTMLInputElement | null;
const channelsStickerEl = document.getElementById("channels-sticker-enabled") as HTMLInputElement | null;
const channelsMirrorEl = document.getElementById("channels-mirror-desktop") as HTMLInputElement | null;
const channelsToolSandboxOffEl = document.getElementById("channels-tool-sandbox-off") as HTMLInputElement | null;
const channelsToolSandboxAllEl = document.getElementById("channels-tool-sandbox-all") as HTMLInputElement | null;
const channelsToolSandboxSafeEl = document.getElementById("channels-tool-sandbox-safe") as HTMLInputElement | null;
// （Phase 2 ： App ID + App Secret)
const channelsFeishuAppIdEl = document.getElementById("channels-feishu-app-id") as HTMLInputElement | null;
const channelsFeishuAppSecretEl = document.getElementById("channels-feishu-app-secret") as HTMLInputElement | null;
const channelsFeishuAppSecretRevealBtn = document.getElementById("channels-feishu-app-secret-reveal");
const channelsFeishuSaveBtn = document.getElementById("channels-feishu-save");
// 
const channelsWechatLoginBtn = document.getElementById("channels-wechat-login");
const channelsWechatRestartBtn = document.getElementById("channels-wechat-restart");
const channelsWechatFeedbackEl = document.getElementById("channels-wechat-feedback");
const channelsFeishuFeedbackEl = document.getElementById("channels-feishu-feedback");

let channelsInitialized = false;
let channelsSaveTimer: number | null = null;

function renderChannelStatus(el: HTMLElement | null, phase: string, message?: string): void {
  if (!el) return;
  const dot = el.querySelector(".channels-status__dot");
  const text = el.querySelector(".channels-status__text");
  if (dot) {
    dot.className = "channels-status__dot";
    if (phase === "running") dot.classList.add("channels-status__dot--running");
    else if (phase === "starting") dot.classList.add("channels-status__dot--starting");
    else if (phase === "error") dot.classList.add("channels-status__dot--error");
    else if (phase === "config_missing") dot.classList.add("channels-status__dot--config_missing");
    else dot.classList.add("channels-status__dot--offline");
  }
  if (text) text.textContent = message ?? (phase === "running" ? "Running" : phase === "starting" ? "Starting" : phase === "config_missing" ? "Missing Config" : phase === "error" ? "Error" : "Disabled");
}

async function loadChannelsPanel(): Promise<void> {
  if (channelsInitialized) return;
  channelsInitialized = true;
  try {
    const cfg = await window.settings.channelsGetConfig();
    if (channelsWechatEnabledEl) channelsWechatEnabledEl.checked = !!cfg.wechat.enabled;
    if (channelsFeishuEnabledEl) channelsFeishuEnabledEl.checked = !!cfg.feishu.enabled;
    if (channelsRateUserEl) channelsRateUserEl.value = String(cfg.rateLimitPerUser ?? 10);
    if (channelsRateChannelEl) channelsRateChannelEl.value = String(cfg.rateLimitPerChannel ?? 100);
    if (channelsTtsEl) channelsTtsEl.checked = cfg.ttsEnabled !== false;
    if (channelsStickerEl) channelsStickerEl.checked = cfg.stickerEnabled !== false;
    if (channelsMirrorEl) channelsMirrorEl.checked = cfg.mirrorToDesktop !== false;
    if (channelsToolSandboxOffEl) channelsToolSandboxOffEl.checked = cfg.toolSandbox === "off";
    if (channelsToolSandboxAllEl) channelsToolSandboxAllEl.checked = cfg.toolSandbox === "all";
    if (channelsToolSandboxSafeEl) channelsToolSandboxSafeEl.checked = cfg.toolSandbox === "safe-only";

    // （ App ID；secret ，UI )
    if (channelsFeishuAppIdEl) channelsFeishuAppIdEl.value = cfg.feishu.appId ?? "";
    if (channelsFeishuAppSecretEl) {
      channelsFeishuAppSecretEl.value = "";
      channelsFeishuAppSecretEl.placeholder = cfg.feishu.appSecret
        ? "Saved (enter a new value to overwrite)"
        : "Encrypted when clicking Save Settings";
    }

    // 
    const status = (await window.settings.channelsGetStatus()) as Record<string, { phase: string; message?: string }>;
    renderProactiveDeliveryAvailability(status);
    renderChannelStatus(channelsWechatStatusEl, status.wechat?.phase ?? "offline", status.wechat?.message);
    renderChannelStatus(channelsFeishuStatusEl, status.feishu?.phase ?? "offline", status.feishu?.message);
    // Phase 3.4：
    void refreshChannelsLog();
  } catch (err) {
    console.warn("[Channels] Failed to load channels panel:", err);
  }

  // （debounce 200ms)
  const scheduleSave = () => {
    if (channelsSaveTimer != null) window.clearTimeout(channelsSaveTimer);
    channelsSaveTimer = window.setTimeout(() => {
      void window.settings.channelsSaveConfig({
        wechat: { enabled: channelsWechatEnabledEl?.checked ?? false },
        feishu: { enabled: channelsFeishuEnabledEl?.checked ?? false },
        rateLimitPerUser: Number(channelsRateUserEl?.value) || 10,
        rateLimitPerChannel: Number(channelsRateChannelEl?.value) || 100,
        ttsEnabled: channelsTtsEl?.checked ?? true,
        stickerEnabled: channelsStickerEl?.checked ?? true,
        mirrorToDesktop: channelsMirrorEl?.checked ?? true,
        toolSandbox: channelsToolSandboxOffEl?.checked
          ? "off"
          : channelsToolSandboxSafeEl?.checked
            ? "safe-only"
            : "all",
      });
    }, 200);
  };
  for (const el of [
    channelsWechatEnabledEl,
    channelsFeishuEnabledEl,
    channelsRateUserEl,
    channelsRateChannelEl,
    channelsTtsEl,
    channelsStickerEl,
    channelsMirrorEl,
    channelsToolSandboxOffEl,
    channelsToolSandboxAllEl,
    channelsToolSandboxSafeEl,
  ]) {
    el?.addEventListener("change", scheduleSave);
  }

  // （Phase 1+ )
  window.settings.onChannelsInstallProgress((progress) => {
    const target = progress.channel === "wechat" ? channelsWechatStatusEl : progress.channel === "feishu" ? channelsFeishuStatusEl : null;
    if (target) renderChannelStatus(target, "starting", `${progress.phase} ${progress.pct}%`);
  });
  window.settings.onChannelsStatusChanged((status) => {
    const s = status as Record<string, { phase: string; message?: string }>;
    renderProactiveDeliveryAvailability(s);
    renderChannelStatus(channelsWechatStatusEl, s.wechat?.phase ?? "offline", s.wechat?.message);
    renderChannelStatus(channelsFeishuStatusEl, s.feishu?.phase ?? "offline", s.feishu?.message);
  });

  // ===== （Phase 2 ) =====

  // / App Secret
  channelsFeishuAppSecretRevealBtn?.addEventListener("click", () => {
    if (!channelsFeishuAppSecretEl) return;
    channelsFeishuAppSecretEl.type =
      channelsFeishuAppSecretEl.type === "password" ? "text" : "password";
  });

  // （secret  safeStorage  + )
  channelsFeishuSaveBtn?.addEventListener("click", async () => {
    setFeishuFeedback("info", "Saving and connecting...");
    const patch: Record<string, unknown> = {
      feishu: {
        enabled: channelsFeishuEnabledEl?.checked ?? false,
        appId: channelsFeishuAppIdEl?.value.trim() || undefined,
      },
    };
    //  secret（)
    if (channelsFeishuAppSecretEl?.value) {
      (patch.feishu as Record<string, unknown>).appSecret = channelsFeishuAppSecretEl.value;
    }
    try {
      await window.settings.channelsSaveConfig(patch);
      //  adapter  + 
      await window.settings.channelsRestart();
      setFeishuFeedback("ok", "Saved. Feishu connection establishing...");
      // （)， placeholder "Saved"
      if (channelsFeishuAppSecretEl) {
        channelsFeishuAppSecretEl.value = "";
        channelsFeishuAppSecretEl.placeholder = "Saved (enter a new value to overwrite)";
      }
    } catch (err) {
      setFeishuFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  // ===== （ iLink HTTP API， src/main/channels/adapters/wechat/) =====

  function setWechatFeedback(kind: "info" | "ok" | "err", msg: string): void {
    if (!channelsWechatFeedbackEl) return;
    channelsWechatFeedbackEl.textContent = msg;
    channelsWechatFeedbackEl.className = "channels-feedback";
    if (kind === "ok") channelsWechatFeedbackEl.classList.add("channels-feedback--ok");
    else if (kind === "err") channelsWechatFeedbackEl.classList.add("channels-feedback--err");
    else channelsWechatFeedbackEl.classList.add("channels-feedback--info");
  }

  // ：Main Process  PNG →  Renderer → modal 
  const channelsWechatQrEl = document.getElementById("channels-wechat-qr");
  const channelsWechatQrImgEl = document.getElementById("channels-wechat-qr-img") as HTMLImageElement | null;
  const channelsWechatQrCloseBtn = document.getElementById("channels-wechat-qr-close");
  const channelsWechatQrBackdrop = document.getElementById("channels-wechat-qr-backdrop");

  function showWechatQr(dataUrl: string): void {
    if (channelsWechatQrImgEl) {
      channelsWechatQrImgEl.src = dataUrl;
      channelsWechatQrImgEl.classList.remove("is-empty");
    }
    channelsWechatQrEl?.removeAttribute("hidden");
  }
  function hideWechatQr(): void {
    channelsWechatQrEl?.setAttribute("hidden", "");
    if (channelsWechatQrImgEl) {
      channelsWechatQrImgEl.src = "";
      channelsWechatQrImgEl.classList.add("is-empty");
    }
  }

  // ： /  /  ESC
  channelsWechatQrCloseBtn?.addEventListener("click", hideWechatQr);
  channelsWechatQrBackdrop?.addEventListener("click", hideWechatQr);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && channelsWechatQrEl && !channelsWechatQrEl.hasAttribute("hidden")) {
      hideWechatQr();
    }
  });

  //  Main （)
  window.settings.onChannelsWechatQrcode((dataUrl) => {
    console.log("[WechatSettings] QR event received, dataUrl prefix:", dataUrl?.slice(0, 40), "len:", dataUrl?.length);
    showWechatQr(dataUrl);
    setWechatFeedback("info", "Please scan QR code with WeChat");
  });
  //  Main （ /  / )
  window.settings.onChannelsWechatLoginDone((payload) => {
    hideWechatQr();
    if (payload.ok) {
      setWechatFeedback("ok", `Logged in (botId=${payload.botId ?? "?"})`);
    } else {
      setWechatFeedback("err", `Login failed: ${payload.error ?? "Unknown error"}`);
    }
  });

  channelsWechatLoginBtn?.addEventListener("click", async () => {
    hideWechatQr();
    setWechatFeedback("info", "Starting QR login...");
    try {
      const result = await window.settings.channelsWechatLoginStart();
      if (result.ok) {
        //  onChannelsWechatQrcode ；Notice
        setWechatFeedback("info", "Waiting for QR code...");
      } else {
        setWechatFeedback("err", result.error ?? "Failed to start");
      }
    } catch (err) {
      setWechatFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });

  // 
  channelsWechatRestartBtn?.addEventListener("click", async () => {
    setWechatFeedback("info", "Reconnecting...");
    try {
      await window.settings.channelsRestart();
      setWechatFeedback("ok", "Reconnected");
    } catch (err) {
      setWechatFeedback("err", err instanceof Error ? err.message : String(err));
    }
  });
}

function setFeishuFeedback(kind: "info" | "ok" | "err", msg: string): void {
  if (!channelsFeishuFeedbackEl) return;
  channelsFeishuFeedbackEl.textContent = msg;
  channelsFeishuFeedbackEl.className = "channels-feedback";
  if (kind === "ok") channelsFeishuFeedbackEl.classList.add("channels-feedback--ok");
  else if (kind === "err") channelsFeishuFeedbackEl.classList.add("channels-feedback--err");
  else channelsFeishuFeedbackEl.classList.add("channels-feedback--info");
}

// ===== Phase 3.4： =====
const channelsLogListEl = document.getElementById("channels-log-list");
const channelsLogRefreshBtn = document.getElementById("channels-log-refresh");
const channelsLogClearBtn = document.getElementById("channels-log-clear");

interface LogEntry {
  at: string;
  dir: "incoming" | "outgoing";
  channel: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  text: string;
  hasAttachments?: boolean;
}

function renderChannelsLog(entries: LogEntry[]): void {
  if (!channelsLogListEl) return;
  if (entries.length === 0) {
    channelsLogListEl.innerHTML = '<p class="empty-hint">No messages yet.</p>';
    return;
  }
  const html = entries
    .map((e) => {
      const t = new Date(e.at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const ss = String(t.getSeconds()).padStart(2, "0");
      const dir = e.dir === "incoming" ? "← Received" : "→ Reply";
      const who = e.senderName ? `${e.senderName} (${e.senderId})` : e.senderId;
      const safe = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const text = e.text.length > 280 ? safe(e.text.slice(0, 280)) + "…" : safe(e.text);
      return `<div class="channels-log__entry channels-log__entry--${e.dir}">
        <div class="channels-log__meta">${hh}:${mm}:${ss} · ${dir} · ${safe(e.channel)} · ${safe(who)}</div>
        <div class="channels-log__text">${text}</div>
      </div>`;
    })
    .join("");
  channelsLogListEl.innerHTML = html;
}

async function refreshChannelsLog(): Promise<void> {
  try {
    const entries = (await window.settings.channelsLogGet(100)) as LogEntry[];
    renderChannelsLog(entries);
  } catch (err) {
    console.warn("[Channels] Failed to refresh channels log:", err);
  }
}

channelsLogRefreshBtn?.addEventListener("click", () => void refreshChannelsLog());
channelsLogClearBtn?.addEventListener("click", async () => {
  const confirmed = await showConfirm({
    title: "Clear Logs",
    message: "Clear all bot message logs?",
    confirmText: "Clear",
    cancelText: "Cancel",
    icon: "🗑️",
    danger: true,
  });
  if (!confirmed) return;
  await window.settings.channelsLogClear();
  await refreshChannelsLog();
});

//  channels panel 
// （ details ，)
void loadChannelsPanel();

// ===== Phase 2:  =====
// ：window.music.*  preload  contextBridge .
//  renderer  Vite 、main/preload  esbuild，，
//  (window as any).music ， global.d.ts  cross-bundle .

interface MusicSelectionTrack {
  id: string;
  name: string;
  artists: string[];
  album?: string;
  durationMs?: number;
}

interface MusicSelectionResult {
  setId: string;
  source: string;
  query?: string;
  tracks: MusicSelectionTrack[];
}

type MusicIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: string; backendState?: string; accountState?: string; playerState?: string };

interface MusicApi {
  getStatus: () => Promise<MusicIpcResult<MusicStatusSnapshot>>;
  beginLogin: () => Promise<MusicIpcResult<{ loginSessionId: string; qrContent: string; expiresAt: number; pollIntervalMs: number }>>;
  cancelLogin: () => Promise<MusicIpcResult<unknown>>;
  logout: () => Promise<MusicIpcResult<unknown>>;
  search: (keyword: string, limit?: number) => Promise<MusicIpcResult<MusicSelectionResult>>;
  playTrack: (trackId: string) => Promise<MusicIpcResult<{ state: "dispatched" | "web_fallback" | "client_unavailable" | "launch_failed" }>>;
  onStateChanged: (h: (s: MusicStatusSnapshot) => void) => (() => void) | void;
}

function getMusicApi(): MusicApi | null {
  const w = window as unknown as { music?: MusicApi };
  return w.music ?? null;
}

const musicHomeView = document.getElementById("music-home-view");
const neteaseDetailView = document.getElementById("netease-detail-view");
const musicReturnBtn = document.getElementById("music-return-btn");
const musicSearchForm = document.getElementById("music-search-form");
const musicSearchHint = document.getElementById("music-search-hint");
const musicQrStatus = document.getElementById("music-qr-status");
const musicProfileAvatar = document.getElementById("music-profile-avatar") as HTMLImageElement | null;
const musicLoginBtn = document.getElementById("music-login-btn") as HTMLButtonElement | null;
const musicCancelBtn = document.createElement("button");
const musicDisconnectBtn = document.createElement("button");

const musicQrImg = document.getElementById("music-qr-img") as HTMLImageElement | null;
const musicQrTip = document.getElementById("music-qr-tip");
const musicQrBox = document.getElementById("music-qr") as HTMLElement | null;
const musicFeedbackEl = document.getElementById("music-feedback");
const musicAccountStatusText = document.getElementById("music-account-status-text");
const musicSearchInput = document.getElementById("music-search-input") as HTMLInputElement | null;
const musicSearchBtn = document.getElementById("music-search-btn") as HTMLButtonElement | null;
const musicSearchResults = document.getElementById("music-search-results");

let musicPanelInitialized = false;
let musicStateUnsub: (() => void) | null = null;
let musicLoginPollTimer: number | null = null;
let musicLastQrDataUrl: string | null = null;

function setMusicFeedback(kind: "info" | "ok" | "err", msg: string): void {
  if (!musicFeedbackEl) return;
  musicFeedbackEl.textContent = msg;
  musicFeedbackEl.className = "music-feedback";
  if (kind === "ok") musicFeedbackEl.classList.add("music-feedback--ok");
  else if (kind === "err") musicFeedbackEl.classList.add("music-feedback--err");
  else musicFeedbackEl.classList.add("music-feedback--info");
}

function renderMusicStatus(snapshot: MusicStatusSnapshot): void {
  const state = deriveNeteaseViewState(snapshot);
  const labels: Record<NeteaseViewState, string> = {
    backend_starting: "Music service unavailable", backend_error: "Music service unavailable", signed_out: "Not connected",
    creating_qr: "Waiting for scan", waiting_scan: "Waiting for scan", waiting_confirm: "Scanned, confirm on mobile",
    login_expired: "QR code expired", login_failed: "Login failed", connected: "Connected to NetEase Music", connected_without_client: "Logged in, but desktop client not detected",
  };
  if (musicAccountStatusText) musicAccountStatusText.textContent = labels[state];
  const musicStatusDot = document.getElementById("music-status-dot");
  if (musicStatusDot) musicStatusDot.classList.toggle("is-connected", state === "connected" || state === "connected_without_client");
  const actionHost = document.getElementById("music-actions");
  if (actionHost) {
    actionHost.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = state === "signed_out" || state === "backend_error" ? "btn-primary" : "btn-secondary";
    const actions: Partial<Record<NeteaseViewState, string>> = { signed_out: "Connect NetEase", creating_qr: "Cancel", waiting_scan: "Cancel", waiting_confirm: "Cancel", login_expired: "Regenerate QR", login_failed: "Retry login", connected: "Disconnect", connected_without_client: "Disconnect", backend_error: "Restart music service" };
    if (actions[state]) { button.textContent = actions[state]!; button.addEventListener("click", () => void handleMusicAction(state)); actionHost.appendChild(button); }
  }
  const loggedIn = state === "connected" || state === "connected_without_client";
  musicSearchForm?.classList.toggle("is-hidden", !loggedIn);
  if (musicSearchHint) musicSearchHint.textContent = loggedIn ? "Search NetEase Music library." : "Connect NetEase Music to search songs and get daily recommendations.";
  musicQrBox?.classList.toggle("is-hidden", !(state === "creating_qr" || state === "waiting_scan" || state === "waiting_confirm" || state === "login_expired"));
  if (musicQrStatus) musicQrStatus.textContent = state === "connected" || state === "connected_without_client" ? "Status: NetEase Music Connected" : state === "waiting_confirm" ? "Status: Awaiting phone confirmation" : state === "login_expired" ? "Status: QR code expired" : "Status: Waiting for QR scan";
}

async function handleMusicAction(state: NeteaseViewState): Promise<void> {
  const api = getMusicApi(); if (!api) { setMusicFeedback("err", "Music API not ready"); return; }
  if (state === "signed_out" || state === "login_expired" || state === "login_failed") return void startMusicLogin();
  if (state === "connected" || state === "connected_without_client") {
    setMusicFeedback("info", "Disconnecting...");
    try {
      const r = await api.logout();
    if (r.ok) setMusicFeedback("ok", "Disconnected");
    else setMusicFeedback("err", "Disconnect failed: " + r.errorCode);
    } catch (err) {
      setMusicFeedback("err", "Disconnect error: " + (err instanceof Error ? err.message : String(err)));
    }
    return;
  }
  if (state === "creating_qr" || state === "waiting_scan" || state === "waiting_confirm") { await api.cancelLogin?.(); clearMusicQr(); }
}

function updateMusicActionsForAccount(account: string): void {
  // Login-in-progress ： IPC  creating_qr / waiting_scan / waiting_confirm，
  // " + account ".
  // ：
  //   - account === "signed_in"      →  
  //   - account === "temporarily_unavailable" →  （)
  //   -  →  Cancel
  //   -  →  
  const qrVisible = !!musicQrBox && !musicQrBox.classList.contains("is-hidden");
  if (musicLoginBtn) musicLoginBtn.classList.toggle("is-hidden", qrVisible || account === "signed_in");
  if (musicCancelBtn) musicCancelBtn.classList.toggle("is-hidden", !qrVisible);
  if (musicDisconnectBtn) musicDisconnectBtn.classList.toggle("is-hidden", account !== "signed_in");
}

function clearMusicQr(): void {
  if (musicQrImg) { musicQrImg.style.display = "none"; musicQrImg.src = ""; }
  if (musicQrBox) musicQrBox.classList.add("is-hidden");
  if (musicQrTip) musicQrTip.textContent = "Scan the QR code with the NetEase Music app to log in";
  musicLastQrDataUrl = null;
}

function showMusicQr(dataUrl: string, tip: string): void {
  if (musicQrImg) { musicQrImg.src = dataUrl; musicQrImg.style.display = "block"; }
  if (musicQrTip) musicQrTip.textContent = tip;
  if (musicQrBox) musicQrBox.classList.remove("is-hidden");
  musicLastQrDataUrl = dataUrl;
}

function stopMusicLoginPolling(): void {
  if (musicLoginPollTimer != null) {
    window.clearInterval(musicLoginPollTimer);
    musicLoginPollTimer = null;
  }
}

function startMusicLoginPolling(pollIntervalMs = 2000): void {
  stopMusicLoginPolling();
  const api = getMusicApi();
  if (!api) return;
  musicLoginPollTimer = window.setInterval(async () => {
    try {
      const r = await api.getStatus();
      if (r.ok) {
        renderMusicStatus(r.data);
        if (r.data.account === "signed_in") {
          //  →  QR 、
          clearMusicQr();
          stopMusicLoginPolling();
          setMusicFeedback("ok", "Connected to NetEase Music");
        } else if (r.data.flow === "expired" || r.data.flow === "failed" || r.data.flow === "cancelled") {
          stopMusicLoginPolling();
          if (r.data.flow !== "expired") clearMusicQr();
          setMusicFeedback("err", r.data.flow === "expired" ? "QR code expired, please regenerate" : "Login incomplete, please retry");
        } else if (r.data.account === "temporarily_unavailable" || r.data.account === "expired") {
          stopMusicLoginPolling();
          clearMusicQr();
          setMusicFeedback("err", "Login failed: account state " + r.data.account);
        }
      }
    } catch (err) {
      console.warn("[music] login poll failed", err);
    }
  }, Math.max(1000, pollIntervalMs));
}

async function startMusicLogin(): Promise<void> {
  const api = getMusicApi();
  if (!api) {
    setMusicFeedback("err", "Music plugin not ready. Make sure the music plugin is registered.");
    return;
  }
  setMusicFeedback("info", "Generating QR code...");
  try {
    const r = await api.beginLogin();
    if (!r.ok) {
      setMusicFeedback("err", "Failed to start login: " + r.errorCode);
      // 
      const snapshot: MusicStatusSnapshot = {
        backend: r.backendState ?? "unknown",
        account: r.accountState ?? "unknown",
        player: r.playerState ?? "unknown",
      };
      renderMusicStatus(snapshot);
      return;
    }
    //  qrcode  qrContent  PNG dataURL
    let dataUrl = "";
    try {
      // qrcode  d.ts； require  esbuild 
      // （renderer  Vite，import  OK； import )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qrcodeMod: any = await import(/* @vite-ignore */ "qrcode");
      dataUrl = await qrcodeMod.toDataURL(r.data.qrContent, { width: 240, margin: 1 });
    } catch (qrErr) {
      console.error("[music] Failed to render QR", qrErr);
      setMusicFeedback("err", "Failed to render QR code");
      return;
    }
    showMusicQr(dataUrl, "Scan the QR code with the NetEase Music app to log in");
    setMusicFeedback("info", "Waiting for scan...");
    updateMusicActionsForAccount("signed_out"); // "Cancel"
    startMusicLoginPolling(r.data.pollIntervalMs);
  } catch (err) {
    console.error("[music] beginLogin threw", err);
    setMusicFeedback("err", "Login error: " + (err instanceof Error ? err.message : String(err)));
  }
}

async function cancelMusicLogin(): Promise<void> {
  const api = getMusicApi();
  if (!api) return;
  stopMusicLoginPolling();
  clearMusicQr();
  setMusicFeedback("info", "Login cancelled");
  try {
    await api.cancelLogin();
  } catch (err) {
    console.warn("[music] cancelLogin threw", err);
  }
  //  status  UI 
  try {
    const r = await api.getStatus();
    if (r.ok) renderMusicStatus(r.data);
  } catch (err) {
    console.warn("[music] getStatus after cancel failed", err);
  }
}

async function disconnectMusic(): Promise<void> {
  //  disconnect API； cancelLogin （ loginSession)，
  //  UI "". music.disconnect.
  setMusicFeedback("info", "Disconnecting...");
  await cancelMusicLogin();
  setMusicFeedback("ok", "Disconnected (session cleared)");
}

function renderMusicSearchResults(r: MusicIpcResult<MusicSelectionResult>, kw: string): void {
  if (!musicSearchResults) return;
  musicSearchResults.innerHTML = "";
  if (!r.ok) {
    const div = document.createElement("div");
    div.className = "music-feedback music-feedback--err";
    div.textContent = "Search failed: " + r.errorCode;
    musicSearchResults.appendChild(div);
    return;
  }
  const tracks = r.data.tracks ?? [];
  if (tracks.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    // 
    const safeKw = kw.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    p.textContent = `No results for '${safeKw}' — no songs matched`;
    musicSearchResults.appendChild(p);
    return;
  }
  for (const t of tracks) {
    const row = document.createElement("div");
    row.className = "music-search-row";

    const main = document.createElement("div");
    main.className = "music-search-row__main";
    const name = document.createElement("div");
    name.className = "music-search-row__name";
    name.textContent = t.name;
    const meta = document.createElement("div");
    meta.className = "music-search-row__meta";
    const artistStr = (t.artists ?? []).join(" / ");
    meta.textContent = [artistStr, t.album].filter(Boolean).join(" · ");
    main.appendChild(name);
    main.appendChild(meta);

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-secondary music-search-row__play";
    playBtn.textContent = "▶ Play";
    playBtn.addEventListener("click", async () => {
      const api = getMusicApi();
      if (!api) {
        setMusicFeedback("err", "Music plugin not ready");
        return;
      }
      playBtn.disabled = true;
      try {
        const feedback = await requestTrackPlayback(api, t);
        setMusicFeedback(feedback.kind, feedback.message);
      } catch (err) {
        setMusicFeedback("err", "Playback error: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        playBtn.disabled = false;
      }
    });

    row.appendChild(main);
    row.appendChild(playBtn);
    musicSearchResults.appendChild(row);
  }
}

async function runMusicSearch(): Promise<void> {
  const api = getMusicApi();
  if (!api) {
    setMusicFeedback("err", "Music plugin not ready");
    return;
  }
  const kw = (musicSearchInput?.value ?? "").trim();
  if (!kw) {
    setMusicFeedback("info", "Please enter search keywords");
    return;
  }
  if (musicSearchResults) musicSearchResults.innerHTML = '<p class="empty-hint">Searching…</p>';
  try {
    const r = await api.search(kw, 20);
    renderMusicSearchResults(r, kw);
  } catch (err) {
    console.error("[music] search threw", err);
    if (musicSearchResults) musicSearchResults.innerHTML = "";
    setMusicFeedback("err", "Search error: " + (err instanceof Error ? err.message : String(err)));
  }
}

async function loadMusicPanel(): Promise<void> {
  if (musicPanelInitialized) return;
  musicPanelInitialized = true;

  // （ →  music panel)，
  //  attach，.

  musicLoginBtn?.addEventListener("click", () => void startMusicLogin());
  musicCancelBtn?.addEventListener("click", () => void cancelMusicLogin());
  musicDisconnectBtn?.addEventListener("click", () => void disconnectMusic());

  // 
  musicSearchBtn?.addEventListener("click", () => void runMusicSearch());
  musicSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void runMusicSearch();
  });

  // 
  const api = getMusicApi();
  if (api && typeof api.onStateChanged === "function") {
    const unsub = api.onStateChanged((s) => renderMusicStatus(s));
    if (typeof unsub === "function") musicStateUnsub = unsub;
  }

  // 
  if (api) {
    try {
      const r = await api.getStatus();
      if (r.ok) renderMusicStatus(r.data);
      else setMusicFeedback("err", "Failed to read status: " + r.errorCode);
    } catch (err) {
      console.warn("[music] getStatus failed", err);
    }
  } else {
    setMusicFeedback("err", "Music plugin not ready");
  }
}

// ──  status （ music ) ────────
//  MCP " / Not connected".
//  unsub ， music .
(() => {
  const api = getMusicApi();
  if (!api || typeof api.onStateChanged !== "function") return;
  try {
    api.onStateChanged((s) => {
      // ， music  renderMusicStatus 
      const el = document.getElementById("music-platform-status");
      if (!el) return;
      const state = deriveNeteaseViewState(s);
      const connected = state === "connected" || state === "connected_without_client";
      el.textContent = connected ? "Connected" : "Not connected";
      el.classList.toggle("is-connected", connected);
    });
    api.getStatus().then((r) => {
      if (!r.ok) return;
      const el = document.getElementById("music-platform-status");
      if (!el) return;
      const state = deriveNeteaseViewState(r.data);
      const connected = state === "connected" || state === "connected_without_client";
      el.textContent = connected ? "Connected" : "Not connected";
      el.classList.toggle("is-connected", connected);
    }).catch(() => { /* ignore */ });
  } catch {
    /* window.music ， */
  }
})();

function disposeMusicPanel(): void {
  // ：、Cancel、 QR dataURL 
  stopMusicLoginPolling();
  if (musicStateUnsub) {
    try { musicStateUnsub(); } catch { /* ignore */ }
    musicStateUnsub = null;
  }
  clearMusicQr();
  setMusicFeedback("info", "");
}
//  URL hash （main  loadURL  #api " API").
// None hash  general.
const initialSection = (window.location.hash || "#general").slice(1);
switchSection(initialSection);
//  main （，main  loadURL，)
window.settings?.onSwitchSection?.((section) => {
  switchSection(section);
});
/* ===== RAG model card toggle (embedding only) ===== */
(function () {
  const cards = document.querySelectorAll<HTMLButtonElement>(".rag-model-card:not([data-reranker])");
  const KEY = "cyrene.rag.model";
  const saved = localStorage.getItem(KEY) || "minilm";
  cards.forEach((card) => {
    const value = card.dataset.value;
    if (!value) return;
    card.classList.toggle("is-active", value === saved);
    card.addEventListener("click", async () => {
      const previousActive = document.querySelector(".rag-model-card.is-active:not([data-reranker])") as HTMLElement | null;
      const previousValue = previousActive?.dataset.value;

      // Optimistic UI update
      cards.forEach((c) => c.classList.remove("is-active"));
      card.classList.add("is-active");
      localStorage.setItem(KEY, value);

      // Call IPC to hot-switch the embedding model
      try {
        const result = await (window as any).settings?.embeddingSetModel?.(value);
        if (result?.ok) {
          console.log("[settings] embedding switched to", value, "cleared:", result.clearedEntries);
          if (result.clearedEntries && result.clearedEntries > 0) {
            await showAlert("Switched to " + (value === "bgem3" ? "BGE-M3" : "MiniLM") + ". Cleared existing data due to different vector dimensions." + result.clearedEntries + " ");
          }
        } else {
          // Rollback on failure
          cards.forEach((c) => c.classList.remove("is-active"));
          if (previousValue) {
            const prevCard = document.querySelector('.rag-model-card[data-value="' + previousValue + '"]:not([data-reranker])');
            prevCard?.classList.add("is-active");
            localStorage.setItem(KEY, previousValue);
          }
          await showAlert("Switch failed: " + (result?.error || "Unknown error"));
        }
      } catch (err) {
        // Rollback on error
        cards.forEach((c) => c.classList.remove("is-active"));
        if (previousValue) {
          const prevCard = document.querySelector('.rag-model-card[data-value="' + previousValue + '"]:not([data-reranker])');
          prevCard?.classList.add("is-active");
          localStorage.setItem(KEY, previousValue);
        }
        console.error("[settings] embedding switch error:", err);
      }
    });
  });
})();
/* ===== Reranker mode toggle ===== */
(function () {
  const cards = document.querySelectorAll<HTMLButtonElement>(".rag-model-card[data-reranker]");
  const KEY = "cyrene.reranker.mode";
  const saved = localStorage.getItem(KEY) || "light";
  cards.forEach((card) => {
    const value = card.dataset.value;
    if (!value) return;
    card.classList.toggle("is-active", value === saved);
    card.addEventListener("click", async () => {
      const previousActive = document.querySelector(".rag-model-card.is-active[data-reranker]") as HTMLElement | null;
      const previousValue = previousActive?.dataset.value;

      cards.forEach((c) => c.classList.remove("is-active"));
      card.classList.add("is-active");
      localStorage.setItem(KEY, value);
      try {
        await (window as any).settings?.rerankerSetMode?.(value);
      } catch (err) {
        // Rollback on failure
        cards.forEach((c) => c.classList.remove("is-active"));
        if (previousValue) {
          const prevCard = document.querySelector('.rag-model-card[data-value="' + previousValue + '"][data-reranker]');
          prevCard?.classList.add("is-active");
          localStorage.setItem(KEY, previousValue);
        }
        console.warn("[Reranker] set mode failed:", err);
      }
    });
  });
})();

/* ===== Reranker install status (real on-disk check via IPC) ===== */
(async () => {
  const lightEl = document.getElementById("reranker-light-status");
  const standardEl = document.getElementById("reranker-standard-status");
  try {
    const status = await (window as any).settings?.getRerankerStatus?.();
    if (!status) return;
    if (lightEl) lightEl.textContent = status.light ? "Downloaded · ~23MB" : "Not downloaded · Optional";
    if (standardEl) standardEl.textContent = status.standard ? "Downloaded · ~279MB" : "Not downloaded · Optional";
  } catch (err) {
    console.warn("[Reranker] status check failed:", err);
    if (lightEl) lightEl.textContent = "Status unknown";
    if (standardEl) standardEl.textContent = "Status unknown";
  }
})();

/* ===== Embedding model status ===== */
(async () => {
  const bgem3El = document.getElementById("embedding-bgem3-status");
  const minilmEl = document.getElementById("embedding-minilm-status");
  try {
    const status = await window.modelConfig?.getModelInstallStatus?.();
    if (!status) {
      if (bgem3El) bgem3El.textContent = "Status unknown";
      if (minilmEl) minilmEl.textContent = "Status unknown";
      return;
    }
    if (bgem3El) bgem3El.textContent = status.embedding?.bgem3 ? "Downloaded · ~570MB" : "Not downloaded";
    if (minilmEl) minilmEl.textContent = status.embedding?.minilm ? "Downloaded · ~23MB" : "Not downloaded";
  } catch (err) {
    console.warn("[Embedding] status check failed:", err);
    if (bgem3El) bgem3El.textContent = "Status unknown";
    if (minilmEl) minilmEl.textContent = "Status unknown";
  }
})();

/* ===== Embedding download / delete ===== */
(function () {
  const downloadBtn = document.getElementById("embedding-download-btn") as HTMLButtonElement | null;
  const deleteBtn = document.getElementById("embedding-delete-btn") as HTMLButtonElement | null;
  const mirrorGroup = document.getElementById("embedding-mirror") as HTMLElement | null;

  function getSelectedMirror(): string {
    const active = mirrorGroup?.querySelector(".option-block.is-active") as HTMLElement | null;
    return active?.dataset.value || "official";
  }

  function getSelectedModel(): string {
    const active = document.querySelector(".rag-model-card.is-active:not([data-reranker])") as HTMLElement | null;
    return active?.dataset.value || "minilm";
  }

  downloadBtn?.addEventListener("click", async () => {
    // 
    await window.system?.openExternal(
      "https://github.com/Playa-0v0/Cyrene-Agent/blob/master/docs/local-models.md"
    );
  });


  deleteBtn?.addEventListener("click", async () => {
    const model = getSelectedModel();
    const name = model === "minilm" ? "MiniLM" : "BGE-M3";
    const confirmed = await showConfirm({
      title: "Delete Model",
      message: `Delete model: ${name}?`,
      icon: "⚠️",
      confirmText: "Delete",
      cancelText: "Cancel",
      danger: true,
    });
    if (!confirmed) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";
    try {
      const result = await window.settings?.deleteEmbeddingModel?.(model);
      if (result?.ok) {
        deleteBtn.textContent = "✅ Deleted";
        setTimeout(() => location.reload(), 800);
      } else {
        deleteBtn.textContent = "\u274C \u5931\u8D25";
        deleteBtn.disabled = false;
      }
    } catch (err) {
      deleteBtn.textContent = "\u274C \u5931\u8D25";
      deleteBtn.disabled = false;
    }
  });

  // Mirror source toggle
  mirrorGroup?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-value]") as HTMLElement | null;
    if (!btn) return;
    const value = btn.dataset.value;
    if (!value) return;
    mirrorGroup.querySelectorAll(".option-block").forEach((b) => {
      const v = b.getAttribute("data-value");
      b.classList.toggle("is-active", v === value);
      b.setAttribute("aria-pressed", v === value ? "true" : "false");
    });
    localStorage.setItem("cyrene.rag.mirror", value);
  });

  // Restore saved mirror on load
  const savedMirror = localStorage.getItem("cyrene.rag.mirror") || "official";
  mirrorGroup?.querySelectorAll(".option-block").forEach((b) => {
    const v = b.getAttribute("data-value");
    b.classList.toggle("is-active", v === savedMirror);
    b.setAttribute("aria-pressed", v === savedMirror ? "true" : "false");
  });
})();
(function () {
  const updateBtn = document.getElementById("embedding-update-btn") as HTMLButtonElement | null;
  updateBtn?.addEventListener("click", () => {
    updateBtn.textContent = "Already up to date";
    updateBtn.disabled = true;
    setTimeout(() => {
      updateBtn.textContent = "Check for updates";
      updateBtn.disabled = false;
    }, 2000);
  });
})();
// ──  ──
const avatarEl = document.getElementById("user-avatar-el") as HTMLElement | null;
const avatarImg = avatarEl?.querySelector("img") as HTMLImageElement | null;
const avatarPlaceholder = avatarEl?.querySelector("span") as HTMLElement | null;
const uploadAvatarBtn = document.getElementById("upload-avatar-btn") as HTMLButtonElement | null;
const userDefaultCityInput = document.getElementById("user-default-city") as HTMLInputElement | null;
const userNicknameInput = document.getElementById("user-nickname") as HTMLInputElement | null;
const userCallPrefInput = document.getElementById("user-call-pref") as HTMLInputElement | null;
const userBirthdayInput = document.getElementById("user-birthday") as HTMLInputElement | null;
const userTimezoneSelect = document.getElementById("user-timezone") as HTMLSelectElement | null;
const userGenderGroup = document.getElementById("user-gender") as HTMLElement | null;
const memoryL0NameInput = document.getElementById("memory-l0-name") as HTMLInputElement | null;
const memoryL0OccupationInput = document.getElementById("memory-l0-occupation") as HTMLInputElement | null;
const memoryL0InterestsInput = document.getElementById("memory-l0-interests") as HTMLInputElement | null;
const memoryL0LanguageInput = document.getElementById("memory-l0-language") as HTMLInputElement | null;
const memoryL0NoteInput = document.getElementById("memory-l0-note") as HTMLTextAreaElement | null;
const memoryL1GoalsInput = document.getElementById("memory-l1-goals") as HTMLTextAreaElement | null;
const memoryL1PreferencesInput = document.getElementById("memory-l1-preferences") as HTMLTextAreaElement | null;
const memoryL1ProjectInput = document.getElementById("memory-l1-project") as HTMLTextAreaElement | null;
const memoryL2SearchInput = document.getElementById("memory-l2-search") as HTMLInputElement | null;
const memoryL2List = document.getElementById("memory-l2-list") as HTMLElement | null;
const memoryImportedList = document.getElementById("memory-imported-list") as HTMLElement | null;
const memoryReflectionList = document.getElementById("memory-reflection-list") as HTMLElement | null;
const memoryL0EditBtn = document.getElementById("memory-l0-edit-btn") as HTMLButtonElement | null;
const memoryL0CancelBtn = document.getElementById("memory-l0-cancel-btn") as HTMLButtonElement | null;
const memoryL1EditBtn = document.getElementById("memory-l1-edit-btn") as HTMLButtonElement | null;
const memoryL1CancelBtn = document.getElementById("memory-l1-cancel-btn") as HTMLButtonElement | null;

let memoryPanelCache: MemoryPanelPayload | null = null;
let l0Editing = false;
let l1Editing = false;
let l0Snapshot: Record<string, string> | null = null;
let l1Snapshot: Record<string, string> | null = null;

function showAvatar(dataUrl: string | null): void {
  if (!dataUrl || !avatarEl) return;
  if (!avatarEl) return;
  let img = avatarEl.querySelector("img");
  if (!img) {
    img = document.createElement("img");
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.borderRadius = "50%";
    img.style.objectFit = "cover";
    avatarEl.appendChild(img);
  }
  img.src = dataUrl;
  if (avatarPlaceholder) avatarPlaceholder.style.display = "none";
}

function formatDateTime(timestamp: number): string {
  if (!timestamp) return "No timestamp";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "No timestamp";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmptyState(container: HTMLElement | null, title: string, hint: string): void {
  if (!container) return;
  container.innerHTML = [
    '<div class="memory-list__empty">',
    '  <span>📭</span>',
    `  <p>${escapeHtml(title)}</p>`,
    `  <p class="memory-list__hint">${escapeHtml(hint)}</p>`,
    '</div>',
  ].join("\n");
}

function renderInfoList(
  container: HTMLElement | null,
  items: Array<{ title: string; body: string; meta?: string }>,
  emptyTitle: string,
  emptyHint: string,
): void {
  if (!container) return;
  if (items.length === 0) {
    renderEmptyState(container, emptyTitle, emptyHint);
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const meta = item.meta ? `<p class="memory-record__meta">${escapeHtml(item.meta)}</p>` : "";
      return [
        '<article class="memory-record">',
        `  <h3 class="memory-record__title">${escapeHtml(item.title)}</h3>`,
        `  <p class="memory-record__body">${escapeHtml(item.body)}</p>`,
        `  ${meta}`,
        '</article>',
      ].join("\n");
    })
    .join("\n");
}

function renderL2List(query = ""): void {
  const list = memoryPanelCache?.l2 ?? [];
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? list.filter((item) => {
        const haystack = [item.content, item.triggerText, item.status].join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
    : list;

  renderInfoList(
    memoryL2List,
    filtered.map((item) => ({
      title: item.content,
      body: item.triggerText ? `Trigger: ${item.triggerText}` : "No trigger text",
      meta: `Status: ${item.status} · Weight: ${item.weight.toFixed(1)} · Created: ${formatDateTime(item.createdAt)}`,
    })),
    normalized ? "No matching episodic memories" : "No episodic memories yet",
    normalized ? "Try a different keyword" : "Cyrene automatically extracts memories after chatting",
  );
}

async function loadMemoryPanel(): Promise<void> {
  try {
    const payload = await window.memoryPanel?.getData();
    if (!payload) return;
    memoryPanelCache = payload;

    if (memoryL0NameInput) memoryL0NameInput.value = payload.l0.preferredName || "";
    if (memoryL0OccupationInput) memoryL0OccupationInput.value = payload.l0.occupation || "";
    if (memoryL0InterestsInput) memoryL0InterestsInput.value = payload.l0.longTermInterests || "";
    if (memoryL0LanguageInput) memoryL0LanguageInput.value = payload.l0.language || "";
    if (memoryL0NoteInput) memoryL0NoteInput.value = payload.l0.permanentNote || "";

    if (memoryL1GoalsInput) memoryL1GoalsInput.value = payload.l1.recentGoals || "";
    if (memoryL1PreferencesInput) memoryL1PreferencesInput.value = payload.l1.recentPreferences || "";
    if (memoryL1ProjectInput) memoryL1ProjectInput.value = payload.l1.currentProject || "";

    renderL2List(memoryL2SearchInput?.value || "");

        renderImportedDocs();;

    renderInfoList(
      memoryReflectionList,
      payload.reflections,
      "No reflections yet",
      "Reflections have not been generated yet",
    );

    if (memoryL0EditBtn) memoryL0EditBtn.disabled = false;
    if (memoryL1EditBtn) memoryL1EditBtn.disabled = false;
  } catch (err) {
    console.error("[settings] load memory panel failed", err);
    renderEmptyState(memoryL2List, "Failed to load memories", "Check terminal logs");
    renderEmptyState(memoryImportedList, "Failed to load imported knowledge", "Check terminal logs");
    renderEmptyState(memoryReflectionList, "Failed to load reflections", "Check terminal logs");
  }
}

async function loadUserProfile(): Promise<void> {
  try {
    const avatarDataUrl = await window.user?.getAvatar();
    if (avatarDataUrl) showAvatar(avatarDataUrl);
    if (uploadAvatarBtn) uploadAvatarBtn.disabled = false;
    // （////)
    const profile = await window.user?.getProfile();
    if (profile) {
      if (userNicknameInput) userNicknameInput.value = String(profile.nickname ?? "");
      if (userCallPrefInput) userCallPrefInput.value = String(profile.callPreference ?? "");
      if (userBirthdayInput) userBirthdayInput.value = String(profile.birthday ?? "");
      const city = String(profile.defaultCity || "Hanoi");
      if (userDefaultCityInput) userDefaultCityInput.value = city;
      if (weatherCityInput) weatherCityInput.value = city;
      if (userTimezoneSelect) userTimezoneSelect.value = normalizeTimezoneOptionValue(profile.timezone);
      const gender = String(profile.gender ?? "secret");
      if (userGenderGroup) {
        userGenderGroup.querySelectorAll(".gender-select__btn").forEach((btn) => {
          btn.classList.toggle("is-active", (btn as HTMLElement).dataset.gender === gender);
        });
      }
    }
  } catch {
    console.warn("[settings] load user profile failed");
  }
}

function bindUserProfileSave(input: HTMLInputElement | null, field: string): void {
  if (!input) return;
  const save = (): void => { void window.user?.saveProfile({ [field]: input.value.trim() }); };
  input.addEventListener("change", save);
  input.addEventListener("blur", save);
}
bindUserProfileSave(userNicknameInput, "nickname");
bindUserProfileSave(userCallPrefInput, "callPreference");
bindUserProfileSave(userBirthdayInput, "birthday");

if (userDefaultCityInput) {
  const saveCity = (): void => {
    const value = userDefaultCityInput.value.trim() || "Hanoi";
    if (weatherCityInput) weatherCityInput.value = value;
    void window.user?.saveProfile({ defaultCity: value });
  };
  userDefaultCityInput.addEventListener("change", saveCity);
  userDefaultCityInput.addEventListener("blur", saveCity);
}

// ： options； value（select ，)
if (userTimezoneSelect) {
  for (const opt of TIMEZONE_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    userTimezoneSelect.appendChild(o);
  }
  userTimezoneSelect.addEventListener("change", () => {
    const raw = userTimezoneSelect.value;
    // ： DOM， value
    const safe = normalizeTimezoneOptionValue(raw);
    if (safe !== raw) {
      userTimezoneSelect.value = safe;
      return; // ，
    }
    void window.user?.saveProfile({ timezone: safe });
  });
}

// ：，
if (userGenderGroup) {
  userGenderGroup.querySelectorAll(".gender-select__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLElement).dataset.gender;
      if (!value) return;
      userGenderGroup.querySelectorAll(".gender-select__btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      void window.user?.saveProfile({ gender: value });
    });
  });
}

if (uploadAvatarBtn) {
  uploadAvatarBtn.addEventListener("click", async () => {
    try {
      const result = await window.user?.uploadAvatar();
      if (result?.avatarPath) {
        const avatarDataUrl = await window.user?.getAvatar();
        if (avatarDataUrl) showAvatar(avatarDataUrl);
      }
    } catch (err) {
      console.error("[settings] upload avatar failed", err);
    }
  });
}
// --- L0/L1 editable logic ---

function takeL0Snapshot(): Record<string, string> {
  return {
    preferredName: memoryL0NameInput?.value ?? "",
    occupation: memoryL0OccupationInput?.value ?? "",
    longTermInterests: memoryL0InterestsInput?.value ?? "",
    language: memoryL0LanguageInput?.value ?? "",
    permanentNote: memoryL0NoteInput?.value ?? "",
  };
}

function takeL1Snapshot(): Record<string, string> {
  return {
    recentGoals: memoryL1GoalsInput?.value ?? "",
    recentPreferences: memoryL1PreferencesInput?.value ?? "",
    currentProject: memoryL1ProjectInput?.value ?? "",
  };
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function setL0FieldsDisabled(disabled: boolean): void {
  if (memoryL0NameInput) disabled ? memoryL0NameInput.setAttribute("disabled", "") : memoryL0NameInput.removeAttribute("disabled");
  if (memoryL0OccupationInput) disabled ? memoryL0OccupationInput.setAttribute("disabled", "") : memoryL0OccupationInput.removeAttribute("disabled");
  if (memoryL0InterestsInput) disabled ? memoryL0InterestsInput.setAttribute("disabled", "") : memoryL0InterestsInput.removeAttribute("disabled");
  if (memoryL0LanguageInput) disabled ? memoryL0LanguageInput.setAttribute("disabled", "") : memoryL0LanguageInput.removeAttribute("disabled");
  if (memoryL0NoteInput) disabled ? memoryL0NoteInput.setAttribute("disabled", "") : memoryL0NoteInput.removeAttribute("disabled");
}

function setL1FieldsDisabled(disabled: boolean): void {
  if (memoryL1GoalsInput) disabled ? memoryL1GoalsInput.setAttribute("disabled", "") : memoryL1GoalsInput.removeAttribute("disabled");
  if (memoryL1PreferencesInput) disabled ? memoryL1PreferencesInput.setAttribute("disabled", "") : memoryL1PreferencesInput.removeAttribute("disabled");
  if (memoryL1ProjectInput) disabled ? memoryL1ProjectInput.setAttribute("disabled", "") : memoryL1ProjectInput.removeAttribute("disabled");
}

function enterL0EditMode(): void {
  if (l0Editing) return;
  l0Editing = true;
  l0Snapshot = takeL0Snapshot();
  setL0FieldsDisabled(false);
  if (memoryL0EditBtn) memoryL0EditBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M6 9C6 7.34315 7.34315 6 9 6H30.3363C31.132 6 31.895 6.31607 32.4576 6.87868L36.3158 10.7368L41.1213 15.5424C41.6839 16.105 42 16.868 42 17.6637V39C42 40.6569 40.6569 42 39 42H9C7.34315 42 6 40.6569 6 39V9Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M31 26H17C15.3431 26 14 27.3431 14 29V42H34V29C34 27.3431 32.6569 26 31 26Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M29 16H17C15.3431 16 14 14.6569 14 13V6" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Save`;
  if (memoryL0CancelBtn) memoryL0CancelBtn.classList.remove("is-hidden");
}

function exitL0EditMode(): void {
  l0Editing = false;
  l0Snapshot = null;
  setL0FieldsDisabled(true);
  if (memoryL0EditBtn) memoryL0EditBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M5.32497 43.4996L13.81 43.4998L44.9227 12.3871L36.4374 3.90186L5.32471 35.0146L5.32497 43.4996Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M27.9521 12.3872L36.4374 20.8725" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit`;
  if (memoryL0CancelBtn) memoryL0CancelBtn.classList.add("is-hidden");
}

async function saveL0(): Promise<void> {
  const current = takeL0Snapshot();
  if (l0Snapshot && shallowEqual(current, l0Snapshot)) {
    exitL0EditMode();
    return;
  }
  try {
    await window.memoryPanel?.saveL0(current);
    await loadMemoryPanel();
    exitL0EditMode();
    if (memoryL0EditBtn) {
      memoryL0EditBtn.textContent = "✅ Saved";
      setTimeout(() => { if (memoryL0EditBtn && !l0Editing) memoryL0EditBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M5.32497 43.4996L13.81 43.4998L44.9227 12.3871L36.4374 3.90186L5.32471 35.0146L5.32497 43.4996Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M27.9521 12.3872L36.4374 20.8725" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit`; }, 2000);
    }
  } catch (err) {
    console.error("[settings] save L0 failed", err);
    await showAlert("Save failed, please retry");
  }
}

function cancelL0Edit(): void {
  if (l0Snapshot) {
    if (memoryL0NameInput) memoryL0NameInput.value = l0Snapshot.preferredName;
    if (memoryL0OccupationInput) memoryL0OccupationInput.value = l0Snapshot.occupation;
    if (memoryL0InterestsInput) memoryL0InterestsInput.value = l0Snapshot.longTermInterests;
    if (memoryL0LanguageInput) memoryL0LanguageInput.value = l0Snapshot.language;
    if (memoryL0NoteInput) memoryL0NoteInput.value = l0Snapshot.permanentNote;
  }
  exitL0EditMode();
}

function enterL1EditMode(): void {
  if (l1Editing) return;
  l1Editing = true;
  l1Snapshot = takeL1Snapshot();
  setL1FieldsDisabled(false);
  if (memoryL1EditBtn) memoryL1EditBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M6 9C6 7.34315 7.34315 6 9 6H30.3363C31.132 6 31.895 6.31607 32.4576 6.87868L36.3158 10.7368L41.1213 15.5424C41.6839 16.105 42 16.868 42 17.6637V39C42 40.6569 40.6569 42 39 42H9C7.34315 42 6 40.6569 6 39V9Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M31 26H17C15.3431 26 14 27.3431 14 29V42H34V29C34 27.3431 32.6569 26 31 26Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M29 16H17C15.3431 16 14 14.6569 14 13V6" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Save`;
  if (memoryL1CancelBtn) memoryL1CancelBtn.classList.remove("is-hidden");
}

function exitL1EditMode(): void {
  l1Editing = false;
  l1Snapshot = null;
  setL1FieldsDisabled(true);
  if (memoryL1EditBtn) memoryL1EditBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M5.32497 43.4996L13.81 43.4998L44.9227 12.3871L36.4374 3.90186L5.32471 35.0146L5.32497 43.4996Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M27.9521 12.3872L36.4374 20.8725" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Edit`;
  if (memoryL1CancelBtn) memoryL1CancelBtn.classList.add("is-hidden");
}

async function saveL1(): Promise<void> {
  const current = takeL1Snapshot();
  if (l1Snapshot && shallowEqual(current, l1Snapshot)) {
    exitL1EditMode();
    return;
  }
  try {
    await window.memoryPanel?.saveL1(current);
    await loadMemoryPanel();
    exitL1EditMode();
    if (memoryL1EditBtn) {
      memoryL1EditBtn.textContent = "✅ Saved";
      setTimeout(() => { if (memoryL1EditBtn && !l1Editing) memoryL1EditBtn.textContent = "✏ Edit"; }, 2000);
    }
  } catch (err) {
    console.error("[settings] save L1 failed", err);
    await showAlert("Save failed, please retry");
  }
}

function cancelL1Edit(): void {
  if (l1Snapshot) {
    if (memoryL1GoalsInput) memoryL1GoalsInput.value = l1Snapshot.recentGoals;
    if (memoryL1PreferencesInput) memoryL1PreferencesInput.value = l1Snapshot.recentPreferences;
    if (memoryL1ProjectInput) memoryL1ProjectInput.value = l1Snapshot.currentProject;
  }
  exitL1EditMode();
}

// Bind edit button events
memoryL0EditBtn?.addEventListener("click", () => {
  if (l0Editing) { saveL0(); } else { enterL0EditMode(); }
});
memoryL0CancelBtn?.addEventListener("click", cancelL0Edit);

memoryL1EditBtn?.addEventListener("click", () => {
  if (l1Editing) { saveL1(); } else { enterL1EditMode(); }
});
memoryL1CancelBtn?.addEventListener("click", cancelL1Edit);


function renderImportedDocs(): void {
  const list = memoryPanelCache?.importedDocs ?? [];
  if (!memoryImportedList) return;

  if (list.length === 0) {
    renderEmptyState(memoryImportedList, "No imported documents yet", "Upload files in the chat window to index them automatically");
    return;
  }

  memoryImportedList.innerHTML = list
    .map((item) => {
      const importId = item.importId || "";
      const fileName = escapeHtml(item.fileName);
      const chunkInfo = "Indexed " + item.chunkCount + " chunks";
      const timeInfo = "Last imported: " + formatDateTime(item.lastImportedAt);
      return [
        '<article class="memory-record memory-record--doc">',
        '  <div class="memory-record__main">',
        '    <h3 class="memory-record__title">' + fileName + '</h3>',
        '    <p class="memory-record__body">' + escapeHtml(chunkInfo) + '</p>',
        '    <p class="memory-record__meta">' + escapeHtml(timeInfo) + '</p>',
        '  </div>',
        '  <button type="button" class="memory-record__delete" data-import-id="' + escapeHtml(importId) + '" data-file-name="' + fileName + '" title="Delete this imported document"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="vertical-align:-2px"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15H40L37 44H11L8 15Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M20.002 25.0024V35.0026" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M28.0024 24.9995V34.9972" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 14.9999L28.3242 3L36 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>',
        '</article>',
      ].join("\n");
    })
    .join("\n");
}

memoryImportedList?.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement | null;
  const deleteBtn = target?.closest(".memory-record__delete") as HTMLElement | null;
  if (!deleteBtn) return;

  const importId = deleteBtn.dataset.importId || "";
  const fileName = deleteBtn.dataset.fileName || "Untitled document";

  const confirmed = await showModal({
    title: "Delete imported knowledge",
    message: "Delete this imported document?\n\nFile: " + fileName + "\n\nThis cannot be undone. Re-import if needed.",
    icon: "⚠️",
    confirmText: "Delete",
    cancelText: "Cancel",
  });

  if (!confirmed) return;

  try {
    const result = await window.memoryPanel?.deleteImportedDoc(importId, fileName);
    if (result?.ok) {
      await loadMemoryPanel();
    }
  } catch (err) {
    console.error("[settings] delete imported doc failed", err);
  }
});


void loadMemoryPanel();
void loadUserProfile();

// ──  UI ───────────────────────────────────────────
type PermissionLevel = "read-only" | "scoped" | "per-action" | "full";

const permissionBlocksWrap = document.getElementById("plugin-file-permission") as HTMLElement | null;
const permissionNote = document.getElementById("plugin-file-note") as HTMLElement | null;

const PERMISSION_NOTES: Record<PermissionLevel, string> = {
  "read-only": "Read-only: Cyrene will not modify any local files or install tools.",
  "scoped": "Scoped: Cyrene can only read/write in directories you authorize (configure whitelist here).",
  "per-action": "Per-action: Cyrene will show an approval card in chat for every file or install operation.",
  "full": "Full access: Cyrene can freely run local commands (git/npm/pip). Only enable if you fully trust her judgment.",
};

function paintPermissionUI(level: PermissionLevel): void {
  if (!permissionBlocksWrap) return;
  // scoped ，
  const display = level === "scoped" ? "read-only" : level;
  const blocks = permissionBlocksWrap.querySelectorAll<HTMLButtonElement>("button[data-level]");
  blocks.forEach((b) => {
    const isActive = b.dataset.level === display;
    b.classList.toggle("is-active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });
  if (permissionNote) {
    permissionNote.textContent = PERMISSION_NOTES[level];
  }
}

async function confirmFullAccess(): Promise<boolean> {
  //  + Notice
  _initModalOverlay();
  if (!_cyModalOverlay) return false;
  const iconEl = _cyModalOverlay.querySelector("#cy-modal-icon") as HTMLElement;
  const titleEl = _cyModalOverlay.querySelector("#cy-modal-title") as HTMLElement;
  const msgEl = _cyModalOverlay.querySelector("#cy-modal-message") as HTMLElement;
  const cancelBtn = _cyModalOverlay.querySelector("#cy-modal-cancel") as HTMLButtonElement;
  const confirmBtn = _cyModalOverlay.querySelector("#cy-modal-confirm") as HTMLButtonElement;
  iconEl.textContent = "⚠️";
  titleEl.textContent = "Switch to Full Access?";
  msgEl.textContent = "Cyrene will be able to freely run commands on your computer including git clone, npm install, and file deletion. Only enable if you fully trust her.";
  cancelBtn.textContent = "Think again";
  _cyModalOverlay.classList.remove("is-hidden");

  //  5 
  let remain = 5;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "I accept the risk (" + remain + ")";
  const tick = setInterval(() => {
    remain -= 1;
    if (remain <= 0) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "I accept the risk — Enable";
      clearInterval(tick);
    } else {
      confirmBtn.textContent = "I accept the risk (" + remain + ")";
    }
  }, 1000);

  return new Promise((resolve) => {
    const cleanup = (result: boolean) => {
      clearInterval(tick);
      confirmBtn.disabled = false;
      _cyModalOverlay?.classList.add("is-hidden");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      resolve(result);
    };
    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

if (permissionBlocksWrap) {
  permissionBlocksWrap.addEventListener("click", async (event) => {
    const btn = (event.target as HTMLElement)?.closest("button[data-level]") as HTMLButtonElement | null;
    if (!btn) return;
    const target = (btn.dataset.level || "") as PermissionLevel;
    if (!target) return;
    if (btn.classList.contains("is-active")) {
      console.log("[settings] Permission level unchanged, no action");
      return;
    }

    if (target === "full") {
      const ok = await confirmFullAccess();
      if (!ok) {
        console.log("[settings] User cancelled full access");
        return;
      }
    }

    console.log("[settings] Switch permission level →", target);
    try {
      const result = await window.settings?.setPermissionLevel?.(target);
      if (result?.ok) {
        paintPermissionUI((result.level || target) as PermissionLevel);
      } else {
        console.warn("[settings] Failed to switch permission level:", result?.error);
      }
    } catch (err) {
      console.error("[settings] Error switching permission level:", err);
    }
  });

  // ：
  void (async () => {
    try {
      const result = await window.settings?.getPermissionLevel?.();
      const level = (result?.level || "read-only") as PermissionLevel;
      console.log("[settings] Current permission level:", level);
      paintPermissionUI(level);
    } catch (err) {
      console.warn("[settings] Failed to load permission level:", err);
      paintPermissionUI("read-only");
    }
  })();
}

// ──  ─────────────────────────────────────────
const lifeToggle = document.getElementById("plugin-life-toggle") as HTMLButtonElement | null;
const lifeCard = document.getElementById("plugin-life-card");
const lifeBody = document.getElementById("plugin-life-body");
lifeToggle?.addEventListener("click", () => {
  const expanded = lifeToggle.getAttribute("aria-expanded") === "true";
  lifeToggle.setAttribute("aria-expanded", String(!expanded));
  lifeCard?.classList.toggle("is-expanded", !expanded);
  lifeBody?.classList.toggle("is-collapsed", expanded);
});

// ── （)────────────────
const musicToggle = document.getElementById("plugin-music-toggle") as HTMLButtonElement | null;
const musicAccordionCard = document.getElementById("plugin-music-card");
const musicAccordionBody = document.getElementById("plugin-music-body");
musicToggle?.addEventListener("click", () => {
  const expanded = musicToggle.getAttribute("aria-expanded") === "true";
  musicToggle.setAttribute("aria-expanded", String(!expanded));
  musicAccordionCard?.classList.toggle("is-expanded", !expanded);
  musicAccordionBody?.classList.toggle("is-collapsed", expanded);
});

// ──  ──────────────────────────────────────────────
document.getElementById("music-platform-netease")?.addEventListener("click", () => {
  switchSection("music");
  musicHomeView?.classList.add("is-hidden");
  neteaseDetailView?.classList.remove("is-hidden");
});
musicReturnBtn?.addEventListener("click", () => {
	  switchSection("plugins");
	});


// ── Skill ： skill  ──────────────────────────────
async function renderSkills(): Promise<void> {
  const listEl = document.getElementById("skills-list");
  const emptyEl = document.getElementById("skills-empty");
  if (!listEl || !window.settings?.listSkills) return;

  let skills: Array<{ id: string; name: string; description: string; tools: string[]; enabled: boolean; source: string; version?: string; references: string[] }> = [];
  try {
    skills = await window.settings.listSkills();
  } catch (err) {
    console.warn("[settings] Failed to load skill list:", err);
  }

  listEl.innerHTML = "";
  if (skills.length === 0) {
    if (emptyEl) emptyEl.classList.remove("is-hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("is-hidden");

  // MiniMax  id 
  const officeGroupIds = new Set(["docx", "pdf", "pptx-generator", "xlsx"]);
  const officeSkills = skills.filter((s) => officeGroupIds.has(s.id));
  const otherSkills = skills.filter((s) => !officeGroupIds.has(s.id));

  //  skill
  function renderSkillRow(s: typeof skills[number]): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "skill-row";
    const label = document.createElement("div");
    label.className = "skill-row__info";
    const title = document.createElement("div");
    title.className = "skill-row__title";
    title.textContent = s.name + (s.source === "user" ? "  (user)" : "");
    const desc = document.createElement("div");
    desc.className = "skill-row__desc";
    const short = s.description.length > 120 ? s.description.slice(0, 120) + "…" : s.description;
    const toolsStr = s.tools.length > 0 ? ` [tools: ${s.tools.join(", ")}]` : "";
    desc.textContent = short + toolsStr;
    label.appendChild(title);
    label.appendChild(desc);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "skill-toggle";
    toggle.checked = s.enabled;
    toggle.addEventListener("change", async () => {
      try {
        await window.settings?.setSkillEnabled?.(s.id, toggle.checked);
      } catch (err) {
        console.warn("[settings] Failed to toggle skill:", err);
        toggle.checked = !toggle.checked;
      }
    });

    row.appendChild(label);
    row.appendChild(toggle);
    return row;
  }

  // （)skill
  for (const s of otherSkills) {
    listEl.appendChild(renderSkillRow(s));
  }

  // MiniMax 
  if (officeSkills.length > 0) {
    const group = document.createElement("div");
    group.className = "skill-group";

    const header = document.createElement("div");
    header.className = "skill-group__header";
    const arrow = document.createElement("span");
    arrow.className = "skill-group__arrow";
    arrow.textContent = "▶";
    const gTitle = document.createElement("span");
    gTitle.className = "skill-group__title";
    gTitle.textContent = "MiniMAX-office-skills";
    const gDesc = document.createElement("span");
    gDesc.className = "skill-group__desc";
    gDesc.textContent = "MiniMax open-source office document skills collection";
    header.appendChild(arrow);
    header.appendChild(gTitle);
    header.appendChild(gDesc);
    header.addEventListener("click", () => {
      body.classList.toggle("is-open");
      arrow.textContent = body.classList.contains("is-open") ? "▼" : "▶";
    });

    const body = document.createElement("div");
    body.className = "skill-group__body";
    for (const s of officeSkills) {
      body.appendChild(renderSkillRow(s));
    }

    group.appendChild(header);
    group.appendChild(body);
    listEl.appendChild(group);
  }
}








/* ============================================================
   💬 ：
   -  chatStore.list ， updatedAt desc （store )
   - ： / N  /  HH:mm /  HH:mm / N  / MM-DD
   -  = （)
   -  = （contentEditable + Enter/Esc/blur )
   - 🗑️ = Delete（""Notice)
   - ：onChanged ；onActiveSessionChanged 
   - HTML/CSS  index.html / settings.css （ chat-sessions__*)
   ============================================================ */

declare global {
  interface Window {
    chatStore?: {
      list: () => Promise<ChatSessionMetaUI[]>;
      get: (id: string) => Promise<unknown>;
      create: (payload?: { title?: string; identityId?: string | null }) => Promise<{ id: string } | null>;
      delete: (id: string) => Promise<boolean>;
      rename: (id: string, title: string) => Promise<unknown>;
      openFolder: () => Promise<boolean>;
      openInChatWindow: (sessionId: string) => Promise<boolean>;
      getActiveSession: () => Promise<string | null>;
      onChanged: (cb: () => void) => () => void;
      onActiveSessionChanged: (cb: (sessionId: string | null) => void) => () => void;
    };
  }
}

let chatSessionsActiveId: string | null = null;

async function renderChatSessions(): Promise<void> {
  const listEl = document.getElementById("chat-sessions-list");
  const emptyEl = document.getElementById("chat-sessions-empty");
  if (!listEl || !window.chatStore) return;

  //  sessionId，
  if (chatSessionsActiveId === null) {
    try { chatSessionsActiveId = (await window.chatStore.getActiveSession()) ?? null; } catch { /* ignore */ }
  }

  let sessions: ChatSessionMetaUI[] = [];
  try {
    sessions = await window.chatStore.list();
  } catch (err) {
    console.warn("[settings] Failed to load chat sessions:", err);
  }

  listEl.innerHTML = "";
  if (sessions.length === 0) {
    if (emptyEl) emptyEl.classList.remove("is-hidden");
    return;
  }
  if (emptyEl) emptyEl.classList.add("is-hidden");

  for (const session of sessions) {
    const item = buildChatSessionItem(session);
    listEl.appendChild(item);
  }
}

function buildChatSessionItem(session: ChatSessionMetaUI): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "chat-sessions__item";
  if (session.id === chatSessionsActiveId) li.classList.add("is-active");
  li.dataset.sessionId = session.id;

  const titleEl = document.createElement("div");
  titleEl.className = "chat-sessions__title";
  titleEl.textContent = session.title || "New Chat";

  const metaEl = document.createElement("div");
  metaEl.className = "chat-sessions__meta";

  const timeEl = document.createElement("span");
  timeEl.className = "chat-sessions__time";
  timeEl.textContent = formatChatRelativeTime(session.updatedAt);


  metaEl.appendChild(timeEl);

  // ： + meta
  const mainEl = document.createElement("div");
  mainEl.className = "chat-sessions__main";
  mainEl.appendChild(titleEl);
  mainEl.appendChild(metaEl);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "chat-sessions__delete";
  deleteBtn.title = "Delete session";
  deleteBtn.setAttribute("aria-label", "Delete session");
  deleteBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15H40L37 44H11L8 15Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M20.002 25.0024V35.0026" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M28.0024 24.9995V34.9972" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 14.9999L28.3242 3L36 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "chat-sessions__rename";
  renameBtn.title = "Rename";
  renameBtn.setAttribute("aria-label", "Rename session");
  renameBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true" style="display:inline;vertical-align:-2px"><path d="M5.32497 43.4996L13.81 43.4998L44.9227 12.3871L36.4374 3.90186L5.32471 35.0146L5.32497 43.4996Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M27.9521 12.3872L36.4374 20.8725" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Edit/Cancel（，Edit， ✏️/🗑️ )
  const confirmRenameBtn = document.createElement("button");
  confirmRenameBtn.type = "button";
  confirmRenameBtn.className = "chat-sessions__confirm-rename is-hidden";
  confirmRenameBtn.title = "Confirm (Enter)";
  confirmRenameBtn.setAttribute("aria-label", "Confirm rename");
  confirmRenameBtn.textContent = "✓";

  const cancelRenameBtn = document.createElement("button");
  cancelRenameBtn.type = "button";
  cancelRenameBtn.className = "chat-sessions__cancel-rename is-hidden";
  cancelRenameBtn.title = "Cancel (Esc)";
  cancelRenameBtn.setAttribute("aria-label", "Cancel rename");
  cancelRenameBtn.textContent = "✕";

  // ：✏️ 🗑️（)/ ✓ ✕（Edit)
  const actionsEl = document.createElement("div");
  actionsEl.className = "chat-sessions__actions";
  actionsEl.appendChild(renameBtn);
  actionsEl.appendChild(confirmRenameBtn);
  actionsEl.appendChild(cancelRenameBtn);
  actionsEl.appendChild(deleteBtn);

  // ——  ——
  //  = （Edit，)
  li.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".chat-sessions__actions")) return;
    if (titleEl.isContentEditable) return;
    void window.chatStore?.openInChatWindow(session.id);
  });

  // ✏️ 
  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    enterRenameMode(titleEl, session, { renameBtn, deleteBtn, confirmRenameBtn, cancelRenameBtn });
  });

  // 🗑️ Delete（Notice)
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void deleteChatSession(session);
  });

  li.appendChild(mainEl);
  li.appendChild(actionsEl);
  return li;
}

// ： ✏️/🗑️ ， ✓/✕；title  contentEditable .
//  ✓  / Enter；Cancel ✕  / Esc / .=Cancel（).
function enterRenameMode(
  titleEl: HTMLElement,
  session: ChatSessionMetaUI,
  btns: {
    renameBtn: HTMLButtonElement;
    deleteBtn: HTMLButtonElement;
    confirmRenameBtn: HTMLButtonElement;
    cancelRenameBtn: HTMLButtonElement;
  },
): void {
  const original = titleEl.textContent || "";

  // 
  btns.renameBtn.classList.add("is-hidden");
  btns.deleteBtn.classList.add("is-hidden");
  btns.confirmRenameBtn.classList.remove("is-hidden");
  btns.cancelRenameBtn.classList.remove("is-hidden");

  titleEl.contentEditable = "true";
  titleEl.classList.add("is-editing");
  //  requestAnimationFrame  click ， blur 
  requestAnimationFrame(() => {
    titleEl.focus();
    // ，
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  });

  const cleanup = () => {
    titleEl.contentEditable = "false";
    titleEl.classList.remove("is-editing");
    btns.renameBtn.classList.remove("is-hidden");
    btns.deleteBtn.classList.remove("is-hidden");
    btns.confirmRenameBtn.classList.add("is-hidden");
    btns.cancelRenameBtn.classList.add("is-hidden");
    titleEl.removeEventListener("keydown", onKey);
    titleEl.removeEventListener("blur", onBlur);
    btns.confirmRenameBtn.removeEventListener("mousedown", suppressFocus);
    btns.cancelRenameBtn.removeEventListener("mousedown", suppressFocus);
    btns.confirmRenameBtn.removeEventListener("click", onConfirm);
    btns.cancelRenameBtn.removeEventListener("click", onCancel);
  };

  const commit = () => {
    const newTitle = (titleEl.textContent || "").trim();
    cleanup();
    if (newTitle && newTitle !== original) {
      void window.chatStore?.rename(session.id, newTitle);
      // rename  main  chats:changed → ，None DOM
    } else {
      titleEl.textContent = original; // empty or unchanged: restore original
    }
  };

  const cancel = () => {
    cleanup();
    titleEl.textContent = original;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  // =Cancel（Edit)
  const onBlur = () => cancel();
  const onConfirm = (e: MouseEvent) => { e.stopPropagation(); commit(); };
  const onCancel = (e: MouseEvent) => { e.stopPropagation(); cancel(); };
  // ：mousedown  preventDefault， ✓/✕ ，
  //  mousedown→titleEl blur(cancel )→click(commit )→.
  // ，titleEl ，blur ，click  commit/cancel.
  const suppressFocus = (e: MouseEvent) => e.preventDefault();

  titleEl.addEventListener("keydown", onKey);
  titleEl.addEventListener("blur", onBlur);
  btns.confirmRenameBtn.addEventListener("mousedown", suppressFocus);
  btns.cancelRenameBtn.addEventListener("mousedown", suppressFocus);
  btns.confirmRenameBtn.addEventListener("click", onConfirm);
  btns.cancelRenameBtn.addEventListener("click", onCancel);
}

async function deleteChatSession(session: ChatSessionMetaUI): Promise<void> {
  const isActive = session.id === chatSessionsActiveId;
  const prompt = isActive
    ? `"${session.title || "New Chat"}" is open in the chat window. Delete it? The chat will switch to the latest session.`
    : `Delete "${session.title || "New Chat"}"?\nThis cannot be undone.`;
  const ok = await showConfirm({
    title: "Delete Session",
    message: prompt,
    confirmText: "Delete",
    cancelText: "Cancel",
    icon: "🗑️",
    danger: true,
  });
  if (!ok) return;
  try {
    await window.chatStore?.delete(session.id);
    // Delete main  chats:changed → ；
    //  onChanged  fallback.
  } catch (err) {
    console.warn("[settings] Failed to delete session:", err);
    await showAlert("Delete failed. Check the terminal log.");
  }
}

// —— "+New Chat" ——
const chatNewBtn = document.getElementById("chat-new-btn") as HTMLButtonElement | null;
chatNewBtn?.addEventListener("click", async () => {
  if (!window.chatStore) return;
  try {
    const session = await window.chatStore.create({ identityId: null });
    if (session?.id) await window.chatStore.openInChatWindow(session.id);
  } catch (err) {
    console.warn("[settings] Failed to create new session:", err);
    await showAlert("Failed to create new session. Check the terminal log.");
  }
});

// —— "" ——
const chatOpenFolderBtn = document.getElementById("chat-open-folder-btn") as HTMLButtonElement | null;
chatOpenFolderBtn?.addEventListener("click", () => {
  void window.chatStore?.openFolder();
});

// ——  ——
// （///Delete)：
// ， DOM ；
window.chatStore?.onChanged(() => {
  const panel = document.getElementById("chat-panel");
  if (panel && !panel.classList.contains("is-hidden")) {
    void renderChatSessions();
  }
});

//  sessionId ： is-active ，（)
window.chatStore?.onActiveSessionChanged((sessionId) => {
  chatSessionsActiveId = sessionId;
  const listEl = document.getElementById("chat-sessions-list");
  if (!listEl) return;
  listEl.querySelectorAll<HTMLElement>(".chat-sessions__item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.sessionId === sessionId);
  });
});

/* ============================================================
   📊 Token ： +  + Chart.js 
   -  7d/14d/30d ， IPC 
   - hover / → tooltip  ///
   - （None)
   ============================================================ */

import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

interface TokenDayData {
  date: string;       // ISO  "06-15"
  weekday: string;    // ""
  input: number;
  output: number;
  hit: number;        // （ 0)
  miss: number;       // （ 0)
  requests: number;
}

declare global {
  interface Window {
    tokenUsage?: {
      get: (days: number) => Promise<TokenDayData[]>;
    };
  }
}

// （，)
// ：（ chart.css  .chart-bar )
function renderTokenBarChart(data: TokenDayData[]): void {
  const container = document.getElementById("token-bar-chart");
  if (!container) return;
  container.innerHTML = "";

  const maxVal = Math.max(...data.map((d) => d.input + d.output), 1);
  const peakIdx = data.reduce((peak, d, i, arr) =>
    (d.input + d.output) > (arr[peak].input + arr[peak].output) ? i : peak, 0);

  //  14 （30d )，
  const displayData = data.length > 14
    ? data.filter((_, i) => i % 2 === 0)
    : data;

  // （mini-chart  112px - padding-top 18px -  label  18px ≈ 76px)
  // ， flex  padding 
  const chartHeight = 76;

  for (let i = 0; i < displayData.length; i++) {
    const d = displayData[i];
    const total = d.input + d.output;
    const barH = Math.max(6, Math.round((total / maxVal) * chartHeight));
    const bar = document.createElement("div");
    bar.className = "token-bar";
    // 
    const origIdx = data.indexOf(d);
    if (origIdx === peakIdx) bar.classList.add("token-bar--peak");

    //  fill div（，)
    const fill = document.createElement("div");
    fill.className = "token-bar__fill";
    fill.style.height = barH + "px";

    const label = document.createElement("span");
    label.className = "token-bar__label";
    label.textContent = d.date.split("-")[1]; // 
    bar.appendChild(fill);
    bar.appendChild(label);

    // hover tooltip
    bar.addEventListener("mouseenter", (e) => showTokenTooltip(e, d));
    bar.addEventListener("mousemove", (e) => moveTokenTooltip(e));
    bar.addEventListener("mouseleave", hideTokenTooltip);

    container.appendChild(bar);
  }

  // 
  const avgEl = document.getElementById("token-avg-label");
  if (avgEl) {
    const avg = Math.round(data.reduce((s, d) => s + d.input + d.output, 0) / data.length);
    avgEl.textContent = `Daily avg: ${formatTokenShort(avg)}`;
  }
}

function formatTokenShort(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// tooltip //
function showTokenTooltip(e: MouseEvent, d: TokenDayData): void {
  const tip = document.getElementById("token-tooltip");
  if (!tip) return;
  tip.innerHTML = `
    <div class="token-tooltip__date">${d.date} ${d.weekday}</div>
    <div class="token-tooltip__row"><span>📥 Input</span><span>${d.input.toLocaleString()}</span></div>
    <div class="token-tooltip__row"><span>📤 Output</span><span>${d.output.toLocaleString()}</span></div>
    <div class="token-tooltip__row"><span>🎯 Cache Hit</span><span>${d.hit > 0 ? d.hit.toLocaleString() : "N/A"}</span></div>
    <div class="token-tooltip__row"><span>❌ Cache Miss</span><span>${d.miss > 0 ? d.miss.toLocaleString() : "N/A"}</span></div>
  `;
  tip.hidden = false;
  moveTokenTooltip(e);
}

function moveTokenTooltip(e: MouseEvent): void {
  const tip = document.getElementById("token-tooltip");
  if (!tip || tip.hidden) return;
  const offset = 14;
  let x = e.clientX + offset;
  let y = e.clientY + offset;
  // 
  const tipW = tip.offsetWidth;
  if (x + tipW > window.innerWidth) x = e.clientX - tipW - offset;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function hideTokenTooltip(): void {
  const tip = document.getElementById("token-tooltip");
  if (tip) tip.hidden = true;
}

// Chart.js 
let tokenTrendChart: Chart | null = null;

function renderTokenTrendChart(data: TokenDayData[]): void {
  const canvas = document.getElementById("token-trend-chart") as HTMLCanvasElement | null;
  if (!canvas) return;

  // 
  if (tokenTrendChart) { tokenTrendChart.destroy(); tokenTrendChart = null; }

  const labels = data.map((d) => d.date);
  const inputData = data.map((d) => d.input);
  const outputData = data.map((d) => d.output);

  const config: ChartConfiguration = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "📥 Input",
          data: inputData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#3b82f6",
        },
        {
          label: "📤 Output",
          data: outputData,
          borderColor: "#ff8ccc",
          backgroundColor: "rgba(255, 140, 204, 0.15)",
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#ff8ccc",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: "rgba(235, 229, 245, 0.7)", font: { size: 11 }, boxWidth: 12, boxHeight: 12 },
        },
        tooltip: {
          //  Chart.js  tooltip，///
          backgroundColor: "rgba(30, 20, 45, 0.95)",
          borderColor: "rgba(255, 182, 220, 0.3)",
          borderWidth: 1,
          titleColor: "rgba(254, 247, 255, 0.95)",
          bodyColor: "rgba(235, 229, 245, 0.85)",
          padding: 10,
          cornerRadius: 10,
          displayColors: true,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const d = data[idx];
              return `${d.date} ${d.weekday}`;
            },
            label: (item) => {
              const idx = item.dataIndex;
              const d = data[idx];
              const which = item.datasetIndex === 0 ? "input" : "output";
              const val = which === "input" ? d.input : d.output;
              return `${which === "input" ? "📥 Input" : "📤 Output"}: ${val.toLocaleString()}`;
            },
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const d = data[idx];
              return [
                `🎯 Cache Hit: ${d.hit > 0 ? d.hit.toLocaleString() : "N/A"}`,
                `❌ Cache Miss: ${d.miss > 0 ? d.miss.toLocaleString() : "N/A"}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "rgba(235, 229, 245, 0.45)", font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
        },
        y: {
          grid: { color: "rgba(255, 182, 220, 0.08)" },
          ticks: {
            color: "rgba(235, 229, 245, 0.45)",
            font: { size: 10 },
            callback: (v) => formatTokenShort(Number(v)),
          },
          beginAtZero: true,
        },
      },
    },
  };

  tokenTrendChart = new Chart(canvas, config);
}

// 
function updateTokenStats(data: TokenDayData[]): void {
  const totalInput = data.reduce((s, d) => s + d.input, 0);
  const totalOutput = data.reduce((s, d) => s + d.output, 0);
  const total = totalInput + totalOutput;
  const requests = data.reduce((s, d) => s + d.requests, 0);

  const set = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("token-total", total.toLocaleString());
  set("token-requests", requests.toLocaleString());
  set("token-input", totalInput.toLocaleString());
  set("token-output", totalOutput.toLocaleString());
  set("token-hit", "N/A");
}

// ： IPC  → ，None
async function refreshTokenPanel(days: number): Promise<void> {
  let data: TokenDayData[] = [];
  try {
    data = await window.tokenUsage?.get(days) ?? [];
  } catch (err) {
    console.warn("[settings] Failed to fetch token usage:", err);
  }

  const hasData = data.some((d) => d.input > 0 || d.output > 0 || d.requests > 0);
  const emptyEl = document.getElementById("token-empty");
  const chartsEl = document.getElementById("token-charts");

  if (!hasData) {
    // ：，Notice，
    if (emptyEl) emptyEl.classList.remove("is-hidden");
    if (chartsEl) chartsEl.classList.add("is-hidden");
    const set = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("token-total", "0");
    set("token-requests", "0");
    set("token-input", "0");
    set("token-output", "0");
    set("token-hit", "N/A");
    return;
  }

  // ：，
  if (emptyEl) emptyEl.classList.add("is-hidden");
  if (chartsEl) chartsEl.classList.remove("is-hidden");
  updateTokenStats(data);
  renderTokenBarChart(data);
  renderTokenTrendChart(data);
}

// 
document.querySelectorAll<HTMLButtonElement>(".token-range__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".token-range__btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    const days = Number(btn.dataset.range) || 7;
    void refreshTokenPanel(days);
  });
});

// 
void refreshTokenPanel(7);

/* ============================================================
   🎙️ TTS 
   - /（ general settings，)
   - ：
   - / + 
   - MiniMax ： synthesize 
   - ：→→→ voice_id
   ============================================================ */

interface TtsApi {
  upload: (apiKey: string, filePath: string, purpose: "voice_clone" | "prompt_audio") => Promise<{ file_id: string }>;
  pickAudio: () => Promise<string | null>;
  clone: (payload: {
    apiKey: string; fileId: string; voiceId: string;
    promptAudioId?: string; promptText?: string;
    text: string; model?: string;
  }) => Promise<{ voiceId: string; audioDemo?: string }>;
  synthesize: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
  }) => Promise<string>; // base64 
  // GPT-SoVITS（ base64 + cacheKey + cached + format)
  synthesizeGptsovits: (payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  synthesizeCachedGptsovits: (payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  // （ base64 + cacheKey + cached + format)
  synthesizeCustomCloud: (payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  synthesizeCachedCustomCloud: (payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  //  MiMo（ base64 + cacheKey + cached + format)
  synthesizeMimo: (payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" }>;
  synthesizeCachedMimo: (payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" }>;
  // Mossland（api.mosi.cn)
  synthesizeMossland: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "mp3" | "wav" | "pcm" }>;
  synthesizeCachedMossland: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "mp3" | "wav" | "pcm" }>;
  cloneMossland: (payload: {
    apiKey: string; filePath: string; name?: string; description?: string;
  }) => Promise<{ voiceId: string; name?: string; createdAt?: number }>;
  listMosslandVoices: (payload: {
    apiKey: string; limit?: number;
  }) => Promise<{ voices: Array<{ id: string; name: string; createdAt: number }> }>;
  pickAudioFile: () => Promise<string | null>;
  synthesizeOnline?: (payload: { text: string; lang?: string }) => Promise<{ base64: string; format: string } | null>;
  saveSettings: (tts: Record<string, unknown>) => Promise<unknown>;
  loadSettings: () => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    tts?: TtsApi;
  }
}

const TTS_TEST_TEXT = "Hello, I am Cyrene. It is wonderful to meet you.";

//  DOM 
function ttsEl(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

//  TTS （，)
let ttsConfig: Record<string, unknown> = {};

// 
async function loadTtsConfig(): Promise<void> {
  if (!window.tts) return;
  try {
    ttsConfig = await window.tts.loadSettings() as Record<string, unknown>;
  } catch (err) {
    console.warn("[TTS] Failed to load config:", err);
    return;
  }

  // 
  const engine = String(ttsConfig.ttsEngine || "gptsovits");
  document.querySelectorAll<HTMLButtonElement>(".tts-engine").forEach((btn) => {
    const isActive = btn.dataset.engine === engine;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>(".tts-config").forEach((el) => { el.hidden = true; });
  if (engine !== "off") {
    const config = document.getElementById("tts-config-" + engine);
    if (config) config.hidden = false;
  }

  // 
  ttsEl("tts-auto-read").checked = Boolean(ttsConfig.ttsAutoRead);
  ttsEl("tts-speed").value = String(ttsConfig.ttsSpeed ?? 1);
  ttsEl("tts-volume").value = String(ttsConfig.ttsVolume ?? 1);
  updateTtsSliderLabels();

  // MiniMax
  ttsEl("tts-minimax-key").value = String(ttsConfig.ttsMinimaxKey ?? "");
  ttsEl("tts-minimax-voice").value = String(ttsConfig.ttsMinimaxVoiceId ?? "");
  (ttsEl("tts-minimax-model") as HTMLSelectElement).value =
    ttsConfig.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo";
  ttsEl("tts-streaming").checked = ttsConfig.ttsStreaming !== false;

  // GPT-SoVITS
  ttsEl("tts-gptsovits-url").value = String(ttsConfig.ttsGptsovitsBaseUrl ?? "http://127.0.0.1:9880");
  ttsEl("tts-gptsovits-ref-audio").value = String(ttsConfig.ttsGptsovitsRefAudioPath || "resources/voice/cyrene/ref_audio.wav");
  ttsEl("tts-gptsovits-prompt-text").value = String(ttsConfig.ttsGptsovitsPromptText || "开拓者，希琳一直都在这里陪着你哦。");
  (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value =
    ttsConfig.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav";
  const languageMode = document.getElementById("tts-gptsovits-lang-mode") as HTMLSelectElement | null;
  if (languageMode) {
    languageMode.value = "original-mandarin";
  }
  const rvcEnabled = document.getElementById("tts-rvc-enabled") as HTMLInputElement | null;
  if (rvcEnabled) rvcEnabled.checked = ttsConfig.ttsRvcEnabled === true;
  const rvcPanel = document.getElementById("tts-rvc-panel");
  if (rvcPanel) rvcPanel.hidden = ttsConfig.ttsRvcEnabled !== true;
  const rvcUrl = document.getElementById("tts-rvc-url") as HTMLInputElement | null;
  if (rvcUrl) rvcUrl.value = String(ttsConfig.ttsRvcBaseUrl ?? "http://localhost:18888");
  const rvcModel = document.getElementById("tts-rvc-model") as HTMLInputElement | null;
  if (rvcModel) rvcModel.value = String(ttsConfig.ttsRvcModel ?? "Cyrene (Aiden Dawn)");
  const rvcPitch = document.getElementById("tts-rvc-pitch") as HTMLInputElement | null;
  if (rvcPitch) rvcPitch.value = String(ttsConfig.ttsRvcPitch ?? 0);

  // 
  ttsEl("tts-custom-cloud-url").value = String(ttsConfig.ttsCustomCloudEndpointUrl ?? "");
  ttsEl("tts-custom-cloud-key").value = String(ttsConfig.ttsCustomCloudApiKey ?? "");
  ttsEl("tts-custom-cloud-voice").value = String(ttsConfig.ttsCustomCloudVoiceId ?? "");
  (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value =
    ttsConfig.ttsCustomCloudFormat === "wav" ? "wav" : "mp3";
  ttsEl("tts-custom-cloud-timeout").value = String(ttsConfig.ttsCustomCloudTimeoutMs ?? 30000);

  //  MiMo
  ttsEl("tts-mimo-key").value = String(ttsConfig.ttsMimoKey ?? "");
  ttsEl("tts-mimo-voice-audio").value = String(ttsConfig.ttsMimoVoiceAudioPath ?? "");
  ttsEl("tts-mimo-style").value = String(ttsConfig.ttsMimoStylePrompt ?? "Gentle, natural, and warmly conversational.");

  // Mossland（UI ，IPC ； ttsConfig )
  ttsEl("tts-mossland-key").value = String(ttsConfig.ttsMosslandKey ?? "");
  ttsEl("tts-mossland-voice").value = String(ttsConfig.ttsMosslandVoiceId ?? "");
  (ttsEl("tts-mossland-model") as HTMLSelectElement).value = "moss-tts";
  ttsEl("tts-mossland-text").value = String(ttsConfig.ttsMosslandTestText ?? TTS_TEST_TEXT);
  (ttsEl("tts-mossland-format") as HTMLSelectElement).value =
    ttsConfig.ttsMosslandFormat === "wav" ? "wav"
    : ttsConfig.ttsMosslandFormat === "pcm" ? "pcm"
    : "mp3";
  ttsConfig.ttsMosslandKey       = String(ttsEl("tts-mossland-key").value);
  ttsConfig.ttsMosslandVoiceId   = String(ttsEl("tts-mossland-voice").value);
  ttsConfig.ttsMosslandModel     = (ttsEl("tts-mossland-model") as HTMLSelectElement).value;
  ttsConfig.ttsMosslandTestText  = String(ttsEl("tts-mossland-text").value);
  ttsConfig.ttsMosslandFormat    = (ttsEl("tts-mossland-format") as HTMLSelectElement).value;

  //  Provider （，status )
  for (const provider of Object.keys(TTS_PROVIDER_FIELDS)) {
    const ui = ttsProviderUi[provider];
    if (!ui) continue;
    ui.btn.classList.add("is-hidden");
    ui.status.textContent = "";
  }
}

function updateTtsSliderLabels(): void {
  const speedVal = document.getElementById("tts-speed-val");
  const volVal = document.getElementById("tts-volume-val");
  if (speedVal) speedVal.textContent = Number(ttsEl("tts-speed").value).toFixed(1) + "x";
  if (volVal) volVal.textContent = Math.round(Number(ttsEl("tts-volume").value) * 100) + "%";
}

//  TTS 
async function saveTtsField(field: string, value: unknown): Promise<void> {
  if (!window.tts) return;
  ttsConfig[field] = value;
  try {
    await window.tts.saveSettings({ [field]: value });
  } catch (err) {
    console.warn("[TTS] Failed to save settings:", field, err);
  }
}

//  base64 .format  Blob MIME（minimax  mp3，gptsovits  wav)
function playTtsAudio(base64: string, format: "wav" | "mp3" = "mp3"): void {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const mime = format === "wav" ? "audio/wav" : "audio/mp3";
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch((err) => console.warn("[TTS] Playback failed:", err));
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (err) {
    console.warn("[TTS] Audio decoding failed:", err);
  }
}

// 
//  data-engine （ TTS )——
//  .tts-engine  class， data-mode  data-engine，
//  TTS .
document.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const engine = btn.dataset.engine || "off";
    document.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("is-active");
    btn.setAttribute("aria-checked", "true");
    document.querySelectorAll<HTMLElement>(".tts-config").forEach((el) => { el.hidden = true; });
    if (engine !== "off") {
      const config = document.getElementById("tts-config-" + engine);
      if (config) config.hidden = false;
    }
    void saveTtsField("ttsEngine", engine);
  });
});

// 
ttsEl("tts-auto-read").addEventListener("change", () => {
  void saveTtsField("ttsAutoRead", ttsEl("tts-auto-read").checked);
});

// /（change ，input )
ttsEl("tts-speed").addEventListener("input", updateTtsSliderLabels);
ttsEl("tts-speed").addEventListener("change", () => saveTtsField("ttsSpeed", Number(ttsEl("tts-speed").value)));
ttsEl("tts-volume").addEventListener("input", updateTtsSliderLabels);
ttsEl("tts-volume").addEventListener("change", () => saveTtsField("ttsVolume", Number(ttsEl("tts-volume").value)));

// ── TTS ： Provider  +  ──
//  input/change  saveTtsField（settings.ts:4270–4295)，
//  input  IPC，IME ，"".
// ： mark dirty， Provider "".
// switch / slider / select /  / Opener （).
const TTS_FIELD_MAP: Record<string, string> = {
  "tts-minimax-key":          "ttsMinimaxKey",
  "tts-minimax-voice":        "ttsMinimaxVoiceId",
  "tts-minimax-model":        "ttsMinimaxModel",
  "tts-gptsovits-url":        "ttsGptsovitsBaseUrl",
  "tts-gptsovits-ref-audio":  "ttsGptsovitsRefAudioPath",
  "tts-gptsovits-prompt-text":"ttsGptsovitsPromptText",
  "tts-custom-cloud-url":     "ttsCustomCloudEndpointUrl",
  "tts-custom-cloud-key":     "ttsCustomCloudApiKey",
  "tts-custom-cloud-voice":   "ttsCustomCloudVoiceId",
  "tts-custom-cloud-timeout": "ttsCustomCloudTimeoutMs",
  "tts-mimo-key":             "ttsMimoKey",
  "tts-mimo-voice-audio":     "ttsMimoVoiceAudioPath",
  "tts-mimo-style":           "ttsMimoStylePrompt",
  "tts-mossland-key":         "ttsMosslandKey",
  "tts-mossland-voice":       "ttsMosslandVoiceId",
  "tts-mossland-model":       "ttsMosslandModel",
  "tts-mossland-text":        "ttsMosslandTestText",
  "tts-mossland-format":      "ttsMosslandFormat",
};

//  Provider （ switch/slider/select，)
const TTS_PROVIDER_FIELDS: Record<string, string[]> = {
  minimax:        ["tts-minimax-key", "tts-minimax-voice"],
  gptsovits:      ["tts-gptsovits-url", "tts-gptsovits-ref-audio", "tts-gptsovits-prompt-text"],
  "custom-cloud": ["tts-custom-cloud-url", "tts-custom-cloud-key", "tts-custom-cloud-voice", "tts-custom-cloud-timeout"],
  mimo:           ["tts-mimo-key", "tts-mimo-voice-audio", "tts-mimo-style"],
  mossland:       ["tts-mossland-key", "tts-mossland-voice", "tts-mossland-model", "tts-mossland-text", "tts-mossland-format"],
};

// Provider ID → { ,  div }
//  ttsEl() ： null， settings.ts .
function safeGet(id: string): HTMLElement | null {
  return document.getElementById(id);
}
const ttsProviderUi: Record<string, { btn: HTMLButtonElement; status: HTMLElement } | null> = {
  minimax:        ttsEl("tts-minimax-save-btn") && safeGet("tts-minimax-save-status")
                    ? { btn: ttsEl("tts-minimax-save-btn"), status: safeGet("tts-minimax-save-status") as HTMLElement }
                    : null,
  gptsovits:      ttsEl("tts-gptsovits-save-btn") && safeGet("tts-gptsovits-save-status")
                    ? { btn: ttsEl("tts-gptsovits-save-btn"), status: safeGet("tts-gptsovits-save-status") as HTMLElement }
                    : null,
  "custom-cloud": ttsEl("tts-custom-cloud-save-btn") && safeGet("tts-custom-cloud-save-status")
                    ? { btn: ttsEl("tts-custom-cloud-save-btn"), status: safeGet("tts-custom-cloud-save-status") as HTMLElement }
                    : null,
  mimo:           ttsEl("tts-mimo-save-btn") && safeGet("tts-mimo-save-status")
                    ? { btn: ttsEl("tts-mimo-save-btn"), status: safeGet("tts-mimo-save-status") as HTMLElement }
                    : null,
  mossland:       ttsEl("tts-mossland-save-btn") && safeGet("tts-mossland-save-status")
                    ? { btn: ttsEl("tts-mossland-save-btn"), status: safeGet("tts-mossland-save-status") as HTMLElement }
                    : null,
};

// ："Unsaved changes"， IPC
function markTtsProviderDirty(provider: string): void {
  const ui = ttsProviderUi[provider];
  if (!ui) return;
  ui.btn.classList.remove("is-hidden");
  ui.status.textContent = "Unsaved changes";
  ui.status.className = "save-status";
}

for (const [provider, elIds] of Object.entries(TTS_PROVIDER_FIELDS)) {
  for (const elId of elIds) {
    const el = ttsEl(elId);
    el.addEventListener("input", () => markTtsProviderDirty(provider));
  }
}

//  Provider 
async function saveTtsProvider(provider: string): Promise<void> {
  const ui = ttsProviderUi[provider];
  if (!ui) return;
  const fields = TTS_PROVIDER_FIELDS[provider] ?? [];
  ui.btn.disabled = true;
  ui.status.textContent = "Saving…";
  ui.status.className = "save-status";
  try {
    const payload: Record<string, unknown> = {};
    for (const elId of fields) {
      const field = TTS_FIELD_MAP[elId];
      if (!field) continue;
      const el = ttsEl(elId);
      // （timeout) Number；None
      let value: unknown = el.value;
      if (elId === "tts-custom-cloud-timeout") {
        const num = Number(el.value);
        if (!Number.isFinite(num) || num <= 0) continue;
        value = num;
      }
      payload[field] = value;
      ttsConfig[field] = value;   //  ttsConfig 
    }
    if (Object.keys(payload).length === 0) {
      ui.status.textContent = "Nothing to save";
      ui.status.className = "save-status";
      return;
    }
    await window.tts!.saveSettings(payload);
    ui.status.textContent = "Saved";
    ui.status.className = "save-status is-ok";
    ui.btn.classList.add("is-hidden");
    setTimeout(() => { ui.status.textContent = ""; }, 2000);
  } catch (e) {
    ui.status.textContent = "Save failed: " + (e instanceof Error ? e.message : String(e));
    ui.status.className = "save-status is-error";
  } finally {
    ui.btn.disabled = false;
  }
}

//  handler
for (const [provider, ui] of Object.entries(ttsProviderUi)) {
  ui?.btn.addEventListener("click", () => void saveTtsProvider(provider));
}

// GPT-SoVITS （select，change )
(ttsEl("tts-gptsovits-format") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField("ttsGptsovitsFormat", (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value as "wav" | "mp3");
});
document.getElementById("tts-gptsovits-lang-mode")?.addEventListener("change", () => {
  const val = (document.getElementById("tts-gptsovits-lang-mode") as HTMLSelectElement).value;
  void saveTtsField("ttsGptsovitsLanguageMode", val as "english" | "original-mandarin");
});
document.getElementById("tts-rvc-enabled")?.addEventListener("change", () => {
  const checked = (document.getElementById("tts-rvc-enabled") as HTMLInputElement).checked;
  const panel = document.getElementById("tts-rvc-panel");
  if (panel) panel.hidden = !checked;
  void saveTtsField("ttsRvcEnabled", checked);
});
document.getElementById("tts-rvc-url")?.addEventListener("change", () => {
  void saveTtsField("ttsRvcBaseUrl", (document.getElementById("tts-rvc-url") as HTMLInputElement).value.trim());
});
document.getElementById("tts-rvc-model")?.addEventListener("change", () => {
  void saveTtsField("ttsRvcModel", (document.getElementById("tts-rvc-model") as HTMLInputElement).value.trim());
});
document.getElementById("tts-rvc-pitch")?.addEventListener("change", () => {
  void saveTtsField("ttsRvcPitch", Number((document.getElementById("tts-rvc-pitch") as HTMLInputElement).value) || 0);
});

// 
(ttsEl("tts-custom-cloud-format") as HTMLSelectElement).addEventListener("change", () => {
  void saveTtsField("ttsCustomCloudFormat", (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value as "wav" | "mp3");
});

// MiniMax 
ttsEl("tts-streaming").addEventListener("change", () => {
  void saveTtsField("ttsStreaming", ttsEl("tts-streaming").checked);
});

// GPT-SoVITS 
document.getElementById("tts-gptsovits-ref-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudioFile();
  if (filePath) {
    ttsEl("tts-gptsovits-ref-audio").value = filePath;
    void saveTtsField("ttsGptsovitsRefAudioPath", filePath);
  }
});

// GPT-SoVITS 
document.getElementById("tts-gptsovits-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const baseUrl = ttsEl("tts-gptsovits-url").value.trim();
  const refAudioPath = ttsEl("tts-gptsovits-ref-audio").value.trim();
  const promptText = ttsEl("tts-gptsovits-prompt-text").value.trim();
  const format = (ttsEl("tts-gptsovits-format") as HTMLSelectElement).value as "wav" | "mp3";
  if (!baseUrl) { await showAlert("Enter the GPT-SoVITS API address first."); return; }

  const btn = document.getElementById("tts-gptsovits-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Synthesizing...";
  try {
    const result = await window.tts.synthesizeGptsovits({
      baseUrl, refAudioPath, promptText, text: TTS_TEST_TEXT, format,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    await showAlert("Voice test failed: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "Test Voice";
  }
});

// Edge Neural Test
document.getElementById("tts-edge-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const btn = document.getElementById("tts-edge-test") as HTMLButtonElement | null;
  const statusEl = document.getElementById("tts-edge-test-status");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Synthesizing...";
  }
  if (statusEl) {
    statusEl.textContent = "Synthesizing...";
    statusEl.className = "save-status";
  }
  try {
    const res = await window.tts.synthesizeOnline?.({
      text: "开拓者，希琳一直都在这里陪着你哦。",
      lang: "zh-CN",
    });
    if (res && res.base64) {
      playTtsAudio(res.base64, (res.format as "wav" | "mp3") || "mp3");
      if (statusEl) {
        statusEl.textContent = "Playing";
        statusEl.className = "save-status is-ok";
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
      }
    } else {
      throw new Error("No audio returned");
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "Test failed: " + (err instanceof Error ? err.message : String(err));
      statusEl.className = "save-status is-error";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Test Voice";
    }
  }
});

//  MiMo 
document.getElementById("tts-mimo-voice-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudioFile();
  if (filePath) {
    ttsEl("tts-mimo-voice-audio").value = filePath;
    void saveTtsField("ttsMimoVoiceAudioPath", filePath);
  }
});

// 
document.getElementById("tts-custom-cloud-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const endpointUrl = ttsEl("tts-custom-cloud-url").value.trim();
  const apiKey = ttsEl("tts-custom-cloud-key").value.trim();
  const voiceId = ttsEl("tts-custom-cloud-voice").value.trim();
  const format = (ttsEl("tts-custom-cloud-format") as HTMLSelectElement).value as "wav" | "mp3";
  const timeoutMs = Number(ttsEl("tts-custom-cloud-timeout").value) || 30000;
  if (!endpointUrl) { await showAlert("Enter the custom cloud endpoint URL first."); return; }

  const btn = document.getElementById("tts-custom-cloud-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Synthesizing…";
  try {
    const result = await window.tts.synthesizeCustomCloud({
      endpointUrl, apiKey, voiceId, text: TTS_TEST_TEXT,
      speed: Number(ttsEl("tts-speed").value),
      volume: Number(ttsEl("tts-volume").value),
      format,
      timeoutMs,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    await showAlert("Test failed: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Test Voice";
  }
});

//  MiMo 
document.getElementById("tts-mimo-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mimo-key").value.trim();
  const voiceAudioPath = ttsEl("tts-mimo-voice-audio").value.trim();
  const stylePrompt = ttsEl("tts-mimo-style").value.trim();
  if (!apiKey) { await showAlert("Enter the Xiaomi MiMo API key first."); return; }
  if (!voiceAudioPath) { await showAlert("Please select a reference audio file first"); return; }

  const btn = document.getElementById("tts-mimo-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Synthesizing…";
  try {
    const result = await window.tts.synthesizeMimo({
      apiKey, voiceAudioPath, stylePrompt, text: TTS_TEST_TEXT,
    });
    playTtsAudio(result.base64, result.format);
  } catch (err) {
    await showAlert("Test failed: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Test Voice";
  }
});

// ── Mossland ──
//  UI ："" modal，
// ── Mossland ──
// ： IPC ， status / alert.
function setMosslandStatus(text: string, type: "ok" | "error" | "loading"): void {
  const el = document.getElementById("tts-mossland-clone-status");
  if (!el) return;
  el.textContent = text;
  el.className = "tts-clone-status" + (type ? " is-" + type : "");
}

function setMosslandListStatus(text: string, type: "ok" | "error" | "loading"): void {
  const el = document.getElementById("tts-mossland-list-voices-status");
  if (!el) return;
  el.textContent = text;
  el.className = "tts-clone-status" + (type ? " is-" + type : "");
}

/**  voices  `<ul>`；" voice"， #tts-mossland-voice */
function renderMosslandVoiceList(voices: Array<{ id: string; name: string }>): void {
  const ul = document.getElementById("tts-mossland-voice-list");
  if (!ul) return;
  ul.replaceChildren();
  for (const v of voices) {
    const li = document.createElement("li");
    const idSpan = document.createElement("span");
    idSpan.className = "voice-id";
    idSpan.textContent = v.id;
    const nameSpan = document.createElement("span");
    nameSpan.className = "voice-name";
    nameSpan.textContent = v.name;
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "voice-use";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      ttsEl("tts-mossland-voice").value = v.id;
    });
    li.append(idSpan, nameSpan, useBtn);
    ul.appendChild(li);
  }
}

// ： window.tts.synthesizeMossland
document.getElementById("tts-mossland-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  const voiceId = ttsEl("tts-mossland-voice").value.trim();
  const text = ttsEl("tts-mossland-text").value.trim();
  const model = (ttsEl("tts-mossland-model") as HTMLSelectElement).value;
  const format = (ttsEl("tts-mossland-format") as HTMLSelectElement).value as "mp3" | "wav" | "pcm";
  if (!apiKey) { await showAlert("Enter the Mossland API key first."); return; }
  if (!voiceId) { await showAlert("Enter a voice ID or fetch the voice list below."); return; }
  if (!text) { await showAlert("Enter preview text first."); return; }

  const btn = document.getElementById("tts-mossland-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Synthesizing…";
  const statusEl = document.getElementById("tts-mossland-test-status");
  if (statusEl) { statusEl.textContent = "Synthesizing…"; statusEl.className = "tts-clone-status is-loading"; }
  try {
    const result = await window.tts.synthesizeMossland({
      apiKey, voiceId, text, model, format,
      speed: Number(ttsEl("tts-speed").value),
      volume: Number(ttsEl("tts-volume").value),
    });
    playTtsAudio(result.base64, result.format);
    if (statusEl) {
      statusEl.textContent = "✓ Success";
      statusEl.className = "tts-clone-status is-ok";
      setTimeout(() => { statusEl.textContent = ""; }, 2000);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "❌ " + (err instanceof Error ? err.message : String(err));
      statusEl.className = "tts-clone-status is-error";
    } else {
      await showAlert("Synthesis failed: " + (err instanceof Error ? err.message : String(err)));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Test Voice";
  }
});


// ：（ pickAudio)
document.getElementById("tts-mossland-clone-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudio();
  if (filePath) ttsEl("tts-mossland-clone-file").value = filePath;
});

// ：（multipart)
document.getElementById("tts-mossland-clone-start")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  const filePath = ttsEl("tts-mossland-clone-file").value.trim();
  const name = ttsEl("tts-mossland-clone-name").value.trim();
  const description = ttsEl("tts-mossland-clone-desc").value.trim();
  if (!apiKey) { await showAlert("Enter the Mossland API key first."); return; }
  if (!filePath) { await showAlert("Please select a reference audio file first"); return; }

  setMosslandStatus("Uploading and creating voice...", "loading");
  try {
    const result = await window.tts.cloneMossland({
      apiKey, filePath,
      name: name || undefined,
      description: description || undefined,
    });
    // " ID"+  ttsConfig（ / chat )
    ttsEl("tts-mossland-voice").value = result.voiceId;
    void saveTtsField("ttsMosslandVoiceId", result.voiceId);
    setMosslandStatus(`✅ Clone successful! voice_id: ${result.voiceId} has been auto-filled.`, "ok");
  } catch (err) {
    setMosslandStatus("❌ " + (err instanceof Error ? err.message : String(err)), "error");
  }
});

// ： listMosslandVoices + 
document.getElementById("tts-mossland-list-voices")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-mossland-key").value.trim();
  if (!apiKey) { await showAlert("Enter the Mossland API key first."); return; }

  setMosslandListStatus("Fetching voice list...", "loading");
  try {
    const result = await window.tts.listMosslandVoices({ apiKey, limit: 50 });
    if (result.voices.length === 0) {
      setMosslandListStatus("No cloned voices found. Create one using Voice Clone above.", "error");
    } else {
      renderMosslandVoiceList(result.voices);
      setMosslandListStatus(`✅ Found ${result.voices.length}  voice(s). Click "Use" to fill the voice ID.`, "ok");
    }
  } catch (err) {
    setMosslandListStatus("❌ " + (err instanceof Error ? err.message : String(err)), "error");
  }
});

//  modal（， showHtmlModal  MiniMax )
document.getElementById("tts-mossland-clone-info-btn")?.addEventListener("click", () => {
  void showHtmlModal({
    title: "Voice Clone Specifications",
    icon: "ⓘ",
    htmlBody: [
      '<div class="tts-clone-spec-block">',
      '  <h4><svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M18 22H30" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 28H30" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24.0083 22V34" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 15L24 21L18 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> Cost</h4>',
      '  <p>Please refer to the Mossland platform pricing page. Each created voice_id incurs charges.</p>',
      '     Unlike MiniMax: <strong>Mossland has no"7-day expiry"</strong>. voice_id is permanent.</p>',
      '</div>',
      '<div class="tts-clone-spec-block">',
      '  <h4><svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 4H41" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 44H41" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 44C13.6667 30.6611 18 23.9944 24 24C30 24.0056 34.3333 30.6722 37 44H11Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M37 4C34.3333 17.3389 30 24.0056 24 24C18 23.9944 13.6667 17.3278 11 4H37Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M21 15H27" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 38H29" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg> </h4>',
      '  <p>Created voice_id is <strong>permanent</strong> with no expiration or cooldown. Copy directly to Voice ID for permanent use. reuse.</p>',
      '</div>',
      '<div class="tts-clone-spec-block">',
      '  <h4><svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 44V4H31L40 14.5V44H8Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 14L26 16.9688V31.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20.5" cy="31.5" r="5.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>  <code>audio_sample</code></h4>',
      '  <ul>',
      '    <li>Request format: <strong>multipart/form-data</strong> (JSON/URL/base64 not supported)</li>',
      '    <li>Field: <code>audio_sample</code> (required)</li>',
      '    <li>Field: <code>name</code> (optional, voice name)</li>',
      '    <li>Field: <code>description</code> (optional, description)</li>',
      '    <li>Duration: ≤ 60 seconds</li>',
      '    <li>Format: wav (per docs)</li>',
      '  </ul>',
      '</div>',
      '<div class="tts-clone-spec-block">',
      '  <h4><svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="4"/><path d="M24 14V16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="32" r="2.5" fill="currentColor"/></svg> </h4>',
      '  <ul>',
      '    <li>After getting voice_id, call <code>POST /v1/audio/speech</code> with body: <code>{ model: "moss-tts", input: "...", voice_id: "..." }</code></li>',
      '    <li>Optional <code>delivery_method: "audio" \| "url"</code> (default: audio binary stream; url returns JSON with URL)</li>',
      '    <li><code>version</code> field is reserved — omit for now, server uses default version</li>',
      '  </ul>',
      '</div>',
    ].join("\n"),
  });
});

// MiniMax 
document.getElementById("tts-minimax-test")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-minimax-key").value.trim();
  const voiceId = ttsEl("tts-minimax-voice").value.trim();
  const modelSelect = ttsEl("tts-minimax-model") as HTMLSelectElement;
  const model = modelSelect.value === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo";
  if (!apiKey) { await showAlert("Enter the MiniMax API key first."); return; }
  if (!voiceId) { await showAlert("Enter a voice ID or train a cloned voice below."); return; }

  const btn = document.getElementById("tts-minimax-test") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Synthesizing…";
  try {
    const base64 = await window.tts.synthesize({ apiKey, voiceId, text: TTS_TEST_TEXT, model });
    playTtsAudio(base64);
  } catch (err) {
    await showAlert("Test failed: " + (err instanceof Error ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Test Voice";
  }
});

// ──  ──
// Voice file
document.getElementById("tts-clone-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudio();
  if (filePath) ttsEl("tts-clone-file").value = filePath;
});

// 
document.getElementById("tts-clone-prompt-pick")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const filePath = await window.tts.pickAudio();
  if (filePath) ttsEl("tts-clone-prompt-file").value = filePath;
});

// 
function setCloneStatus(text: string, type: "ok" | "error" | "loading"): void {
  const el = document.getElementById("tts-clone-status");
  if (!el) return;
  el.textContent = text;
  el.className = "tts-clone-status" + (type ? " is-" + type : "");
}

// 
document.getElementById("tts-clone-start")?.addEventListener("click", async () => {
  if (!window.tts) return;
  const apiKey = ttsEl("tts-minimax-key").value.trim();
  const cloneFile = ttsEl("tts-clone-file").value.trim();
  const promptFile = ttsEl("tts-clone-prompt-file").value.trim();
  const promptText = ttsEl("tts-clone-prompt-text").value.trim();
  const cloneText = ttsEl("tts-clone-text").value.trim();
  const voiceId = ttsEl("tts-clone-voice-id").value.trim();

  if (!apiKey) { await showAlert("Enter the MiniMax API key first."); return; }
  if (!cloneFile) { await showAlert("Please select a voice audio file"); return; }
  if (!cloneText) { await showAlert("Please enter the clone text"); return; }
  if (!voiceId) { await showAlert("Please enter a voice ID"); return; }

  const btn = document.getElementById("tts-clone-start") as HTMLButtonElement;
  btn.disabled = true;
  setCloneStatus("Uploading voice file...", "loading");

  try {
    // 1: Voice file
    const cloneUpload = await window.tts.upload(apiKey, cloneFile, "voice_clone");
    setCloneStatus("Voice file uploaded (file_id: " + cloneUpload.file_id + "). Uploading sample audio...", "loading");

    // 2: （Optional)
    let promptFileId: string | undefined;
    if (promptFile) {
      const promptUpload = await window.tts.upload(apiKey, promptFile, "prompt_audio");
      promptFileId = promptUpload.file_id;
      setCloneStatus("Sample audio uploaded. Training voice model...", "loading");
    } else {
      setCloneStatus("Training voice model...", "loading");
    }

    // 3: 
    const result = await window.tts.clone({
      apiKey, fileId: cloneUpload.file_id, voiceId,
      promptAudioId: promptFileId, promptText: promptText || undefined,
      text: cloneText,
    });

    //  ID
    ttsEl("tts-minimax-voice").value = result.voiceId;
    void saveTtsField("ttsMinimaxVoiceId", result.voiceId);

    setCloneStatus("✅ Clone successful! Voice ID: " + result.voiceId + " has been auto-filled.", "ok");

    // ，
    if (result.audioDemo) {
      try {
        const resp = await fetch(result.audioDemo);
        const buf = await resp.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        playTtsAudio(base64);
      } catch { /* preview audio playback failure does not affect main flow */ }
    }
  } catch (err) {
    setCloneStatus("❌ " + (err instanceof Error ? err.message : String(err)), "error");
  } finally {
    btn.disabled = false;
  }
});

// ── ： ──
//  C:\Users\13575\Desktop\minimax-tts.md（ / Voice Clone)
// ：file_id → voice_id → clone_prompt(prompt_audio / prompt_text) → text()
const CLONE_SPEC_BODY = [
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>',
  '      <path d="M18 22H30" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M18 28H30" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M24.0083 22V34" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M30 15L24 21L18 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '    </svg>',
  '    Cost',
  '  </h4>',
  '  <p>Each successful clone costs <span class="tts-clone-fee">¥9.9</span>.',
  '     Preview (<code>text</code> + <code>model</code>) charges standard T2A character cost.</p>',
  '</div>',
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M7 4H41" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M7 44H41" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M11 44C13.6667 30.6611 18 23.9944 24 24C30 24.0056 34.3333 30.6722 37 44H11Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>',
  '      <path d="M37 4C34.3333 17.3389 30 24.0056 24 24C18 23.9944 13.6667 17.3278 11 4H37Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>',
  '      <path d="M21 15H27" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M19 38H29" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '    </svg>',
  '    Expiry Policy',
  '  </h4>',
  '  <p>Cloned voices without calls for <strong>7 days</strong> will be automatically deleted by the platform. Call occasionally to retain."▶ Test Voice" to keep them active.</p>',
  '</div>',
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M8 44V4H31L40 14.5V44H8Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M32 14L26 16.9688V31.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <circle cx="20.5" cy="31.5" r="5.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '    </svg>',
  '    Voice file <code>file_id</code> (required)',
  '  </h4>',
  '  <ul>',
  '    <li>Format: mp3 / m4a / wav</li>',
  '    <li>Duration: 10 sec – 5 min</li>',
  '    <li>Size: ≤ 20 MB</li>',
  '  </ul>',
  '</div>',
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M10 10H32H38V44H10V10Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M10 10L32 4V10" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <circle cx="24" cy="24" r="4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M20 34H28" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '    </svg>',
  '    Custom voice_id (required)',
  '  </h4>',
  '  <ul>',
  '    <li>Length: 8 – 256 characters</li>',
  '    <li>Must start with a letter</li>',
  '    <li>Allowed: letters, digits, <code>-</code>、<code>_</code></li>',
  '    <li>Cannot end with <code>-</code> or <code>_</code></li>',
  '    <li>Must be unique</li>',
  '  </ul>',
  '</div>',
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M24 44C35.0457 44 44 35.0457 44 24C44 12.9543 35.0457 4 24 4C12.9543 4 4 12.9543 4 24C4 35.0457 12.9543 44 24 44Z" fill="none" stroke="currentColor" stroke-width="4"/>',
  '      <path d="M30 18V30" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M36 22V26" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M18 18V30" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M12 22V26" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M24 14V34" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '    </svg>',
  '    Sample audio clone_prompt (optional, highly recommended)',
  '  </h4>',
  '  <p>Providing a sample audio significantly improves voice similarity and stability.</p>',
  '  <ul>',
  '    <li>Format: mp3 / m4a / wav</li>',
  '    <li>Duration: &lt; 8 seconds</li>',
  '    <li>Size: ≤ 20 MB</li>',
  '    <li>Must include matching <code>prompt_text</code>, ending with punctuation</li>',
  '  </ul>',
  '</div>',
  '<div class="tts-clone-spec-block">',
  '  <h4>',
  '    <svg class="tts-clone-spec-icon" width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
  '      <path d="M40 33V42C40 43.1046 39.1046 44 38 44H31.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M40 16V6C40 4.89543 39.1046 4 38 4H10C8.89543 4 8 4.89543 8 6V42C8 43.1046 8.89543 44 10 44H16" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  '      <path d="M16 16H30" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M23 44L40 23" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '      <path d="M16 24H24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  '    </svg>',
  '    Clone text <code>text</code> (preview use, ≤1000 chars)',
  '  </h4>',
  '  <p>The model will read this text in the cloned voice and return a preview audio link.</p>',
  '</div>',
].join("\n");

function showCloneSpecModal(): void {
  void showHtmlModal({
    title: "Voice Clone Full Specs",
    icon: "ⓘ",
    htmlBody: CLONE_SPEC_BODY,
  });
}

document.getElementById("tts-clone-info-btn")?.addEventListener("click", showCloneSpecModal);
document.getElementById("tts-clone-info-link")?.addEventListener("click", showCloneSpecModal);

// 
void loadTtsConfig();


// Update checker wiring
(function setupUpdateChecker() {
  const checkUpdateBtn = document.getElementById("check-update-btn") as HTMLButtonElement | null;
  const updateStatusText = document.getElementById("app-update-status-text") as HTMLElement | null;

  checkUpdateBtn?.addEventListener("click", async () => {
    if (!updateStatusText) return;
    updateStatusText.textContent = "Checking GitHub Releases...";
    checkUpdateBtn.disabled = true;

    try {
      const result = await window.updater?.checkForUpdates();
      if (result?.hasUpdate) {
        updateStatusText.textContent = "Update available: v" + result.latestVersion + "!";
        if (result.downloadUrl) {
          await window.system?.openExternal(result.downloadUrl);
        }
      } else if (result?.error) {
        updateStatusText.textContent = "Check failed: " + result.error;
      } else {
        updateStatusText.textContent = "You are on the latest version (v" + (result?.currentVersion || "0.9.0") + ").";
      }
    } catch (err: unknown) {
      updateStatusText.textContent = "Check failed: " + (err instanceof Error ? err.message : String(err));
    } finally {
      checkUpdateBtn.disabled = false;
    }
  });
})();

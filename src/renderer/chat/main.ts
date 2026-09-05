import "../ui/base.css";
import "./chat.css";
import "../ui/theme";
import { showConfirm, showAlert } from "../ui/modal";
import { initMarkdownRenderer, initCodeBlockController, renderMarkdown, createStreamingMarkdownSession, getMd } from "./markdown/init";
import type { StreamingMarkdownSession } from "./markdown/init";
import {
  formatChatRelativeTime,
  type ChatSessionMetaUI,
} from "../../shared/chat-ui";
import { normalizeDefaultChatMode, type DefaultChatMode } from "../../shared/preferences";
import { normalizeStyleId, type StyleId } from "../../shared/style-sampling";
import type { ScreenshotInsertPayload } from "../../shared/ipc-channels";
import { userAnnotationNotice } from "../../shared/chat-context";
import { canUseMinimaxStreamingEarly, extractEarlyTtsSegment } from "../../shared/tts-early-playback";
import { getStickerSrcForId } from "./sticker-src";
import { formatAttachmentTagDetail, getAttachmentIcon } from "./attachment-labels";
import { resolveAsset } from "../../shared/renderer-base";
import { cleanTextForSpeech } from "../live2d/voice";
import {
  getAssistantReplyBubbleTexts,
  MAX_ASSISTANT_REPLY_BUBBLES,
  shouldBreakStreamingBubbleAfterChar,
  shouldSegmentAssistantReply,
} from "./message-segmentation";
import { buildDocumentContextLines, processDocumentsWithWait, type RetrievedDocumentChunk } from "./document-processing";
import { decideReloadCurrentSession } from "./session-reload-policy";
import {
  canCancelDocumentIndexStatus,
  getDocumentIndexStatusLabel,
  type DocumentIndexCardStatus,
  type DocumentIndexProgress,
} from "./types";
import { normalizeMusicCardData, type MusicCardData } from "../../shared/music-card";
import { requestTrackPlayback } from "../settings/music-playback";
import type {
  AskClarificationCard,
  AskQuestion,
  AskUserAnswer,
} from "../../shared/ask-clarification";

type Role = "user" | "model";

interface Message {
  id: string;
  role: Role;
  content: string;
  at: number;
  modelContext?: string;
  attachments?: MessageAttachment[];
  sticker?: string | null;
  thinking?: boolean;
  transient?: boolean;
  ttsCacheKey?: string;
  musicCard?: MusicCardData;
}

type MessageAttachment = ImageMessageAttachment | DocumentMessageAttachment;

interface ImageMessageAttachment {
  kind: "image";
  name: string;
  filePath: string;
  mime: string;
  previewUrl?: string;
  caption?: string;
  hasAnnotations?: boolean;
  status: "pending" | "done" | "error";
}

interface DocumentMessageAttachment {
  kind: "document";
  name: string;
  filePath: string;
  status: DocumentIndexCardStatus;
  jobId?: string;
  processedKind?: "text" | "indexed" | "empty" | "unsupported";
  chunks?: number;
  importId?: string;
  reason?: string;
}

interface ModelConfig {
  mode: "auto" | "manual";
  provider: string;
  model: string;
  connected: boolean;
  stickerSize: "small" | "standard" | "large";
}

interface ModelConfigApi {
  get: () => Promise<ModelConfig>;
  onChanged: (callback: (config: ModelConfig) => void) => () => void;
}

interface ChatApi {
    minimize: () => void;
    close: () => void;
    toggleMaximize: () => void;
    isMaximized: () => Promise<boolean>;
    ingestDroppedFiles: (files: File[]) => Promise<Attachment[]>;
    processDocuments: (filePaths: string[], query: string) => Promise<Attachment[]>;
    onDocumentIndexProgress?: (callback: (progress: DocumentIndexProgress) => void) => () => void;
    cancelDocumentIndex: (jobId: string) => Promise<boolean>;
    captionImage: (filePath: string, hasAnnotations?: boolean) => Promise<{ ok: boolean; caption?: string; error?: string }>;
    getImageSendStrategy: () => Promise<{ mode: "direct" | "caption" }>;
    getGeneralSettings?: () => Promise<{ defaultChatMode?: DefaultChatMode; segmentedOutputMode?: "all" | "chat" | "off"; currentStyleId?: StyleId }>;
    getEnabledStickers?: () => Promise<Array<{ id: string; src: string; description?: string }>>;
    startScreenshot: () => Promise<{ ok: boolean; reason?: string }>;
    instantScreenLook?: () => Promise<ScreenshotInsertPayload | null>;
    onScreenshotInsert: (callback: (data: ScreenshotInsertPayload) => void) => () => void;
    saveScreenshotTemp: (base64: string, mime: string) => Promise<{ filePath: string }>;
  }

interface ChatSettingsApi {
  saveGeneral?: (config: { currentStyleId?: StyleId }) => Promise<unknown>;
}

/** AG-UI  API（window.agui）。 */
const BUDGET_CHARS = 60000;

/* ===== TTS  SVG =====
   Static version uses a single arc for speaker wave; active version uses 3 wave bars + CSS wave animation.
   All colors currentColor, following theme color changes; does not depend on emoji fonts. */
const SPEAK_ICON_IDLE = `<svg class="msg__speak-icon msg__speak-icon--idle" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
  <path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"/>
  <path d="M16 8.5a4 4 0 0 1 0 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
</svg>`;
const SPEAK_ICON_ACTIVE = `<svg class="msg__speak-icon msg__speak-icon--active" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
  <path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"/>
  <path class="msg__speak-wave msg__speak-wave--1" d="M14 9.5v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path class="msg__speak-wave msg__speak-wave--2" d="M17 7.5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path class="msg__speak-wave msg__speak-wave--3" d="M20 5.5v13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

/* =====  SVG =====
   Static version has two overlapping squares (standard copy icon); success version swaps to checkmark + "Copied". */
const COPY_ICON_IDLE = `<svg class="msg__copy-icon msg__copy-icon--idle" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
  <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/>
  <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const COPY_ICON_DONE = `<svg class="msg__copy-icon msg__copy-icon--done" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
  <path d="M5 12.5l4 4 10-10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

interface AguiApi {
  run: (input: {
    messages: unknown[];
    userTurnId?: string;
    assistantTurnId?: string;
    styleId: StyleId;
    executionMode: "work" | "chat";
    sessionId?: string;
    attachments?: { name: string; text: string }[];
    imageAttachments?: { name: string; filePath: string; mime?: string }[];
  }) => Promise<{ success: boolean; error?: string }>;
  onEvent: (callback: (event: unknown) => void) => () => void;
  cancel: () => Promise<boolean>;
}

interface SchedulerEventsApi {
  onEvent: (callback: (event: unknown) => void) => () => void;
}

/** Select API（window.choice）。 AGUI_EVENT CUSTOM，resolve  IPC。 */
interface ChoiceApi {
  resolve: (id: string, value: unknown) => Promise<unknown>;
}

interface ChatMusicApi {
  playTrack: (trackId: string) => Promise<{
    ok: boolean;
    data?: { state: "dispatched" | "web_fallback" | "client_unavailable" | "launch_failed" };
    errorCode?: string;
  }>;
}

/** AG-UI BaseEvent Local（）。 */
interface AguiBaseEvent {
  type: string;
  messageId?: string;
  delta?: string;
  role?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: string;
  error?: string;
  message?: string;  // Canonical field for RUN_ERROR (upstream RunErrorEvent.message)
  code?: string;     // Structured error code (AgentRuntimeError.code)
  stepName?: string;
  runId?: string;
  threadId?: string;
  schedulerRunId?: string;
  schedulerTaskId?: string;
  name?: string;   // CUSTOM event name
  value?: unknown; // CUSTOM event value
}

/**
 *  Agent Error。 code， failRun reject  catch 。
 *  AgentRuntimeError ， renderer 。
 */
class AgentRenderError extends Error {
  constructor(
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "AgentRenderError";
  }
}

/** Translate Agent runtime errors to user-facing messages based on structured error codes. */
function classifyAgentError(code: string | undefined, message: string): string {
  // Strip internal Electron IPC wrappers if present
  const cleanMessage = message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, "").trim();

  if (
    cleanMessage.includes("API Key") ||
    cleanMessage.includes("API key") ||
    cleanMessage.includes("No API key") ||
    cleanMessage.includes("not configured") ||
    cleanMessage.includes("apiKey")
  ) {
    return "🌸 **Cyrene is waiting for your API Key!**\n\nPlease open **Settings** (shortcut: `Alt+S`) to configure your model provider and API key to start chatting.";
  }

  if (
    cleanMessage.includes("No model") ||
    cleanMessage.includes("No model endpoint") ||
    cleanMessage.includes("Not configured")
  ) {
    return "🌸 **Model not configured yet!**\n\nPlease open **Settings** (shortcut: `Alt+S`) to select a model provider and enter the endpoint.";
  }

  if (code === "E_AGENT_NO_PROGRESS") return "Task execution could not proceed. Please try again.";
  if (code === "E_AGENT_GRAPH_ITERATION_LIMIT") return "Agent execution reached the iteration limit.";
  if (code === "E_MODEL_REQUEST_FAILED") return "Failed to connect to model: " + cleanMessage;
  if (code === "E_ACTION_GATE_PROTOCOL") return "Decision protocol parsing failed. Please try again.";
  return cleanMessage || "Model request failed. Please try again.";
}

/** （ main  file-ingest.ts  Attachment ）。 */
type AttachmentKind = "text" | "indexed" | "empty" | "unsupported" | "error" | "image" | "document";

interface Attachment {
  name: string;
  kind: AttachmentKind;
  filePath?: string;
  mime?: string;
  previewUrl?: string;
  caption?: string;
  hasAnnotations?: boolean;
  status?: DocumentIndexCardStatus;
  text?: string;
  chunks?: number;
  importId?: string;
  retrievedChunks?: RetrievedDocumentChunk[];
  reason?: string;
}

/** （todo_write ）。 */
interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
}
interface TodoState {
  todos: TodoItem[];
  updatedAt: number;
}

interface UserApi {
  getAvatar: () => Promise<string | null>;
  onAvatarChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    chat?: ChatApi;
    agui?: AguiApi;
    schedulerEvents?: SchedulerEventsApi;
    modelConfig?: ModelConfigApi;
    choice?: ChoiceApi;
    music?: ChatMusicApi;
    user?: UserApi;
    settings?: ChatSettingsApi;
  }
}

const messagesEl = document.getElementById("messages") as HTMLElement;

//  Markdown （Shiki  + ）
initMarkdownRenderer();
initCodeBlockController(messagesEl);

// ── History ────────────────────────────────────
// render() placeholder， data-md-pending，
//  requestIdleCallback  Markdown HTML。

/** All bubble  markdown （WeakMap  DOM ） */
const bubbleRawText = new WeakMap<HTMLElement, string>();
/** ：pendingMarkdownText  WeakMap */
const pendingMarkdownText = bubbleRawText;

/**  */
let renderGeneration = 0;
let historyIdleId: number | null = null;

const HISTORY_MAX_BATCH = 3;
const HISTORY_MIN_REMAINING_MS = 4;

/** Cancel， generation */
function cancelHistoryRender(): void {
  renderGeneration++;
  if (historyIdleId !== null) {
    cancelIdleCallback(historyIdleId);
    historyIdleId = null;
  }
}

/** History（ render() ） */
function scheduleHistoryRender(): void {
  cancelHistoryRender();
  const gen = renderGeneration;

  const processBatch = (deadline?: IdleDeadline): void => {
    historyIdleId = null;
    if (gen !== renderGeneration) return; // cancelled

    const pendingBubbles = messagesEl.querySelectorAll<HTMLElement>("[data-md-pending='true']");
    if (pendingBubbles.length === 0) return;

    let processed = 0;
    const hasDeadline = !!deadline;

    for (const bubble of pendingBubbles) {
      if (gen !== renderGeneration) return; // cancelled
      if (!bubble.isConnected) continue;

      const text = pendingMarkdownText.get(bubble);
      if (text === undefined) {
        bubble.removeAttribute("data-md-pending");
        continue;
      }

      const result = renderMarkdown(text);
      if (result.mode === "html") {
        bubble.removeAttribute("data-md-mode");
        // ： DOM，，Clear→→
        const prevHeight = bubble.getBoundingClientRect().height;
        const tpl = document.createElement("template");
        tpl.innerHTML = result.content;
        bubble.style.minHeight = `${prevHeight}px`;
        bubble.replaceChildren(tpl.content.cloneNode(true));
        requestAnimationFrame(() => { bubble.style.minHeight = ""; });
      } else {
        bubble.setAttribute("data-md-mode", "text");
        bubble.textContent = result.content;
      }
      bubble.removeAttribute("data-md-pending");
      pendingMarkdownText.delete(bubble);
      processed++;

      // ： deadline ，None deadline 
      if (processed >= HISTORY_MAX_BATCH) break;
      if (hasDeadline && deadline!.timeRemaining() < HISTORY_MIN_REMAINING_MS) break;
    }

    //  pending，
    if (gen === renderGeneration && messagesEl.querySelector("[data-md-pending='true']")) {
      historyIdleId = requestIdleCallback(processBatch, { timeout: 200 });
    }
  };

  // requestIdleCallback fallback
  if (typeof requestIdleCallback === "function") {
    historyIdleId = requestIdleCallback(processBatch, { timeout: 200 });
  } else {
    historyIdleId = null;
    setTimeout(() => processBatch(undefined), 0);
  }
}

/**
 * RefreshCompleted Markdown （Shiki ）。
 * Global render()， session DOM。
 *  session （ B），。
 */
function refreshMarkdownTheme(): void {
  // Cancel
  cancelHistoryRender();

  // FoundAll， pending 
  const assistantBubbles = messagesEl.querySelectorAll<HTMLElement>(".msg--model .msg__bubble");
  for (const bubble of assistantBubbles) {
    const text = bubbleRawText.get(bubble);
    if (text !== undefined && text.trim()) {
      bubble.dataset.mdPending = "true";
    }
  }

  scheduleHistoryRender();
}

// 
window.cyreneTheme?.onChanged(() => {
  refreshMarkdownTheme();
});

const formEl = document.getElementById("composer") as HTMLFormElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
if (inputEl) inputEl.style.overflowY = "hidden";
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const stickerPickerBtn = document.getElementById("sticker-picker-btn") as HTMLButtonElement;
const stickerPicker = document.getElementById("sticker-picker") as HTMLElement;
const stickerPickerGrid = document.getElementById("sticker-picker-grid") as HTMLElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const maxBtn = document.getElementById("max-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const chatHintEl = document.getElementById("chat-hint") as HTMLElement;
const chatStatusBtn = document.getElementById("chat-status-btn") as HTMLButtonElement;
const chatRail = document.getElementById("chat-rail") as HTMLElement | null;
const chatRailNew = document.getElementById("chat-rail-new") as HTMLButtonElement | null;
const chatRailList = document.getElementById("chat-rail-list") as HTMLElement | null;
const chatRailEmpty = document.getElementById("chat-rail-empty") as HTMLElement | null;

//  localStorage key—— chats 。
const LEGACY_STORAGE_KEY = "cyrene.chat.history.v1";
/**
 * Avatar source per role. Empty string = use the gradient placeholder
 * baked into the CSS background of `.msg--user .msg__avatar`.
 *
 * Model side: Cyrene PNG， CSS border-radius: 50% 。
 * User side: ，Settings user  file://  data: URL。
 */
const AVATAR_SRC: Record<Role, string> = {
  model: resolveAsset("avatars/cyrene-avatar.png"),
  user: "",
};

// Load user avatar from profile and keep it in sync when changed in settings.
async function loadUserAvatar(): Promise<boolean> {
  try {
    const dataUrl = await window.user?.getAvatar();
    if (dataUrl) {
      AVATAR_SRC.user = dataUrl;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

(async () => {
  if (await loadUserAvatar()) {
    render();
  }
})();

window.user?.onAvatarChanged(() => {
  void (async () => {
    if (await loadUserAvatar()) {
      render();
    }
  })();
});

const BUILT_IN_STICKER_SRC: Record<string, string> = {
  playful: "/stickers/playful.png",
  "love-happy": "/stickers/love-happy.png",
  confident: "/stickers/confident.png",
  serious: "/stickers/serious.png",
  calm: "/stickers/calm.png",
  peek: "/stickers/peek.gif",
  "clingy-confused": "/stickers/clingy-confused.gif",
  "love-calm": "/stickers/love-calm.png",
  HI: "/stickers/HI.jpg",
  hello: "/stickers/hello.jpg",
  goodmoring1: "/stickers/goodmoring1.jpg",
  goodnight: "/stickers/goodnight.jpg",
  teatime: "/stickers/teatime.jpg",
  eating: "/stickers/eating.jpg",
  Allset: "/stickers/Allset.jpg",
  OK: "/stickers/OK.jpg",
  copythat: "/stickers/copythat.jpg",
  Thumbsup: "/stickers/Thumbsup.jpg",
  awesome: "/stickers/awesome.jpg",
  sogood: "/stickers/sogood.jpg",
  sonice: "/stickers/sonice.jpg",
  fighting: "/stickers/fighting.jpg",
  hellyeah: "/stickers/hellyeah.jpg",
  Thanks: "/stickers/Thanks.jpg",
  foryou: "/stickers/foryou.jpg",
  blushhard: "/stickers/blushhard.jpg",
  shyshort: "/stickers/shyshort.jpg",
  hmph: "/stickers/hmph.jpg",
  hugtight: "/stickers/hugtight.jpg",
  Airkiss: "/stickers/Airkiss.jpg",
  Gigglelots: "/stickers/Gigglelots.jpg",
  thinking: "/stickers/thinking.jpg",
  putmd: "/stickers/putmd.jpg",
  Whatswrong: "/stickers/Whatswrong.jpg",
  midmeh: "/stickers/midmeh.jpg",
  awkward: "/stickers/awkward.jpg",
  Madnow: "/stickers/Madnow.jpg",
  Hurtcry: "/stickers/Hurtcry.jpg",
  Sobbinghard: "/stickers/Sobbinghard.jpg",
  weeploud: "/stickers/weeploud.jpg",
  PanincCrying: "/stickers/PanincCrying.jpg",
  missme: "/stickers/missme.jpg",
  Free: "/stickers/Free.jpg",
  Dreak: "/stickers/Dreak.jpg",
  outfast: "/stickers/outfast.jpg",
  Vcayover: "/stickers/Vcayover.jpg",
  sleepynow: "/stickers/sleepynow.jpg",
  deadtired: "/stickers/deadtired.jpg",
  sotired: "/stickers/sotired.jpg",
  giveup: "/stickers/giveup.jpg",
  poorwallet: "/stickers/poorwallet.jpg",
  please: "/stickers/please.jpg",
};

function getStickerSrc(id: string): string | undefined {
  const raw = getStickerSrcForId(id, BUILT_IN_STICKER_SRC, enabledStickers);
  if (!raw) return undefined;
  //  /stickers/ （）， file:// 
  //  resolveAsset()  file://  http:// URL
  if (raw.startsWith("/stickers/")) {
    return resolveAsset(raw);
  }
  return raw;
}

// ：messages  session （， bootstrap ）。
// currentSessionId  id，All。
//  currentSessionId  null， sending （bootstrap ）。
const messages: Message[] = [];
let currentSessionId: string | null = null;
let sessionTailStart = 0;
let segmentedOutputMode: "all" | "chat" | "off" = "off";
const CHAT_WINDOW_SIZE = 100;
let currentModelConfig: ModelConfig | null = null;

function formatModelHint(config: ModelConfig | null): string {
  if (!config || !config.connected) return "Model disconnected";
  return `${config.model} Connected`;
}

function applyModelConfig(config: ModelConfig | null): void {
  currentModelConfig = config;
  chatHintEl.textContent = formatModelHint(config);
  document.documentElement.dataset.stickerSize = config?.stickerSize ?? "standard";
}

async function refreshModelConfig(): Promise<boolean> {
  try {
    const config = await window.modelConfig?.get();
    applyModelConfig(config ?? null);
    return Boolean(config?.connected);
  } catch (err) {
    console.warn("[Cyrene Chat] model config unavailable:", err);
    applyModelConfig(null);
    return false;
  }
}

async function initModelConfig(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await refreshModelConfig()) break;
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  window.modelConfig?.onChanged((config) => applyModelConfig(config));
}

// ──  ───────────────────────────────────────────
// Chat localStorage  chats ，
// All IPC（window.chatStore）。All saveHistory 
// saveSession， messages  session 。
//  shared  ChatSessionMetaUI（Settings）。

interface ChatStoreSession {
  id: string;
  title: string;
  identityId: string | null;
  messages: Array<{
    id: string;
    role: Role;
    content: string;
    at: number;
    modelContext?: string;
    attachments?: MessageAttachment[];
    sticker?: string | null;
    ttsCacheKey?: string;
    musicCard?: MusicCardData;
  }>;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
  purpose?: "proactive-chat";
}

interface ChatStoreApi {
  list: () => Promise<ChatSessionMetaUI[]>;
  get: (id: string) => Promise<ChatStoreSession | null>;
  getPage: (id: string, before: number | null, limit: number) => Promise<{ session: Omit<ChatStoreSession, "messages">; messages: ChatStoreSession["messages"]; hasMore: boolean } | null>;
  create: (payload?: { title?: string; identityId?: string | null }) => Promise<ChatStoreSession>;
  append: (id: string, message: unknown) => Promise<ChatStoreSession | null>;
  replaceMessages: (id: string, messages: unknown[]) => Promise<ChatStoreSession | null>;
  replaceTail: (id: string, startIndex: number, messages: unknown[]) => Promise<ChatStoreSession | null>;
  rename: (id: string, title: string) => Promise<ChatStoreSession | null>;
  delete: (id: string) => Promise<boolean>;
  openFolder: () => Promise<boolean>;
  migrateLegacy: (messages: unknown[]) => Promise<ChatStoreSession | null>;
  openInChatWindow: (sessionId: string) => Promise<boolean>;
  setActiveSession: (sessionId: string | null) => Promise<boolean>;
  getActiveSession: () => Promise<string | null>;
  onActiveSessionChanged: (callback: (sessionId: string | null) => void) => () => void;
  onChanged: (callback: () => void) => () => void;
  onSwitchSession: (callback: (sessionId: string) => void) => () => void;
}

declare global {
  interface Window {
    chatStore?: ChatStoreApi;
  }
}

//  Message ：
// -  content /  thinking placeholder（thinking=true  content ，）
// -  modelContext  thinking 
function toPersistableMessages(arr: Message[]): Array<{
  id: string; role: Role; content: string; at: number; attachments?: MessageAttachment[]; sticker?: StickerId | null; ttsCacheKey?: string; musicCard?: MusicCardData;
}> {
  return arr
    .filter((m) => m && (m.role === "user" || m.role === "model") && !m.thinking && !m.transient && (
      typeof m.content === "string" && m.content.trim()
      || ((m.attachments?.length ?? 0) > 0)
      || Boolean(m.sticker)
      || Boolean(m.musicCard)
    ))
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      at: m.at,
      attachments: m.attachments,
      sticker: m.sticker ?? null,
      ttsCacheKey: m.ttsCacheKey,
      musicCard: m.musicCard,
    }));
}

async function saveSession(): Promise<void> {
  if (!currentSessionId || !window.chatStore) return;
  try {
    await window.chatStore.replaceTail(currentSessionId, sessionTailStart, toPersistableMessages(messages));
  } catch (err) {
    console.warn("[Cyrene Chat] saveSession failed:", err);
  }
}

//  store  ChatStoreSession （ messages  render）。
function loadSessionIntoUI(session: ChatStoreSession): void {
  currentSessionId = session.id;
  seenSessionUpdatedAt.set(session.id, session.updatedAt);
  unreadProactiveSessionIds.delete(session.id);
  messages.length = 0;
  for (const m of session.messages) {
    messages.push({
      id: m.id,
      role: m.role,
      content: m.content,
      at: m.at,
      attachments: m.attachments,
      sticker: m.sticker ?? null,
      ttsCacheKey: m.ttsCacheKey,
      musicCard: m.musicCard,
    });
  }
  //  sessionId（Settings"Delete"Notice）
  void window.chatStore?.setActiveSession(session.id);
  render();
  // Refresh
  void renderRailList();
}

async function loadSessionTailIntoUI(id: string): Promise<boolean> {
  const page = await window.chatStore?.getPage(id, null, CHAT_WINDOW_SIZE);
  if (!page) return false;
  sessionTailStart = Math.max(0, page.session.messageCount - page.messages.length);
  loadSessionIntoUI({ ...page.session, messages: page.messages });
  return true;
}

async function loadEarlierMessages(): Promise<void> {
  if (!currentSessionId || !window.chatStore || sessionTailStart <= 0) return;
  const beforeHeight = messagesEl.scrollHeight;
  const page = await window.chatStore.getPage(currentSessionId, sessionTailStart, CHAT_WINDOW_SIZE);
  if (!page) return;
  sessionTailStart -= page.messages.length;
  messages.unshift(...page.messages);
  render(true);
  messagesEl.scrollTop = messagesEl.scrollHeight - beforeHeight;
}

// ── （ loader ）──
// ：+New Chat /  / 。DeleteSettings。
//  settings.ts  renderChatSessions （ shared ），
// ：Local loadSessionIntoUI， IPC，。

const unreadProactiveSessionIds = new Set<string>();
const seenSessionUpdatedAt = new Map<string, number>();

async function renderRailList(): Promise<void> {
  if (!chatRailList || !window.chatStore) return;

  let sessions: ChatSessionMetaUI[] = [];
  try {
    sessions = await window.chatStore.list();
  } catch (err) {
    console.warn("[Cyrene Chat] Sidebar load sessions failed:", err);
  }

  chatRailList.innerHTML = "";
  if (sessions.length === 0) {
    if (chatRailEmpty) chatRailEmpty.classList.remove("is-hidden");
    return;
  }
  if (chatRailEmpty) chatRailEmpty.classList.add("is-hidden");

  for (const session of sessions) {
    const item = buildRailItem(session);
    chatRailList.appendChild(item);
  }
}

function buildRailItem(session: ChatSessionMetaUI): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "chat__rail-item";
  if (session.id === currentSessionId) li.classList.add("is-active");
  li.dataset.sessionId = session.id;

  const titleEl = document.createElement("div");
  titleEl.className = "chat__rail-title";
  titleEl.textContent = session.title || "New Chat";
  if (unreadProactiveSessionIds.has(session.id)) titleEl.textContent = `● ${titleEl.textContent}`;

  const metaEl = document.createElement("div");
  metaEl.className = "chat__rail-meta";

  const timeEl = document.createElement("span");
  timeEl.className = "chat__rail-time";
  timeEl.textContent = formatChatRelativeTime(session.updatedAt);


  metaEl.appendChild(timeEl);

  //  = Local（ IPC，Settings）
  li.addEventListener("click", async () => {
    if (sending) {
      announceScreenshotStatus("Cyrene is still replying. Please wait or stop generation first.");
      return;
    }
    if (session.id === currentSessionId) return;
    await loadSessionTailIntoUI(session.id);
  });

  li.appendChild(titleEl);
  li.appendChild(metaEl);
  return li;
}

// loader  toggle 
chatStatusBtn?.addEventListener("click", () => {
  if (!chatRail) return;
  chatRail.toggleAttribute("hidden");
  // （ onChanged Refresh）
  if (!chatRail.hidden) void renderRailList();
});

// +New Chat
chatRailNew?.addEventListener("click", async () => {
  if (sending) {
    announceScreenshotStatus("Cyrene is still replying. Please wait or stop generation first.");
    return;
  }
  if (!window.chatStore) return;
  try {
    const session = await window.chatStore.create({ identityId: null });
    if (session?.id) {
      const full = await window.chatStore.get(session.id);
      if (full) loadSessionIntoUI(full as ChatStoreSession);
    }
  } catch (err) {
    console.warn("[Cyrene Chat] Create session failed:", err);
  }
});

// ： localStorage  →  session →  key。
// Failed/ no-op， bootstrap。
async function maybeMigrateLegacy(): Promise<void> {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    const normalized = (parsed as Message[]).filter(
      (m) => m && (m.role === "user" || m.role === "model") && typeof m.content === "string" && m.content.trim(),
    );
    if (normalized.length === 0) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    const migrated = await window.chatStore?.migrateLegacy(normalized);
    if (migrated) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("[Cyrene Chat] Legacy localStorage migration failed:", err);
  }
}

// ： →  session → render
async function bootstrap(): Promise<void> {
  try {
    if (!window.chatStore) {
      console.warn("[Cyrene Chat] chatStore IPC not ready - preload might not be loaded");
      currentSessionId = "fallback-session-" + Date.now();
      render();
      return;
    }

  await maybeMigrateLegacy();

  // ：URL ?sessionId= →  → 
  const urlSessionId = new URLSearchParams(window.location.search).get("sessionId");
  let sessionId: string | null = null;

  if (urlSessionId) {
    sessionId = urlSessionId;
  }
  if (!sessionId) {
    const list = await window.chatStore.list();
    if (list.length > 0) {
      sessionId = list[0].id;
    }
  }
  if (!sessionId) {
    sessionId = (await window.chatStore.create({ identityId: null })).id;
  }

  if (!await loadSessionTailIntoUI(sessionId)) {
    const session = await window.chatStore.create({ identityId: null });
    sessionTailStart = 0;
    loadSessionIntoUI(session);
  }
  } catch (err) {
    console.error("[Cyrene Chat] Bootstrap failed, recovering fallback session:", err);
    if (!currentSessionId) {
      currentSessionId = "fallback-session-" + Date.now();
    }
    render();
  }
}

function formatTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**  Task Plan （Read-only，）。 */
interface PlanStepSnapshot {
  stepId: string;
  objective: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "superseded";
  failureMessage?: string;
}
interface PlanSnapshot {
  planId: string;
  goal: string;
  planStatus: string;
  steps: PlanStepSnapshot[];
  replanCount: number;
  timestamp: number;
}
const PLAN_CARD_KEY = "cyrene_plan_card_position";
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
let planCardFadeTimer: number | null = null;

function clampPlanCardPosition(x: number, y: number, card: HTMLElement): { x: number; y: number } {
  const chatEl = document.querySelector(".chat") as HTMLElement;
  if (!chatEl) return { x, y };
  const bounds = chatEl.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const maxX = bounds.width - cardRect.width;
  const maxY = bounds.height - cardRect.height;
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

function renderPlanCard(snapshot: PlanSnapshot): void {
  const chatEl = document.querySelector(".chat") as HTMLElement;
  if (!chatEl) return;

  let card = document.querySelector(".plan-card") as HTMLElement | null;

  // 
  if (!card) {
    card = document.createElement("div");
    card.className = "plan-card";
    chatEl.appendChild(card);

    // 
    let savedPos: { x: number; y: number } | null = null;
    try { savedPos = JSON.parse(localStorage.getItem(PLAN_CARD_KEY) || "null"); } catch { /* ignore */ }
    const defaultX = chatEl.clientWidth - 340;
    const pos = clampPlanCardPosition(savedPos?.x ?? defaultX, savedPos?.y ?? 60, card);
    card.style.left = pos.x + "px";
    card.style.top = pos.y + "px";

    // 
    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    card.addEventListener("mousedown", (e) => {
      const header = (e.target as HTMLElement).closest(".plan-card__header");
      if (!header) return;
      dragging = true;
      const rect = card!.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging || !card) return;
      const chatBounds = chatEl.getBoundingClientRect();
      const x = e.clientX - chatBounds.left - dragOffsetX;
      const y = e.clientY - chatBounds.top - dragOffsetY;
      const clamped = clampPlanCardPosition(x, y, card);
      card.style.left = clamped.x + "px";
      card.style.top = clamped.y + "px";
    });
    document.addEventListener("mouseup", () => {
      if (!dragging || !card) return;
      dragging = false;
      try {
        localStorage.setItem(PLAN_CARD_KEY, JSON.stringify({
          x: parseInt(card.style.left) || 0,
          y: parseInt(card.style.top) || 0,
        }));
      } catch { /* ignore */ }
    });

    // 
    card.addEventListener("mouseenter", () => {
      if (planCardFadeTimer) { clearTimeout(planCardFadeTimer); planCardFadeTimer = null; }
      card!.classList.remove("plan-card--fading");
    });
    card.addEventListener("mouseleave", () => {
      startPlanCardFadeIfTerminal(card!);
    });

    //  resize 
    window.addEventListener("resize", () => {
      if (!card || card.classList.contains("plan-card--fading")) return;
      const clamped = clampPlanCardPosition(
        parseInt(card.style.left) || 0,
        parseInt(card.style.top) || 0,
        card,
      );
      card.style.left = clamped.x + "px";
      card.style.top = clamped.y + "px";
    });
  }

  // 
  card.classList.remove("plan-card--fading");

  const statusLabels: Record<string, string> = {
    running: "Executing", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
    awaiting_user: "Waiting for User", paused: "Paused",
  };
  const statusLabel = statusLabels[snapshot.planStatus] ?? snapshot.planStatus;
  const badgeClass = snapshot.planStatus === "running" ? "running"
    : snapshot.planStatus === "completed" ? "completed"
    : snapshot.planStatus === "failed" ? "failed"
    : snapshot.planStatus === "cancelled" ? "cancelled"
    : snapshot.planStatus === "awaiting_user" ? "awaiting_user"
    : "paused";

  const stepIcons: Record<string, string> = {
    pending: "⬜", running: "🔄", completed: "✅",
    failed: "❌", skipped: "⏭️", superseded: "──",
  };

  const stepsHtml = snapshot.steps.map((s) => {
    const icon = stepIcons[s.status] ?? "⬜";
    const failureHtml = s.failureMessage
      ? `<div class="plan-card__step-failure">${escapeHtml(s.failureMessage)}</div>`
      : "";
    return `<div class="plan-card__step plan-card__step--${s.status}">
      <span class="plan-card__step-icon">${icon}</span>
      <span class="plan-card__step-text">${escapeHtml(s.objective)}</span>
    </div>${failureHtml}`;
  }).join("");

  const footerHtml = snapshot.replanCount > 0
    ? `<div class="plan-card__footer">Re-planned ${snapshot.replanCount} times</div>`
    : "";

  card.innerHTML = `
    <div class="plan-card__header">
      <span class="plan-card__icon"><svg width="14" height="14" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="8" y="8" width="32" height="36" rx="3" stroke="currentColor" stroke-width="4"/><path d="M16 8v-2a2 2 0 012-2h12a2 2 0 012 2v2" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M16 20h16M16 28h16M16 36h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg></span>
      <span class="plan-card__goal">${escapeHtml(snapshot.goal)}</span>
      <span class="plan-card__badge plan-card__badge--${badgeClass}">${statusLabel}</span>
    </div>
    <div class="plan-card__steps">${stepsHtml}</div>
    ${footerHtml}
  `;

  // 
  if (TERMINAL_STATUSES.includes(snapshot.planStatus)) {
    startPlanCardFadeIfTerminal(card);
  } else {
    if (planCardFadeTimer) { clearTimeout(planCardFadeTimer); planCardFadeTimer = null; }
  }
}

function startPlanCardFadeIfTerminal(card: HTMLElement): void {
  const snapshot = (card.querySelector(".plan-card__badge")?.textContent ?? "");
  if (!TERMINAL_STATUSES.some(s => {
    const labels: Record<string, string> = { completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
    return labels[s] === snapshot;
  })) return;
  if (planCardFadeTimer) clearTimeout(planCardFadeTimer);
  planCardFadeTimer = window.setTimeout(() => {
    card.classList.add("plan-card--fading");
    setTimeout(() => {
      if (card.classList.contains("plan-card--fading")) card.remove();
    }, 400);
  }, 5000);
}

/** 。todos 。
 *  /： header  toggle 。 */
function renderTodoPanel(state: TodoState | null): void {
  let panel = document.querySelector(".todo-panel") as HTMLElement | null;

  // ：
  if (!state || !state.todos || state.todos.length === 0) {
    if (panel) {
      panel.classList.add("empty");
      setTimeout(() => panel?.remove(), 300);
    }
    return;
  }

  // ：
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "todo-panel";
    document.body.appendChild(panel);
  }
  panel.classList.remove("empty");

  const total = state.todos.length;
  const done = state.todos.filter((t) => t.status === "completed").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style="width:0.75rem;height:0.75rem"><path fill-rule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clip-rule="evenodd"/></svg>`;

  const priorityBadge = (p: string): string => {
    if (p === "high") return `<span class="todo-badge todo-badge--high">High Priority</span>`;
    if (p === "medium") return `<span class="todo-badge todo-badge--medium">Medium Priority</span>`;
    if (p === "low") return `<span class="todo-badge todo-badge--low">Low Priority</span>`;
    return "";
  };

  const statusIcon = (s: string): string => {
    if (s === "completed") return checkIcon;
    if (s === "in_progress") return "●";
    return "";
  };

  // （）
  const wasCollapsed = panel.classList.contains("todo-panel--collapsed");

  panel.innerHTML = `
    <div class="todo-panel__header">
      <div>
        <div class="todo-panel__title">📋 Task progress</div>
        <div class="todo-panel__count">${done}/${total} completed</div>
      </div>
      <span class="todo-panel__toggle">${wasCollapsed ? "▸" : "▾"}</span>
    </div>
    <div class="todo-panel__body">
      <hr class="todo-panel__divider" />
      <div class="todo-panel__progress">
        <div class="todo-progress__track"><div class="todo-progress__fill" style="width:${pct}%"></div></div>
        <span class="todo-progress__label">${pct}%</span>
      </div>
      <div class="todo-list">
        ${state.todos.map(t => `
          <div class="todo-item ${t.status}">
            <span class="todo-item__icon">${statusIcon(t.status)}</span>
            <span class="todo-item__text">${escapeHtml(t.content)}</span>
            <span class="todo-item__meta">${priorityBadge(t.priority || "")}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  if (wasCollapsed) panel.classList.add("todo-panel--collapsed");

  // / toggle
  const togglePanel = () => {
    if (!panel) return;
    const collapsed = panel.classList.toggle("todo-panel--collapsed");
    const toggleBtn = panel.querySelector(".todo-panel__toggle");
    if (toggleBtn) toggleBtn.textContent = collapsed ? "▸" : "▾";
  };

  panel.querySelector(".todo-panel__header")?.addEventListener("click", togglePanel);
  panel.querySelector(".todo-panel__toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel();
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]!));
}

/** Select DOM （），Chat。 */
function buildChoiceCardEl(data: {
  id: string;
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
  default?: string;
}): HTMLElement {
  const card = document.createElement("div");
  card.className = "choice-card";
  card.dataset.choiceId = data.id;

  // Title
  const title = document.createElement("div");
  title.className = "choice-card__title";
  title.textContent = data.question;
  card.appendChild(title);

  // 
  const list = document.createElement("div");
  list.className = "choice-card__list";
  for (const opt of data.options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-card__option";
    btn.dataset.value = opt.value;

    const labelEl = document.createElement("span");
    labelEl.className = "choice-card__option-label";
    labelEl.textContent = opt.label;
    btn.appendChild(labelEl);

    if (opt.description) {
      const descEl = document.createElement("span");
      descEl.className = "choice-card__option-desc";
      descEl.textContent = opt.description;
      btn.appendChild(descEl);
    }

    btn.addEventListener("click", () => {
      // ，All
      card.classList.add("choice-card--resolved");
      card.querySelectorAll<HTMLButtonElement>(".choice-card__option").forEach(b => b.disabled = true);
      btn.classList.add("choice-card__option--selected");
      void window.choice?.resolve(data.id, opt.value);
    });
    list.appendChild(btn);
  }
  card.appendChild(list);

  // Custom
  const customWrap = document.createElement("div");
  customWrap.className = "choice-card__custom";
  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.className = "choice-card__custom-input";
  customInput.placeholder = "Or enter custom request...";
  customWrap.appendChild(customInput);

  const customBtn = document.createElement("button");
  customBtn.type = "button";
  customBtn.className = "choice-card__custom-btn";
  customBtn.textContent = "Confirm";
  customBtn.addEventListener("click", () => {
    const val = customInput.value.trim();
    if (!val) return;
    card.classList.add("choice-card--resolved");
    card.querySelectorAll<HTMLButtonElement>(".choice-card__option").forEach(b => b.disabled = true);
    customInput.disabled = true;
    customBtn.disabled = true;
    void window.choice?.resolve(data.id, val);
  });
  customInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); customBtn.click(); }
  });
  customWrap.appendChild(customBtn);
  card.appendChild(customWrap);

  return card;
}

function isAskClarificationCard(value: unknown): value is AskClarificationCard & { id: string } {
  return Boolean(
    value
    && typeof value === "object"
    && "id" in value
    && "intro" in value
    && "questions" in value
    && Array.isArray((value as { questions?: unknown }).questions),
  );
}

/** Ask Soul 。Select，。 */
function buildAskClarificationCardEl(
  data: AskClarificationCard & { id: string },
): HTMLElement {
  const card = document.createElement("div");
  card.className = "choice-card choice-card--structured";
  card.dataset.choiceId = data.id;

  const intro = document.createElement("div");
  intro.className = "choice-card__title";
  intro.textContent = data.intro;
  card.appendChild(intro);

  const questionStates = new Map<string, {
    question: AskQuestion;
    selected: Set<string>;
    customInput?: HTMLInputElement;
    section: HTMLElement;
  }>();

  for (const question of data.questions.slice(0, 3)) {
    const section = document.createElement("section");
    section.className = "choice-card__question";
    const prompt = document.createElement("div");
    prompt.className = "choice-card__question-title";
    prompt.textContent = question.question;
    section.appendChild(prompt);
    const selected = new Set<string>();
    const state: {
      question: AskQuestion;
      selected: Set<string>;
      customInput?: HTMLInputElement;
      section: HTMLElement;
    } = { question, selected, section };

    if (question.type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "choice-card__custom-input";
      input.placeholder = question.freeTextPlaceholder || "Please specify your requirements";
      state.customInput = input;
      section.appendChild(input);
    } else {
      const list = document.createElement("div");
      list.className = "choice-card__list";
      for (const option of question.options.slice(0, 4)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice-card__option";
        button.dataset.value = option.value;
        const label = document.createElement("span");
        label.className = "choice-card__option-label";
        label.textContent = option.label;
        button.appendChild(label);
        if (option.description) {
          const description = document.createElement("span");
          description.className = "choice-card__option-desc";
          description.textContent = option.description;
          button.appendChild(description);
        }
        button.addEventListener("click", () => {
          section.classList.remove("choice-card__question--invalid");
          if (question.type === "single_select") {
            selected.clear();
            list.querySelectorAll(".choice-card__option").forEach((item) => {
              item.classList.remove("choice-card__option--selected");
            });
          }
          if (question.type === "multi_select" && selected.has(option.value)) {
            selected.delete(option.value);
            button.classList.remove("choice-card__option--selected");
          } else {
            selected.add(option.value);
            button.classList.add("choice-card__option--selected");
          }
          if (option.value === "__custom__" && state.customInput) {
            state.customInput.hidden = false;
            state.customInput.focus();
          } else if (question.type === "single_select" && state.customInput) {
            state.customInput.hidden = true;
            state.customInput.value = "";
          }
        });
        list.appendChild(button);
      }
      section.appendChild(list);
      if (question.options.some((option) => option.value === "__custom__")) {
        const input = document.createElement("input");
        input.type = "text";
        input.hidden = true;
        input.className = "choice-card__custom-input choice-card__custom-input--standalone";
        input.placeholder = question.freeTextPlaceholder || "Enter other option";
        state.customInput = input;
        section.appendChild(input);
      }
    }
    questionStates.set(question.field, state);
    card.appendChild(section);
  }

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "choice-card__custom-btn choice-card__submit";
  submit.textContent = "Confirm and continue";
  submit.addEventListener("click", () => {
    const answers: AskUserAnswer["answers"] = [];
    let firstInvalid: HTMLElement | undefined;
    for (const [field, state] of questionStates) {
      state.section.classList.remove("choice-card__question--invalid");
      const customText = state.customInput?.value.trim();
      const selectedValues = [...state.selected].filter((value) => value !== "__custom__");
      const usesCustom = state.question.type === "text" || state.selected.has("__custom__");
      if ((usesCustom && !customText) || (!usesCustom && selectedValues.length === 0)) {
        state.section.classList.add("choice-card__question--invalid");
        firstInvalid ??= state.section;
        continue;
      }
      answers.push({
        field,
        ...(selectedValues.length ? { selectedValues } : {}),
        ...(usesCustom && customText ? { customText } : {}),
      });
    }
    if (firstInvalid) {
      firstInvalid.querySelector<HTMLElement>("input,button")?.focus();
      return;
    }
    card.classList.add("choice-card--resolved");
    card.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = true;
    });
    card.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
      input.disabled = true;
    });
    void window.choice?.resolve(data.id, {
      requestId: data.id,
      answers,
    } satisfies AskUserAnswer);
  });
  card.appendChild(submit);
  return card;
}

/** Approval DOM （per-action ）。 */
function buildApprovalCardEl(req: {
  id: string;
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  risk: string;
}): HTMLElement {
  const card = document.createElement("div");
  card.className = "approval-card";
  card.dataset.approvalId = req.id;

  // Title（ + ）
  const title = document.createElement("div");
  title.className = "approval-card__title";
  const toolSpan = document.createElement("span");
  toolSpan.className = "approval-card__tool";
  toolSpan.textContent = req.toolName || req.toolId;
  const riskBadge = document.createElement("span");
  riskBadge.className = `approval-card__risk approval-card__risk--${req.risk}`;
  riskBadge.textContent = req.risk;
  title.appendChild(toolSpan);
  title.appendChild(riskBadge);
  card.appendChild(title);

  // 
  if (req.toolDescription) {
    const desc = document.createElement("div");
    desc.className = "approval-card__desc";
    desc.textContent = req.toolDescription;
    card.appendChild(desc);
  }

  // （key: value，， 5 ）
  const argsEntries = Object.entries(req.args || {});
  if (argsEntries.length > 0) {
    const argsBlock = document.createElement("div");
    argsBlock.className = "approval-card__args";
    const visible = argsEntries.slice(0, 5);
    for (const [k, v] of visible) {
      const row = document.createElement("div");
      row.className = "approval-card__args-row";
      const keySpan = document.createElement("span");
      keySpan.className = "approval-card__args-key";
      keySpan.textContent = k + ":";
      const valSpan = document.createElement("span");
      valSpan.className = "approval-card__args-val";
      valSpan.textContent = JSON.stringify(v);
      row.appendChild(keySpan);
      row.appendChild(valSpan);
      argsBlock.appendChild(row);
    }
    if (argsEntries.length > 5) {
      const more = document.createElement("div");
      more.className = "approval-card__args-more";
      more.textContent = `...and ${argsEntries.length - 5} more parameters`;
      argsBlock.appendChild(more);
    }
    card.appendChild(argsBlock);
  }

  // 
  const actions = document.createElement("div");
  actions.className = "approval-card__actions";
  const denyBtn = document.createElement("button");
  denyBtn.type = "button";
  denyBtn.className = "approval-card__btn approval-card__btn--deny";
  denyBtn.textContent = "Deny";
  const allowBtn = document.createElement("button");
  allowBtn.type = "button";
  allowBtn.className = "approval-card__btn approval-card__btn--allow";
  allowBtn.textContent = "Allow";
  actions.appendChild(denyBtn);
  actions.appendChild(allowBtn);
  card.appendChild(actions);

  // Notice（60 ）
  const note = document.createElement("div");
  note.className = "approval-card__note";
  note.textContent = "Auto-denies in 60s if not acted on";
  card.appendChild(note);

  // （Refresh）
  let remaining = 60;
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      pendingPermissionRequests.delete(req.id);
      note.textContent = "Timed out, automatically denied";
      clearInterval(tick);
      return;
    }
    note.textContent = `Auto-denies in ${remaining}s`;
  }, 1000);

  const resolve = (allowed: boolean) => {
    pendingPermissionRequests.delete(req.id);
    clearInterval(tick);
    if (!card.isConnected) return;
    card.classList.add(allowed ? "approval-card--allowed" : "approval-card--denied");
    denyBtn.disabled = true;
    allowBtn.disabled = true;
    note.textContent = allowed ? "Allowed" : "Denied";
    void window.settings?.resolvePermissionApproval?.(req.id, allowed);
  };

  denyBtn.addEventListener("click", () => resolve(false));
  allowBtn.addEventListener("click", () => resolve(true));

  return card;
}

/** Map English and legacy Chinese weather descriptions to illustration classes. */
function weatherIllustrationClass(text: string): string {
  // Unicode escapes retain multilingual weather matching without leaking localized UI copy.
  if (/thunder|\u96f7/i.test(text)) return "weather-thunder";
  if (/snow|\u96ea/i.test(text)) return "weather-snow";
  if (/rain|drizzle|shower|\u96e8/i.test(text)) return "weather-rain";
  if (/clear|sunny|\u6674/i.test(text)) return "weather-clear";
  return "weather-cloudy";
}

/** SVG （ HTML Full）。 */
const W_SVG = {
  humidity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6.5 7 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7z"/></svg>`,
  wind: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>`,
  windDir: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4.1A2 2 0 1 1 11 8H2M12.6 19.9A2 2 0 1 0 14 16H2M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/></svg>`,
  precip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.6A5 5 0 0 0 18 7a7 7 0 1 0-13.9 1.6A4.5 4.5 0 0 0 5.5 17H17"/><path d="M8 19v2M12 18v2M16 19v2"/></svg>`,
  pressure: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15l3.5-3.5"/><path d="M20.2 15.5a8.5 8.5 0 1 0-16.4 0"/></svg>`,
  feels: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 1 0-4 0v9.3a4.5 4.5 0 1 0 4 0z"/></svg>`,
};

/**  DOM （，）。 weather-cards.html。 */
function buildWeatherCardEl(data: Record<string, unknown>): HTMLElement {
  const card = document.createElement("div");
  card.className = "weather-card";

  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(now);
  const timeStr = formatTime(Date.now());

  const temp = Number(data.temp ?? 0);
  const feelsLike = data.feelsLike != null ? Number(data.feelsLike) : null;
  const humidity = Number(data.humidity ?? 0);
  const precip = data.precip != null ? Number(data.precip) : null;
  const pressure = data.pressure != null ? Number(data.pressure) : null;
  const windDir = escapeHtml(String(data.windDir ?? ""));
  const windScale = escapeHtml(String(data.windScale ?? ""));
  const visibility = data.visibility != null ? Number(data.visibility) : null;
  const uv = data.uv != null ? Number(data.uv) : null;
  const aqi = data.aqi != null ? Number(data.aqi) : null;
  const aqiText = data.aqiText ? escapeHtml(String(data.aqiText)) : "";
  const kaomoji = aqi != null ? escapeHtml(aqiKaomojiText(aqi)) : "";
  const city = escapeHtml(String(data.city ?? ""));
  const adm = escapeHtml(String(data.adm ?? ""));
  const desc = escapeHtml(String(data.text ?? ""));
  const source = escapeHtml(String(data.source ?? ""));
  const illClass = weatherIllustrationClass(desc);
  const forecast = Array.isArray(data.forecast) ? data.forecast as Array<Record<string, unknown>> : [];

  // ：/ → 4， → 3
  const hasPrecipOrPressure = precip != null || pressure != null;
  // ：
  const advItems: string[] = [];
  if (pressure != null && pressure > 0) {
    advItems.push(`<div class="adv-item"><div class="adv-icon">${W_SVG.pressure}</div><div class="adv-text"><span class="adv-label">Pressure</span><span class="adv-value">${Math.round(pressure)} hPa</span></div></div>`);
  }
  if (feelsLike != null) {
    advItems.push(`<div class="adv-item"><div class="adv-icon">${W_SVG.feels}</div><div class="adv-text"><span class="adv-label">Feels Like</span><span class="adv-value">${feelsLike}°C</span></div></div>`);
  }
  if (uv != null) {
    advItems.push(`<div class="adv-item"><div class="adv-icon">${W_SVG.humidity}</div><div class="adv-text"><span class="adv-label">UV Index</span><span class="adv-value">${uv}</span></div></div>`);
  }
  if (visibility != null) {
    advItems.push(`<div class="adv-item"><div class="adv-icon">${W_SVG.humidity}</div><div class="adv-text"><span class="adv-label">Visibility</span><span class="adv-value">${visibility} km</span></div></div>`);
  }
  if (aqi != null) {
    advItems.push(`<div class="adv-item"><div class="adv-icon">${W_SVG.humidity}</div><div class="adv-text"><span class="adv-label">Air Quality</span><span class="adv-value">${aqi} ${aqiText} ${kaomoji}</span></div></div>`);
  }
  const hasAdv = advItems.length > 0;

  // 
  const hasForecast = forecast.length > 0;
  const forecastRows = forecast.map((d) => {
    const hi = Number(d.hi ?? 0);
    const lo = Number(d.lo ?? 0);
    const textDay = escapeHtml(String(d.textDay ?? ""));
    const weekDay = escapeHtml(String(d.weekDay ?? ""));
    const dateLabel = escapeHtml(String(d.date ?? ""));
    const fcIllClass = weatherIllustrationClass(textDay);
    // ： emoji ，
    const fcIcon = textDay.includes("Thunder") ? "⛈️" : textDay.includes("Snow") ? "❄️" : textDay.includes("Rain") ? "🌧️" : textDay.includes("Clear") ? "☀️" : "⛅";
    return `<div class="forecast-row">
      <span class="forecast-date">${dateLabel} ${weekDay}</span>
      <span class="forecast-icon">${fcIcon}</span>
      <span class="forecast-text">${textDay}</span>
      <span class="forecast-lo">${lo}°</span>
      <span class="forecast-bar"><span class="forecast-bar-fill" style="width:${Math.min(100, Math.max(10, (lo + 20) * 1.5))}%"></span></span>
      <span class="forecast-hi">${hi}°</span>
    </div>`;
  }).join("");

  card.innerHTML = `
    <header class="card-header">
      <div class="date-block">
        <span class="date-text">${dateStr}</span>
        <span class="update-text"><span class="update-dot"></span><span>Updated ${timeStr}</span></span>
      </div>
      <div class="location">
        <div class="location-row">
          <span class="province">${adm}</span>
          <span class="city">${city}</span>
        </div>
        <span class="source-tag">${source}</span>
      </div>
    </header>

    <section class="current-weather">
      <div class="illustration ${illClass}">
        <div class="sun">
          <div class="sun-rays">
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </div>
          <div class="sun-core"></div>
        </div>
        <div class="cloud"></div>
        <div class="rain"><span></span><span></span><span></span></div>
        <div class="snow"><span>❄</span><span>❄</span><span>❄</span></div>
        <div class="bolt"></div>
      </div>
      <div class="current-info">
        <div class="temp-row">
          <span class="temp-value">${temp}</span>
          <span class="temp-unit">°C</span>
        </div>
        <div class="weather-desc">${desc}</div>
        ${feelsLike != null ? `<span class="feels-like">Feels like ${feelsLike}°C</span>` : ""}
      </div>
    </section>

    <section class="details-grid${hasPrecipOrPressure ? "" : " three"}">
      <div class="detail-item">
        <div class="detail-icon">${W_SVG.humidity}</div>
        <div class="detail-text">
          <span class="detail-label">Humidity</span>
          <span class="detail-value">${humidity}%</span>
        </div>
      </div>
      <div class="detail-item">
        <div class="detail-icon">${W_SVG.windDir}</div>
        <div class="detail-text">
          <span class="detail-label">Wind Dir</span>
          <span class="detail-value">${windDir}</span>
        </div>
      </div>
      ${hasPrecipOrPressure ? `
      <div class="detail-item">
        <div class="detail-icon">${W_SVG.wind}</div>
        <div class="detail-text">
          <span class="detail-label">Wind Speed</span>
          <span class="detail-value">${windScale}</span>
        </div>
      </div>
      <div class="detail-item">
        <div class="detail-icon">${W_SVG.precip}</div>
        <div class="detail-text">
          <span class="detail-label">Precipitation</span>
          <span class="detail-value">${precip != null ? precip.toFixed(1) : "0"} mm</span>
        </div>
      </div>
      ` : `
      <div class="detail-item">
        <div class="detail-icon">${W_SVG.wind}</div>
        <div class="detail-text">
          <span class="detail-label">Wind Scale</span>
          <span class="detail-value">${windScale}</span>
        </div>
      </div>
      `}
    </section>

    ${hasAdv ? `
    <button class="advanced-toggle" type="button" aria-expanded="false">
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>
      <span class="toggle-label">Advanced Details</span>
    </button>
    <div class="advanced-panel">
      <div class="advanced-panel-inner">
        <div class="advanced-content">
          ${advItems.join("\n")}
        </div>
      </div>
    </div>
    ` : ""}

    ${hasForecast ? `
    <button class="forecast-toggle" type="button" aria-expanded="false">
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>
      <span class="fc-toggle-label">Forecast</span>
    </button>
    <div class="forecast-panel">
      <div class="forecast-panel-inner">
        <div class="forecast-content">
          ${forecastRows}
        </div>
      </div>
    </div>
    ` : ""}

    <footer class="card-footer">${source} · Updated ${timeStr}</footer>
  `;

  // 
  const bindToggle = (selector: string, openClass: string, labelSelector: string, openText: string, closeText: string) => {
    const btn = card.querySelector(selector) as HTMLButtonElement | null;
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = card.classList.toggle(openClass);
        btn.setAttribute("aria-expanded", String(open));
        const label = card.querySelector(labelSelector);
        if (label) label.textContent = open ? closeText : openText;
      });
    }
  };
  bindToggle(".advanced-toggle", "advanced-open", ".toggle-label", "Advanced Details", "Collapse Details");
  bindToggle(".forecast-toggle", "forecast-open", ".fc-toggle-label", "Forecast", "Collapse Forecast");

  return card;
}

function buildMusicCardEl(data: MusicCardData): HTMLElement {
  const card = document.createElement("div");
  card.className = "music-agui-card";

  const header = document.createElement("div");
  header.className = "music-agui-card__header";
  const title = document.createElement("strong");
  title.textContent = data.source === "daily_recommendation" ? "Daily Recommendation" : "Track Candidates";
  const badge = document.createElement("span");
  badge.textContent = "NetEase Cloud Music";
  header.append(title, badge);
  card.appendChild(header);

  data.tracks.forEach((track, index) => {
    const row = document.createElement("div");
    row.className = "music-agui-card__track";

    const order = document.createElement("span");
    order.className = "music-agui-card__order";
    order.textContent = String(index + 1);
    const meta = document.createElement("div");
    meta.className = "music-agui-card__meta";
    const name = document.createElement("strong");
    name.textContent = track.name;
    const detail = document.createElement("span");
    detail.textContent = [track.artists.join(" / "), track.album].filter(Boolean).join(" · ");
    meta.append(name, detail);

    const play = document.createElement("button");
    play.type = "button";
    play.className = "music-agui-card__play";
    play.textContent = "Play";
    play.setAttribute("aria-label", `Play ${track.name}`);
    play.addEventListener("click", async () => {
      if (!window.music) return;
      play.disabled = true;
      const original = play.textContent;
      try {
        const feedback = await requestTrackPlayback(window.music, track);
        play.textContent = feedback.kind === "ok" ? "Sent" : "Unavailable";
        play.title = feedback.message;
      } catch (err) {
        play.textContent = "Failed";
        play.title = err instanceof Error ? err.message : String(err);
      } finally {
        window.setTimeout(() => {
          play.disabled = false;
          play.textContent = original;
        }, 1800);
      }
    });

    row.append(order, meta, play);
    card.appendChild(row);
  });
  return card;
}

/** AQI → 。 */
function aqiKaomojiText(aqi: number): string {
  if (aqi <= 50) return "(◕‿◕)";
  if (aqi <= 100) return "(´ー`)";
  if (aqi <= 150) return "(´-ω-`)";
  if (aqi <= 200) return "(；´д`)";
  return "(╥﹏╥)";
}

/**
 * Fill the avatar slot for a given role.
 * - model role: insert an <img> with the configured PNG (auto-cropped to
 *   a circle by the .msg__avatar-img CSS rule).
 * - user role (empty src): leave the slot empty so the CSS gradient
 *   placeholder shows through.
 */
function setAvatar(slot: HTMLElement, role: Role): void {
  slot.replaceChildren();
  const src = AVATAR_SRC[role];
  if (!src) return;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  img.className = "msg__avatar-img";
  slot.appendChild(img);
}

function createMessageBubble(text?: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "msg__bubble";
  item.hidden = false;
  if (text) item.textContent = text;
  return item;
}

function getLastBubbleForMessage(messageId: string): HTMLElement | null {
  const row = messagesEl.querySelector(`[data-msg-id="${messageId}"]`);
  if (!row) return null;
  const bubbles = row.querySelectorAll<HTMLElement>(".msg__bubble");
  return bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;
}

function appendBubbleForMessage(messageId: string): HTMLElement | null {
  const row = messagesEl.querySelector(`[data-msg-id="${messageId}"]`);
  const body = row?.querySelector(".msg__body");
  if (!body) return null;
  const bubble = createMessageBubble();
  bubble.hidden = true;
  body.appendChild(bubble);
  return bubble;
}

/**
 * ： Markdown HTML，Global render()。
 * - （ → replaceChildren）
 * - ：
 * -  has-rich-content（//）
 */
function finalizeStreamingBubble(messageId: string, rawContent: string): void {
  const bubble = getLastBubbleForMessage(messageId);
  if (!bubble) return;

  //  Markdown 
  const result = renderMarkdown(rawContent);

  // 
  const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

  if (result.mode === "html") {
    bubble.removeAttribute("data-md-mode");
    bubble.classList.remove("is-streaming");
    // ： DOM → replaceChildren
    const tpl = document.createElement("template");
    tpl.innerHTML = result.content;
    bubble.replaceChildren(tpl.content.cloneNode(true));
    // // → 
    const hasRich = bubble.querySelector(".katex-display, .code-block, table");
    if (hasRich) bubble.classList.add("has-rich-content");
  } else {
    bubble.setAttribute("data-md-mode", "text");
    bubble.textContent = result.content;
  }
  bubble.hidden = false;

  // ：
  if (wasAtBottom) {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
}

function renderMessageAttachments(body: HTMLElement, attachments: MessageAttachment[] | undefined): void {
  if (!attachments || attachments.length === 0) return;
  const list = document.createElement("div");
  list.className = "msg__attachments";
  for (const att of attachments) {
    if (att.kind === "image") {
      const card = document.createElement("div");
      card.className = "msg__image-card";
      const preview = document.createElement("div");
      preview.className = "msg__image-preview";
      if (att.previewUrl) {
        const img = document.createElement("img");
        img.src = att.previewUrl;
        img.alt = att.name;
        img.draggable = false;
        img.addEventListener("load", () => {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
        img.addEventListener("error", () => {
          preview.classList.add("is-error");
          preview.textContent = "Image preview unavailable";
        });
        preview.appendChild(img);
      } else {
        preview.classList.add("is-error");
        preview.textContent = "Image preview unavailable";
      }
      const name = document.createElement("div");
      name.className = "msg__image-name";
      name.textContent = att.name;
      card.appendChild(preview);
      card.appendChild(name);
      list.appendChild(card);
    } else if (att.kind === "document") {
      const card = document.createElement("div");
      card.className = `msg__document-card msg__document-card--${att.status}`;
      const icon = document.createElement("div");
      icon.className = "msg__document-icon";
      icon.textContent = "📄";
      const meta = document.createElement("div");
      meta.className = "msg__document-meta";
      const name = document.createElement("div");
      name.className = "msg__document-name";
      name.textContent = att.name;
      const status = document.createElement("div");
      status.className = "msg__document-status";
      status.textContent = att.status === "done"
        ? (att.processedKind === "indexed" ? `Indexed ${att.chunks ?? 0} chunks` : "Processed")
        : getDocumentIndexStatusLabel(att.status);
      meta.appendChild(name);
      meta.appendChild(status);
      card.appendChild(icon);
      card.appendChild(meta);
      if (canCancelDocumentIndexStatus(att.status) && att.jobId) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "msg__document-cancel";
        cancel.textContent = "×";
        cancel.title = "Cancel processing";
        cancel.setAttribute("aria-label", "Cancel processing");
        cancel.addEventListener("click", () => {
          void window.chat?.cancelDocumentIndex(att.jobId!);
        });
        card.appendChild(cancel);
      }
      list.appendChild(card);
    } else {
      continue;
    }
  }
  if (list.childElementCount > 0) body.appendChild(list);
}

function updateDocumentAttachmentProgress(progress: DocumentIndexProgress): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const attachment = messages[index].attachments?.find((item): item is DocumentMessageAttachment =>
      item.kind === "document"
      && item.filePath === progress.filePath
      && (!item.jobId || item.jobId === progress.jobId)
    );
    if (!attachment) continue;
    attachment.jobId = progress.jobId;
    attachment.status = progress.status;
    attachment.reason = progress.reason;
    if (typeof progress.totalChunks === "number") attachment.chunks = progress.totalChunks;
    return;
  }
}

window.chat?.onDocumentIndexProgress?.((progress) => {
  updateDocumentAttachmentProgress(progress);
  render();
});

let transientStatusEl: HTMLElement | null = null;

function showTransientStatus(text: string): void {
  if (!transientStatusEl) {
    transientStatusEl = document.createElement("div");
    transientStatusEl.className = "chat-transient-status";
    const dots = document.createElement("span");
    dots.className = "chat-transient-status__dots";
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement("span");
      dot.className = "thinking-dot";
      dots.appendChild(dot);
    }
    const label = document.createElement("span");
    label.className = "chat-transient-status__text";
    transientStatusEl.appendChild(dots);
    transientStatusEl.appendChild(label);
    messagesEl.appendChild(transientStatusEl);
  }
  const label = transientStatusEl.querySelector(".chat-transient-status__text");
  if (label) label.textContent = text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTransientStatus(): void {
  transientStatusEl?.remove();
  transientStatusEl = null;
}

function render(preserveScroll = false): void {
  // ：（/）"CyreneChat ✨"placeholder
  // thinking （Cyrene/），
  const emptyEl = document.getElementById("chat-empty");
  const hasMessages = messages.some((m) =>
    m.content.trim()
    || m.thinking
    || ((m.attachments?.length ?? 0) > 0)
    || Boolean(m.sticker)
    || Boolean(m.musicCard)
  );
  if (emptyEl) emptyEl.toggleAttribute("hidden", hasMessages);

  messagesEl.replaceChildren();
  if (sessionTailStart > 0) {
    const loadEarlier = document.createElement("button");
    loadEarlier.type = "button";
    loadEarlier.className = "chat__load-earlier";
    loadEarlier.textContent = "Load earlier messages";
    loadEarlier.addEventListener("click", () => void loadEarlierMessages());
    messagesEl.appendChild(loadEarlier);
  }
  for (const req of pendingPermissionRequests.values()) {
    const card = buildApprovalCardEl(req);
    messagesEl.appendChild(card);
  }
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = `msg msg--${m.role}`;
    row.dataset.msgId = m.id;

    const avatar = document.createElement("div");
    avatar.className = "msg__avatar";
    avatar.setAttribute("aria-hidden", "true");
    setAvatar(avatar, m.role);

    const body = document.createElement("div");
    body.className = "msg__body";

    const bubbles: HTMLElement[] = [];
    const bubble = createMessageBubble();
    if (m.thinking) {
      bubble.classList.add("msg__bubble--thinking");
      const dot1 = document.createElement("span");
      dot1.className = "thinking-dot";
      const dot2 = document.createElement("span");
      dot2.className = "thinking-dot";
      const dot3 = document.createElement("span");
      dot3.className = "thinking-dot";
      bubble.appendChild(dot1);
      bubble.appendChild(dot2);
      bubble.appendChild(dot3);
      bubbles.push(bubble);
    } else if (m.role === "user") {
      // ： [sticker:xxx] 
      const cleanText = m.content.replace(/\[sticker:[^\]]+\]/g, "").trim();
      if (cleanText) bubble.textContent = cleanText;
      else bubble.hidden = true; // Sticker-only messages hide bubbles
      if (!bubble.hidden) bubbles.push(bubble);
    } else {
      const currentMode = isChatMode() ? "chat" : "work";
      const segments = getAssistantReplyBubbleTexts(m.content, currentMode, segmentedOutputMode, {
        preserveEmpty: !!m.transient,
      });
      for (const segment of segments) {
        const text = segment.trim();
        if (text || m.transient) {
          const bubble = createMessageBubble();
          if (m.transient) {
            // ：， StreamingMarkdownSession  DOM
            bubble.textContent = text;
          } else {
            // ：placeholder， pending，History Markdown
            bubble.textContent = text;
            bubble.dataset.mdPending = "true";
          }
          bubbleRawText.set(bubble, text);
          bubbles.push(bubble);
        }
      }
    }

    const time = document.createElement("div");
    time.className = "msg__time";
    time.textContent = formatTime(m.at);

    for (const item of bubbles) body.appendChild(item);
    if (m.role === "user") renderMessageAttachments(body, m.attachments);

    if (m.sticker) {
      const stickerSrc = getStickerSrc(m.sticker);
      if (stickerSrc) {
        const sticker = document.createElement("img");
        sticker.className = "msg__sticker";
        sticker.src = stickerSrc;
        sticker.alt = m.role === "user" ? "User sticker" : "Cyrene sticker";
        sticker.draggable = false;
        // <img> ，render() Image，
        //  sticker 。Completed。
        sticker.addEventListener("load", () => {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
        body.appendChild(sticker);
      }
    }

    if (m.musicCard) body.appendChild(buildMusicCardEl(m.musicCard));

    // actions ： /  / 。
    //  transient ； actions，
    // 。
    const actions = document.createElement("div");
    actions.className = "msg__actions";

    let hasActionItem = false;

    // model  SVG （thinking ）
    if (!m.transient && m.role === "model" && !m.thinking && m.content.trim()) {
      const speakBtn = document.createElement("button");
      speakBtn.type = "button";
      speakBtn.className = "msg__speak";
      speakBtn.title = "Read aloud";
      speakBtn.setAttribute("aria-label", "Read this message aloud");
      //  SVG  emoji，，
      speakBtn.innerHTML = SPEAK_ICON_IDLE;
      // ：，（）
      speakBtn.addEventListener("click", () => {
        console.log("[TTS] Speaker clicked, currentTtsAudio=", currentTtsAudio ? "yes" : "no");
        if (currentSpeakingMsgId === m.id) {
          //  →  UI
          stopCurrentTts();
          setSpeakingMsgId(null);
        } else {
          void speakMessage(m);
        }
      });
      actions.appendChild(speakBtn);
      hasActionItem = true;
    }

    // ：user / model ，thinking /  / 
    //   user  [sticker:xxx] ，model  content
    if (!m.transient && !m.thinking && m.content.trim()) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "msg__copy";
      copyBtn.title = "Copy";
      copyBtn.setAttribute("aria-label", "Copy this message");
      copyBtn.innerHTML = COPY_ICON_IDLE;
      copyBtn.addEventListener("click", () => {
        const text = m.role === "user"
          ? m.content.replace(/\[sticker:[^\]]+\]/g, "").trim()
          : m.content;
        if (!text) return;
        void copyTextToClipboard(text).then((ok) => {
          if (!ok) return;
          // ： + "Copied"，1.5s 
          copyBtn.classList.add("is-copied");
          copyBtn.innerHTML = COPY_ICON_DONE;
          const label = document.createElement("span");
          label.className = "msg__copy-label";
          label.textContent = "Copied";
          copyBtn.appendChild(label);
          window.setTimeout(() => {
            copyBtn.classList.remove("is-copied");
            copyBtn.innerHTML = COPY_ICON_IDLE;
          }, 1500);
        });
      });
      actions.appendChild(copyBtn);
      hasActionItem = true;
    }

    // ；， actions 。
    //  transient ， render 。
    if (!m.transient) {
      actions.appendChild(time);
      hasActionItem = true;
    }

    if (hasActionItem) body.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(body);
    messagesEl.appendChild(row);
  }

  if (!preserveScroll) messagesEl.scrollTop = messagesEl.scrollHeight;

  // History：placeholder -> Markdown HTML
  scheduleHistoryRender();
}

let schedulerEventsOff: (() => void) | null = null;
const activeAguiOffs = new Set<() => void>();

function registerAguiListener(callback: (event: unknown) => void): () => void {
  const off = window.agui!.onEvent(callback);
  const release = () => {
    if (!activeAguiOffs.delete(release)) return;
    off();
  };
  activeAguiOffs.add(release);
  return release;
}

function installSchedulerEventListener(): void {
  if (!window.schedulerEvents?.onEvent) return;

  interface SchedulerStreamState {
    msgId: string;
    content: string;
    toolLines: string[];
  }

  const streams = new Map<string, SchedulerStreamState>();

  const runKeyOf = (event: AguiBaseEvent): string => {
    if (event.schedulerRunId) return event.schedulerRunId;
    if (event.runId) return event.runId;
    if (event.threadId) return event.threadId;
    return "scheduler-default";
  };

  const renderState = (state: SchedulerStreamState): void => {
    const msg = messages.find(m => m.id === state.msgId);
    if (!msg) return;
    msg.thinking = false;
    msg.content = state.content || state.toolLines.join("\n") || "Scheduled task running…";
    render();
  };

  schedulerEventsOff?.();
  schedulerEventsOff = window.schedulerEvents.onEvent((rawEvent) => {
    const event = rawEvent as AguiBaseEvent;
    if (event.type === "CUSTOM" && event.name === "scheduler.started") {
      const value = event.value as { taskId?: string; title?: string; firedAt?: string; runId?: string } | undefined;
      const runKey = event.schedulerRunId ?? value?.runId ?? `scheduler-${Date.now()}`;
      messages.push({
        id: `scheduler-system-${runKey}`,
        role: "model",
        content: `⏰ Scheduled task "${value?.title ?? "Untitled task"}" triggered`,
        at: Date.now(),
      });
      const msgId = `scheduler-model-${runKey}`;
      streams.set(runKey, { msgId, content: "", toolLines: [] });
      messages.push({ id: msgId, role: "model", content: "", at: Date.now(), thinking: true });
      render();
      void saveSession();
      return;
    }

    const runKey = runKeyOf(event);
    const state = streams.get(runKey);
    if (!state) return;
    const msg = messages.find(m => m.id === state.msgId);
    if (!msg) return;

    if (event.type === "TOOL_CALL_START") {
      state.toolLines.push(`🔧 Calling: ${event.toolCallName ?? "tool"}`);
      renderState(state);
    } else if (event.type === "TOOL_CALL_RESULT") {
      const preview = (event.content ?? "").slice(0, 240);
      state.toolLines.push(`✅ Tool result: ${preview || "Completed"}`);
      renderState(state);
    } else if (event.type === "TOOL_CALL_END") {
      state.toolLines.push("✅ Tool execution completed");
      renderState(state);
    } else if (event.type === "TEXT_MESSAGE_START") {
      msg.thinking = false;
      state.content = "";
      renderState(state);
    } else if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
      state.content += event.delta;
      renderState(state);
    } else if (event.type === "RUN_FINISHED") {
      renderState(state);
      void saveSession();
      streams.delete(runKey);
    } else if (event.type === "RUN_ERROR") {
      msg.thinking = false;
      //  upstream  `message` ， `error`/`content`
      const rawMessage = event.message ?? event.error ?? event.content ?? "Unknown error";
      msg.content = "Scheduled task execution failed: " + classifyAgentError(event.code, rawMessage);
      render();
      void saveSession();
      streams.delete(runKey);
    }
  });
}

// ── TTS  ──
//  TTS ，。
// （Completed） 🔊 。

const TEXT_MODE_MOUTH_DURATION_MS = 8000;
const AUDIO_MOUTH_DELAY_MS = 800;

interface TtsSettings {
  ttsEngine: string;
  ttsAutoRead: boolean;
  ttsSpeed: number;
  ttsVolume: number;
  // MiniMax
  ttsMinimaxKey: string;
  ttsMinimaxVoiceId: string;
  ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
  // GPT-SoVITS
  ttsGptsovitsBaseUrl: string;
  ttsGptsovitsRefAudioPath: string;
  ttsGptsovitsPromptText: string;
  ttsGptsovitsFormat: "wav" | "mp3";
  // Custom Cloud
  ttsCustomCloudEndpointUrl: string;
  ttsCustomCloudApiKey: string;
  ttsCustomCloudVoiceId: string;
  ttsCustomCloudFormat: "wav" | "mp3";
  ttsCustomCloudTimeoutMs: number;
  // Xiaomi MiMo
  ttsMimoKey: string;
  ttsMimoVoiceAudioPath: string;
  ttsMimoStylePrompt: string;
  // Mossland（api.mosi.cn）
  ttsMosslandKey: string;
  ttsMosslandVoiceId: string;
  ttsMosslandModel: string;
  // MiniMax Streaming Playback
  ttsStreaming: boolean;
}

interface TtsApi {
  synthesize: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string; format?: "mp3" | "wav" | "pcm";
  }) => Promise<string>;
  synthesizeCached: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean }>;
  // GPT-SoVITS（ base64 + cacheKey + cached + format）
  synthesizeCachedGptsovits: (payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  // Custom Cloud（ base64 + cacheKey + cached + format）
  synthesizeCachedCustomCloud: (payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" | "mp3" }>;
  // Xiaomi MiMo（ base64 + cacheKey + cached + format）
  synthesizeCachedMimo: (payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
    expectedCacheKey?: string;
  }) => Promise<{ base64: string; cacheKey: string; cached: boolean; format: "wav" }>;
  // （minimax， chunk ）
  streamStart: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => Promise<{ started: boolean; cacheKey: string; cached: boolean }>;
  onAudioChunk: (callback: (payload: { base64: string }) => void) => () => void;
  onStreamEnd: (callback: (payload: { cacheKey: string; cached: boolean; format: "mp3" | "wav" | "pcm" }) => void) => () => void;
  onStreamError: (callback: (payload: { message: string }) => void) => () => void;
  loadSettings: () => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    tts?: TtsApi;
    live2dSpeech?: {
      prepare: () => void;
      startMouth: (durationMs: number) => void;
      stopMouth: () => void;
    };
  }
}

//  TTS （Global）。，。
let currentTtsAudio: HTMLAudioElement | null = null;
let currentTtsObjectUrl: string | null = null;
//  ID， row  .is-speaking class 。
// null 。
let currentSpeakingMsgId: string | null = null;
let speechToken = 0;
let textMouthStarted = false;
let ttsPlaybackSequence = 0;

/** ， Clipboard API，Failed textarea+execCommand。 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // None clipboard ，
  }
  // Fallback： textarea + execCommand('copy')。/None。
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function nextSpeechToken(): number {
  speechToken += 1;
  return speechToken;
}

/**  SVG，All。 */
function syncSpeakingUi(): void {
  const prevId = currentSpeakingMsgId;
  document.querySelectorAll(".msg.is-speaking").forEach((el) => {
    if (prevId === null || (el as HTMLElement).dataset.msgId !== prevId) {
      el.classList.remove("is-speaking");
      const btn = el.querySelector(".msg__speak");
      if (btn) btn.innerHTML = SPEAK_ICON_IDLE;
    }
  });
  if (prevId === null) return;
  const row = document.querySelector(`.msg[data-msg-id="${CSS.escape(prevId)}"]`);
  if (!row) return;
  row.classList.add("is-speaking");
  const btn = row.querySelector(".msg__speak");
  if (btn) btn.innerHTML = SPEAK_ICON_ACTIVE;
}

/** ：、，Refresh UI。 */
function setSpeakingMsgId(id: string | null): void {
  currentSpeakingMsgId = id;
  syncSpeakingUi();
}

function stopLive2dMouth(): void {
  speechToken += 1;
  textMouthStarted = false;
  window.live2dSpeech?.stopMouth();
}

function startTextModeMouth(): void {
  if (textMouthStarted) return;
  textMouthStarted = true;
  window.live2dSpeech?.startMouth(TEXT_MODE_MOUTH_DURATION_MS);
}

/**  TTS （）。 audio，UI 。 */
function stopCurrentTts(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  if (currentTtsAudio) {
    releaseCurrentTtsAudio(currentTtsAudio);
  }
  stopLive2dMouth();
}

function releaseCurrentTtsAudio(audio: HTMLAudioElement): void {
  if (currentTtsAudio !== audio) return;
  currentTtsAudio = null;
  const url = currentTtsObjectUrl;
  currentTtsObjectUrl = null;
  audio.pause();
  audio.currentTime = 0;
  audio.removeAttribute("src");
  audio.load();
  if (url) URL.revokeObjectURL(url);
}

async function loadTtsSettings(): Promise<TtsSettings | null> {
  if (!window.tts) return null;
  try {
    const raw = await window.tts.loadSettings();
    return {
      ttsEngine: String(raw.ttsEngine ?? "off"),
      ttsAutoRead: Boolean(raw.ttsAutoRead),
      ttsSpeed: Number(raw.ttsSpeed ?? 1),
      ttsVolume: Number(raw.ttsVolume ?? 1),
      ttsMinimaxKey: String(raw.ttsMinimaxKey ?? ""),
      ttsMinimaxVoiceId: String(raw.ttsMinimaxVoiceId ?? ""),
      ttsMinimaxModel: raw.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo",
      ttsGptsovitsBaseUrl: String(raw.ttsGptsovitsBaseUrl ?? ""),
      ttsGptsovitsRefAudioPath: String(raw.ttsGptsovitsRefAudioPath ?? ""),
      ttsGptsovitsPromptText: String(raw.ttsGptsovitsPromptText ?? ""),
      ttsGptsovitsFormat: raw.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
      ttsCustomCloudEndpointUrl: String(raw.ttsCustomCloudEndpointUrl ?? ""),
      ttsCustomCloudApiKey: String(raw.ttsCustomCloudApiKey ?? ""),
      ttsCustomCloudVoiceId: String(raw.ttsCustomCloudVoiceId ?? ""),
      ttsCustomCloudFormat: raw.ttsCustomCloudFormat === "wav" ? "wav" : "mp3",
      ttsCustomCloudTimeoutMs: Number(raw.ttsCustomCloudTimeoutMs ?? 30000),
      ttsMimoKey: String(raw.ttsMimoKey ?? ""),
      ttsMimoVoiceAudioPath: String(raw.ttsMimoVoiceAudioPath ?? ""),
      ttsMimoStylePrompt: String(raw.ttsMimoStylePrompt ?? ""),
      ttsMosslandKey: String(raw.ttsMosslandKey ?? ""),
      ttsMosslandVoiceId: String(raw.ttsMosslandVoiceId ?? ""),
      ttsMosslandModel: String(raw.ttsMosslandModel ?? "moss-tts"),
      ttsStreaming: raw.ttsStreaming !== false,
    };
  } catch {
    return null;
  }
}

// Settings，Settings/Volume/。
function waitForAudioMetadata(audio: HTMLAudioElement): Promise<number | null> {
  return new Promise((resolve) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      resolve(audio.duration);
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 3000);
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    const onError = () => {
      cleanup();
      resolve(null);
    };
    audio.addEventListener("loadedmetadata", onLoaded, { once: true });
    audio.addEventListener("error", onError, { once: true });
  });
}

function playTtsBase64(
  base64: string,
  format: "wav" | "mp3" = "mp3",
  msgId?: string,
): void {
  stopCurrentTts();
  const token = nextSpeechToken();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const mime = format === "wav" ? "audio/wav" : "audio/mp3";
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.load();
  currentTtsAudio = audio;
  currentTtsObjectUrl = url;
  //  UI （ msgId ）
  setSpeakingMsgId(msgId ?? null);

  audio.onended = () => {
    releaseCurrentTtsAudio(audio);
    if (speechToken === token) stopLive2dMouth();
    //  UI：，
    if (msgId === undefined || currentSpeakingMsgId === msgId) {
      setSpeakingMsgId(null);
    }
  };

  void (async () => {
    const durationSec = await waitForAudioMetadata(audio);
    try {
      await audio.play();
    } catch (err) {
      console.warn("[TTS] Playback failed:", err);
      releaseCurrentTtsAudio(audio);
      if (speechToken === token) stopLive2dMouth();
      if (msgId === undefined || currentSpeakingMsgId === msgId) {
        setSpeakingMsgId(null);
      }
      return;
    }

    if (speechToken !== token) return;
    window.live2dSpeech?.prepare();
    const durationMs = durationSec === null ? 0 : Math.max(0, durationSec * 1000 - AUDIO_MOUTH_DELAY_MS);
    window.setTimeout(() => {
      if (speechToken !== token) return;
      if (durationMs > 0) window.live2dSpeech?.startMouth(durationMs);
    }, AUDIO_MOUTH_DELAY_MS);
  })();
}

/**
 * Streaming Playback MiniMax TTS（MediaSource + SourceBuffer ）。
 *  cacheKey（）。Failed fallback 。
 */
async function streamAndPlayCached(
  settings: TtsSettings,
  text: string,
  existing?: { ttsCacheKey?: string },
  options?: { waitForPlaybackEnd?: boolean },
): Promise<{ cacheKey: string } | null> {
  if (!window.tts) return null;

  stopCurrentTts();  // Stop current TTS first (including stopLive2dMouth), then obtain token; otherwise token invalidates immediately
  const token = nextSpeechToken();
  const t0 = performance.now();  // Diagnostic timestamp baseline (used in startPolling closure, must be declared outside try)
  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  let audioEl: HTMLAudioElement | null = null;
  const chunkQueue: Uint8Array[] = [];
  const maxQueuedAudioBytes = 12 * 1024 * 1024;
  let queuedAudioBytes = 0;
  let ended = false;
  let resolvedCacheKey: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let offChunk: (() => void) | null = null;
  let offEnd: (() => void) | null = null;
  let offErr: (() => void) | null = null;
  let done = false;
  let playbackEnded = false;
  let streamReady = false;
  let streamResult: { cacheKey: string } | null = null;
  let resolveStream: ((v: { cacheKey: string } | null) => void) | null = null;

  const cleanup = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    offChunk?.(); offEnd?.(); offErr?.();
    offChunk = offEnd = offErr = null;
    chunkQueue.length = 0;
    queuedAudioBytes = 0;
  };

  const finishStream = (result: { cacheKey: string } | null) => {
    streamReady = true;
    streamResult = result;
    if (!options?.waitForPlaybackEnd || playbackEnded) {
      resolveStream?.(streamResult);
    }
  };

  const markPlaybackEnded = () => {
    playbackEnded = true;
    if (streamReady) {
      resolveStream?.(streamResult);
    }
  };

  //  flush： 30ms ， append  append， endOfStream + resolve
  const startPolling = (resolve: (v: { cacheKey: string } | null) => void) => {
    let startedPlayback = false;
    pollTimer = setInterval(() => {
      if (speechToken !== token) {
        cleanup();
        try { mediaSource?.endOfStream(); } catch { /* */ }
        finishStream(null);
        return;
      }
      // append  chunk（ sourceBuffer ）
      if (sourceBuffer && !sourceBuffer.updating && chunkQueue.length > 0) {
        const chunk = chunkQueue.shift()!;
        queuedAudioBytes -= chunk.byteLength;
        try {
          sourceBuffer.appendBuffer(chunk);
        } catch {
          chunkQueue.unshift(chunk);
          queuedAudioBytes += chunk.byteLength;
        }
      }
      //  append （buffered ）
      if (!startedPlayback && sourceBuffer && sourceBuffer.buffered.length > 0 && audioEl && audioEl.paused) {
        startedPlayback = true;
        void audioEl.play().then(() => {
          console.log(`[TTS-Stream] play() starts +${Math.round(performance.now() - t0)}ms`);
          if (speechToken !== token) return;
          const estDurationMs = Math.max(2000, Array.from(text).length * 180);
          window.live2dSpeech?.startMouth(estDurationMs);
        }).catch((err) => {
          console.warn("[TTS-Stream] play failed:", err);
          markPlaybackEnded();
        });
      }
      //  → endOfStream
      if (ended && chunkQueue.length === 0 && sourceBuffer && !sourceBuffer.updating && !done) {
        done = true;
        try { mediaSource?.endOfStream(); } catch { /* */ }
        cleanup();
        if (options?.waitForPlaybackEnd && !startedPlayback) {
          markPlaybackEnded();
        }
        console.log(`[TTS-Stream] resolve +${Math.round(performance.now() - t0)}ms cacheKey=${resolvedCacheKey?.slice(0,20)}`);
        finishStream(resolvedCacheKey ? { cacheKey: resolvedCacheKey } : null);
      }
    }, 30);
  };

  try {
    // 
    const startResult = await window.tts.streamStart({
      apiKey: settings.ttsMinimaxKey,
      voiceId: settings.ttsMinimaxVoiceId,
      text,
      speed: settings.ttsSpeed,
      volume: settings.ttsVolume,
      model: settings.ttsMinimaxModel,
      format: "mp3",
      expectedCacheKey: existing?.ttsCacheKey,
    });
    console.log(`[TTS-Stream] streamStart returns +${Math.round(performance.now() - t0)}ms started=${startResult.started} cached=${startResult.cached}`);

    // （）
    let firstChunkAt = 0;
    offChunk = window.tts.onAudioChunk((payload) => {
      if (speechToken !== token) return;
      if (!firstChunkAt) {
        firstChunkAt = performance.now();
        console.log(`[TTS-Stream] First chunk +${Math.round(firstChunkAt - t0)}ms`);
      }
      const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
      if (queuedAudioBytes + bytes.byteLength > maxQueuedAudioBytes) {
        console.warn("[TTS-Stream] Audio queue exceeded 12MB, stopping streaming playback");
        cleanup();
        if (audioEl) releaseCurrentTtsAudio(audioEl);
        finishStream(null);
        return;
      }
      chunkQueue.push(bytes);
      queuedAudioBytes += bytes.byteLength;
    });
    offEnd = window.tts.onStreamEnd((payload) => {
      ended = true;
      resolvedCacheKey = payload.cacheKey;
      console.log(`[TTS-Stream] STREAM_END +${Math.round(performance.now() - t0)}ms chunks=${chunkQueue.length}`);
    });
    offErr = window.tts.onStreamError((payload) => {
      console.warn(`[TTS-Stream] ERROR +${Math.round(performance.now() - t0)}ms:`, payload.message);
      ended = true;
      cleanup();
      try { mediaSource?.endOfStream(); } catch { /* */ }
    });

    // Settings MediaSource + Audio
    mediaSource = new MediaSource();
    const url = URL.createObjectURL(mediaSource);
    audioEl = new Audio(url);
    currentTtsAudio = audioEl;
    currentTtsObjectUrl = url;

    window.live2dSpeech?.prepare();  // stopLive2dMouth was already called in stopCurrentTts at start

    audioEl.onended = () => {
      releaseCurrentTtsAudio(audioEl!);
      if (speechToken === token) stopLive2dMouth();
      markPlaybackEnded();
    };

    mediaSource.addEventListener("sourceopen", () => {
      console.log(`[TTS-Stream] sourceopen +${Math.round(performance.now() - t0)}ms`);
      try {
        sourceBuffer = mediaSource!.addSourceBuffer("audio/mpeg");
        sourceBuffer.mode = "sequence";
        console.log(`[TTS-Stream] sourceBuffer created successfully`);
        //  play—— append （buffered.length>0） play
      } catch (err) {
        console.warn("[TTS-Stream] SourceBuffer creation failed:", err);
      }
    });

    // （30s）
    setTimeout(() => {
      if (!done) {
        ended = true;
      }
    }, 30000);

    //  STREAM_END +  flush 
    return await new Promise<{ cacheKey: string } | null>((resolve) => {
      resolveStream = resolve;
      startPolling(resolve);
    });
  } catch (err) {
    console.warn("[TTS] Streaming startup failed:", err);
    cleanup();
    return null;  // Caller falls back to full synthesis
  }
}

async function synthesizeAndPlayCached(
  text: string,
  existing?: { ttsCacheKey?: string },
  msgId?: string,
): Promise<{ cacheKey: string } | null> {
  if (!window.tts) return null;

  // ： ttsCacheKey，，。
  // 、。
  const settings = await loadTtsSettings();
  if (!settings || settings.ttsEngine === "off") return null;

  // ： cacheKey  _CACHED IPC
  // （minimax  TTS_SYNTHESIZE_CACHED，gptsovits  TTS_SYNTHESIZE_CACHED_GPTSOVITS）
  if (existing?.ttsCacheKey) {
    const isGptsovitsCache = existing.ttsCacheKey.startsWith("gptsovits-");
    const isCustomCloudCache = existing.ttsCacheKey.startsWith("custom-cloud-");
    const isMimoCache = existing.ttsCacheKey.startsWith("mimo-");
    const isMosslandCache = existing.ttsCacheKey.startsWith("mossland-");
    try {
      if (isGptsovitsCache) {
        const result = await window.tts.synthesizeCachedGptsovits({
          baseUrl: "cache-only",        // Placeholder, not used on cache hit
          refAudioPath: "cache-only",   // placeholder
          promptText: "cache-only",     // placeholder
          text,
          speed: settings.ttsSpeed,
          format: settings.ttsGptsovitsFormat,
          expectedCacheKey: existing.ttsCacheKey,
        });
        if (result.cached) {
          console.log("[TTS] gptsovits cache hit, playing directly");
          playTtsBase64(result.base64, result.format, msgId);
          return { cacheKey: result.cacheKey };
        }
      } else if (isCustomCloudCache) {
        const result = await window.tts.synthesizeCachedCustomCloud({
          endpointUrl: "cache-only",    // Placeholder, not used on cache hit
          apiKey: "cache-only",
          voiceId: "cache-only",
          text,
          speed: settings.ttsSpeed,
          volume: settings.ttsVolume,
          format: settings.ttsCustomCloudFormat,
          timeoutMs: settings.ttsCustomCloudTimeoutMs,
          expectedCacheKey: existing.ttsCacheKey,
        });
        if (result.cached) {
          console.log("[TTS] custom-cloud cache hit, playing directly");
          playTtsBase64(result.base64, result.format, msgId);
          return { cacheKey: result.cacheKey };
        }
      } else if (isMimoCache) {
        const result = await window.tts.synthesizeCachedMimo({
          apiKey: "cache-only",
          voiceAudioPath: "cache-only",
          text,
          stylePrompt: "",
          expectedCacheKey: existing.ttsCacheKey,
        });
        if (result.cached) {
          console.log("[TTS] mimo cache hit, playing directly");
          playTtsBase64(result.base64, result.format, msgId);
          return { cacheKey: result.cacheKey };
        }
      } else if (isMosslandCache) {
        const result = await window.tts.synthesizeCachedMossland({
          apiKey: "cache-only",
          voiceId: "cache-only",
          text,
          model: "moss-tts",
          format: "mp3",
          expectedCacheKey: existing.ttsCacheKey,
        });
        if (result.cached) {
          console.log("[TTS] mossland cache hit, playing directly");
          playTtsBase64(result.base64, result.format, msgId);
          return { cacheKey: result.cacheKey };
        }
      } else {
        // minimax （）
        const result = await window.tts.synthesizeCached({
          apiKey: "cache-only",
          voiceId: "cache-only",
          text,
          speed: settings.ttsSpeed,
          volume: settings.ttsVolume,
          model: settings.ttsMinimaxModel,
          expectedCacheKey: existing.ttsCacheKey,
        });
        if (result.cached) {
          console.log("[TTS] minimax cache hit, playing directly");
          playTtsBase64(result.base64, result.format, msgId);
          return { cacheKey: result.cacheKey };
        }
      }
    } catch {
      // Failed，
    }
  }

  if (settings.ttsEngine === "edge") {
    try {
      const res = await window.tts.synthesizeOnline({ text });
      if (res && res.base64) {
        playTtsBase64(res.base64, res.format || "mp3", msgId);
        return { cacheKey: `edge-${Date.now()}` };
      }
    } catch (err) {
      console.warn("[TTS] Edge Neural synthesis failed:", err);
      return null;
    }
  }

  //  →  engine 
  if (settings.ttsEngine === "minimax") {
    if (!settings.ttsMinimaxKey || !settings.ttsMinimaxVoiceId) {
      console.warn("[TTS] Missing apiKey or voiceId, cannot synthesize new audio");
      return null;
    }
    // （Default）：，；Failed fallback 
    if (settings.ttsStreaming) {
      const stream = await streamAndPlayCached(settings, text, existing);
      if (stream) return stream;
      console.warn("[TTS] Streaming failed, falling back to full synthesis");
    }
    try {
      const result = await window.tts.synthesizeCached({
        apiKey: settings.ttsMinimaxKey,
        voiceId: settings.ttsMinimaxVoiceId,
        text,
        speed: settings.ttsSpeed,
        volume: settings.ttsVolume,
        model: settings.ttsMinimaxModel,
        expectedCacheKey: existing?.ttsCacheKey,
      });
      playTtsBase64(result.base64, result.format, msgId);
      return { cacheKey: result.cacheKey };
    } catch (err) {
      console.warn("[TTS] Synthesis failed:", err);
      return null;
    }
  }

  if (settings.ttsEngine === "gptsovits") {
    const baseUrl = settings.ttsGptsovitsBaseUrl || "http://127.0.0.1:9880";
    if (!baseUrl) {
      console.warn("[TTS] Missing GPT-SoVITS configuration (baseUrl)");
      return null;
    }
    try {
      const result = await window.tts.synthesizeCachedGptsovits({
        baseUrl,
        refAudioPath: settings.ttsGptsovitsRefAudioPath || "",
        promptText: settings.ttsGptsovitsPromptText || "",
        text,
        speed: settings.ttsSpeed,
        format: settings.ttsGptsovitsFormat,
        expectedCacheKey: existing?.ttsCacheKey,
      });
      playTtsBase64(result.base64, result.format, msgId);
      return { cacheKey: result.cacheKey };
    } catch (err) {
      console.warn("[TTS] GPT-SoVITS synthesis failed:", err);
      return null;
    }
  }

  if (settings.ttsEngine === "custom-cloud") {
    if (!settings.ttsCustomCloudEndpointUrl) {
      console.warn("[TTS] Missing custom cloud Endpoint URL");
      return null;
    }
    try {
      const result = await window.tts.synthesizeCachedCustomCloud({
        endpointUrl: settings.ttsCustomCloudEndpointUrl,
        apiKey: settings.ttsCustomCloudApiKey,
        voiceId: settings.ttsCustomCloudVoiceId,
        text,
        speed: settings.ttsSpeed,
        volume: settings.ttsVolume,
        format: settings.ttsCustomCloudFormat,
        timeoutMs: settings.ttsCustomCloudTimeoutMs,
        expectedCacheKey: existing?.ttsCacheKey,
      });
      playTtsBase64(result.base64, result.format, msgId);
      return { cacheKey: result.cacheKey };
    } catch (err) {
      console.warn("[TTS] Custom cloud synthesis failed:", err);
      return null;
    }
  }

  if (settings.ttsEngine === "mimo") {
    if (!settings.ttsMimoKey || !settings.ttsMimoVoiceAudioPath) {
      console.warn("[TTS] Missing Xiaomi MiMo API Key or Cyrene clone audio");
      return null;
    }
    try {
      const result = await window.tts.synthesizeCachedMimo({
        apiKey: settings.ttsMimoKey,
        voiceAudioPath: settings.ttsMimoVoiceAudioPath,
        text,
        stylePrompt: settings.ttsMimoStylePrompt,
        expectedCacheKey: existing?.ttsCacheKey,
      });
      playTtsBase64(result.base64, result.format, msgId);
      return { cacheKey: result.cacheKey };
    } catch (err) {
      console.warn("[TTS] Xiaomi MiMo synthesis failed:", err);
      return null;
    }
  }

  if (settings.ttsEngine === "mossland") {
    if (!settings.ttsMosslandKey || !settings.ttsMosslandVoiceId) {
      console.warn("[TTS] Missing Mossland API Key or voice_id");
      return null;
    }
    try {
      const result = await window.tts.synthesizeCachedMossland({
        apiKey: settings.ttsMosslandKey,
        voiceId: settings.ttsMosslandVoiceId,
        text,
        speed: settings.ttsSpeed,
        volume: settings.ttsVolume,
        model: settings.ttsMosslandModel || "moss-tts",
        format: "mp3",
        expectedCacheKey: existing?.ttsCacheKey,
      });
      playTtsBase64(result.base64, result.format, msgId);
      return { cacheKey: result.cacheKey };
    } catch (err) {
      console.warn("[TTS] Mossland synthesis failed:", err);
      return null;
    }
  }

  if (settings.ttsEngine === "web-speech") {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        stopCurrentTts();
        const cleaned = cleanTextForSpeech(text);
        if (!cleaned) return null;
        const utterance = new SpeechSynthesisUtterance(cleaned);
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          const isMale = (v: SpeechSynthesisVoice) => {
            const n = (v.name + " " + v.lang).toLowerCase();
            return (
              n.includes("david") ||
              n.includes("mark") ||
              n.includes("george") ||
              n.includes("richard") ||
              n.includes("james") ||
              n.includes("ichiro") ||
              n.includes("kangkang") ||
              n.includes("male")
            );
          };
          const femaleVoices = voices.filter((v) => !isMale(v));
          const pool = femaleVoices.length > 0 ? femaleVoices : voices;
          const preferredVoice =
            pool.find((v) => {
              const n = (v.name + " " + v.lang).toLowerCase();
              return (
                n.includes("zh") ||
                n.includes("chinese") ||
                n.includes("mandarin") ||
                n.includes("huihui") ||
                n.includes("xiaoxiao") ||
                n.includes("yaoyao")
              );
            }) ||
            pool.find((v) => {
              const n = (v.name + " " + v.lang).toLowerCase();
              return (
                n.includes("ja") ||
                n.includes("haruka") ||
                n.includes("ayumi") ||
                n.includes("sayaka")
              );
            }) ||
            pool.find((v) => {
              const n = (v.name + " " + v.lang).toLowerCase();
              return n.includes("zira") || n.includes("female") || n.includes("vi-vn");
            }) ||
            (femaleVoices.length > 0 ? femaleVoices[0] : pool[0]);
          if (preferredVoice) utterance.voice = preferredVoice;
        }
        utterance.pitch = 1.15;
        utterance.rate = Number(settings.ttsSpeed ?? 1.05);
        utterance.volume = Number(settings.ttsVolume ?? 1.0);

        const estimatedDurationMs = Math.max(1200, Math.round((cleaned.length / 13) * 1000));
        utterance.onstart = () => {
          if (msgId) setSpeakingMsgId(msgId);
          window.live2dSpeech?.startMouth(estimatedDurationMs);
        };
        utterance.onend = () => {
          if (msgId && currentSpeakingMsgId === msgId) setSpeakingMsgId(null);
          window.live2dSpeech?.stopMouth();
        };
        utterance.onerror = () => {
          if (msgId && currentSpeakingMsgId === msgId) setSpeakingMsgId(null);
          window.live2dSpeech?.stopMouth();
        };
        window.speechSynthesis.speak(utterance);
        return { cacheKey: `web-speech-${Date.now()}` };
      } catch (err) {
        console.warn("[TTS] Web speech synthesis failed:", err);
        return null;
      }
    }
    return null;
  }

  return null;
}

async function speakMessage(message: Message): Promise<void> {
  ttsPlaybackSequence += 1;
  stopLive2dMouth();
  window.live2dSpeech?.prepare();
  // Immediately update UI: do not wait for synthesis, user sees playing state immediately.
  // playTtsBase64 will call setSpeakingMsgId again when playback actually starts (idempotent); resets on catch failure.
  setSpeakingMsgId(message.id);
  try {
    const cache = await synthesizeAndPlayCached(message.content, message, message.id);
    if (cache) {
      message.ttsCacheKey = cache.cacheKey;
      void saveSession();
    } else {
      // Delegate to Live2D Pet Companion (Microsoft Edge Neural zh-CN-XiaoyiNeural with lip-sync)
      window.live2dSpeech?.speak?.(message.content);
      setTimeout(() => {
        if (currentSpeakingMsgId === message.id) setSpeakingMsgId(null);
      }, 4000);
    }
  } catch (err) {
    console.warn("[TTS] speakMessage exception:", err);
    if (currentSpeakingMsgId === message.id) setSpeakingMsgId(null);
  }
}

// Auto read: check if engine is enabled + autoRead switch; synthesize only when conditions met
async function autoSpeakIfEnabled(text: string): Promise<{ cacheKey: string } | null> {
  const settings = await loadTtsSettings();
  if (!settings || settings.ttsEngine === "off" || !settings.ttsAutoRead) return null;
  ttsPlaybackSequence += 1;
  return await synthesizeAndPlayCached(text);
}

interface EarlyMinimaxPlayback {
  append(delta: string): void;
  finish(fullText: string): Promise<{ cacheKey: string } | null>;
}

function createEarlyMinimaxPlayback(): EarlyMinimaxPlayback {
  let settingsPromise: Promise<TtsSettings | null> | null = null;
  let settings: TtsSettings | null = null;
  let checked = false;
  let eligible = false;
  let triggered = false;
  let segment = "";
  let playbackPromise: Promise<{ ok: boolean; sequence: number }> | null = null;
  let sequence = 0;

  const ensureSettings = async (): Promise<TtsSettings | null> => {
    if (!settingsPromise) {
      settingsPromise = loadTtsSettings();
    }
    settings = await settingsPromise;
    if (!checked) {
      checked = true;
      eligible = canUseMinimaxStreamingEarly(settings);
    }
    return settings;
  };

  const tryStart = async (text: string): Promise<void> => {
    if (triggered) return;
    const cfg = await ensureSettings();
    if (!cfg || !eligible || triggered) return;
    const early = extractEarlyTtsSegment(text);
    if (!early) return;

    triggered = true;
    segment = early.segment;
    ttsPlaybackSequence += 1;
    sequence = ttsPlaybackSequence;
    playbackPromise = streamAndPlayCached(cfg, segment, undefined, { waitForPlaybackEnd: true })
      .then((result) => ({ ok: Boolean(result), sequence }))
      .catch(() => ({ ok: false, sequence }));
  };

  return {
    append(delta: string): void {
      if (triggered) return;
      void tryStart(delta);
    },
    async finish(fullText: string): Promise<{ cacheKey: string } | null> {
      const cfg = await ensureSettings();
      if (!cfg || !eligible) return autoSpeakIfEnabled(fullText);

      if (!triggered) {
        return autoSpeakIfEnabled(fullText);
      }

      const result = await playbackPromise;
      if (!result?.ok) {
        return autoSpeakIfEnabled(fullText);
      }
      if (result.sequence !== ttsPlaybackSequence) {
        return null;
      }

      const remainder = fullText.slice(segment.length).trim();
      if (!remainder) return null;
      const rest = await streamAndPlayCached(cfg, remainder, undefined, { waitForPlaybackEnd: true });
      return rest ? null : autoSpeakIfEnabled(fullText);
    },
  };
}

function autosize(): void {
  inputEl.style.height = "auto";
  const maxHeight = 160;
  const isOverflowing = inputEl.scrollHeight > maxHeight;
  inputEl.style.height = Math.min(inputEl.scrollHeight, maxHeight) + "px";
  inputEl.style.overflowY = isOverflowing ? "auto" : "hidden";
}

// ── Sticker Selector ──

let enabledStickers: Array<{ id: string; src: string; description?: string }> = [];

async function loadEnabledStickers(): Promise<void> {
  try {
    enabledStickers = (await window.chat?.getEnabledStickers?.()) ?? [];
  } catch {
    enabledStickers = [];
  }
}

/** Look up semantic description by sticker id */
function getStickerDescription(id: string): string {
  const found = enabledStickers.find((s) => s.id === id);
  return found?.description ?? id;
}

function renderStickerPicker(): void {
  stickerPickerGrid.replaceChildren();
  if (enabledStickers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sticker-picker__empty";
    empty.textContent = "No stickers available";
    stickerPickerGrid.appendChild(empty);
    return;
  }
  for (const s of enabledStickers) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sticker-picker__item";
    const img = document.createElement("img");
      // Built-in sticker src is absolute "/stickers/xxx", resolves to disk root under file:// protocol
      // Use resolveAsset() to convert to valid file:// or http:// URL (matches sticker-manager thumbnail pattern)
      img.src = s.src.startsWith("/stickers/") ? resolveAsset(s.src) : s.src;
    img.alt = s.id;
    img.draggable = false;
    card.appendChild(img);
    card.addEventListener("click", () => {
      insertSticker(s.id);
      hideStickerPicker();
    });
    stickerPickerGrid.appendChild(card);
  }
}

function insertSticker(id: string): void {
  const marker = `[sticker:${id}]`;
  const cursorPos = inputEl.selectionStart ?? inputEl.value.length;
  const cursorEnd = inputEl.selectionEnd ?? cursorPos;
  inputEl.value = inputEl.value.slice(0, cursorPos) + marker + inputEl.value.slice(cursorEnd);
  inputEl.selectionStart = inputEl.selectionEnd = cursorPos + marker.length;
  autosize();
  inputEl.focus();
}

function showStickerPicker(): void {
  stickerPicker.hidden = false;
  stickerPickerBtn.classList.add("is-active");
  void loadEnabledStickers().then(renderStickerPicker);
}

function hideStickerPicker(): void {
  stickerPicker.hidden = true;
  stickerPickerBtn.classList.remove("is-active");
}

stickerPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (stickerPicker.hidden) showStickerPicker();
  else hideStickerPicker();
});

document.addEventListener("click", (e) => {
  if (stickerPicker.hidden) return;
  if (!stickerPicker.contains(e.target as Node) && e.target !== stickerPickerBtn) {
    hideStickerPicker();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !stickerPicker.hidden) hideStickerPicker();
});

function buildModelMessages(): Array<{ role: "user" | "model"; content: string; at?: number }> {
  return messages
    .filter((message) => !message.transient && (message.content.trim() || message.modelContext?.trim() || message.sticker))
    .slice(-16)
    .map((message) => ({
      role: message.role,
      at: Number.isFinite(message.at) ? message.at : undefined,
      content: (message.content + (message.modelContext ? "\n\n" + message.modelContext : "")).replace(/\[sticker:([^\]]+)\]/g, (_match, id) => {
        const desc = getStickerDescription(id);
        return `(User sent sticker: ${desc})`;
      }),
    }));
}

/** Full document text, RAG excerpts, and image captions serve only current turn and must not persist in history. */
function clearModelContexts(): boolean {
  let changed = false;
  for (const message of messages) {
    if (message.modelContext !== undefined) {
      message.modelContext = undefined;
      changed = true;
    }
  }
  return changed;
}

function isChatMode(): boolean {
  const active = document.querySelector(".mode-switch__option.is-active") as HTMLElement | null;
  return active?.dataset?.modeValue === "chat";
}

function getCurrentStyleId(): StyleId {
  const active = document.querySelector("#style-dropdown .dm-opt.is-active") as HTMLElement | null;
  return normalizeStyleId(active?.dataset?.value);
}

let sending = false;

// Proactive-chat changes arriving during sending (e.g. Cyrene sends a proactive message) are not reloaded immediately,
// otherwise transient thinking messages / recent replies could get overwritten. Record sessionId and wait until sending finishes,
// then flush and reload after final saveSession is committed.
let pendingProactiveReloadId: string | null = null;

/**
 * Called after sending finishes: reload current session if there are queued external changes.
 *
 * Relies on ordered IPC handling: final saveSession (replaceTail) is sent synchronously before finally,
 * so the subsequent getPage IPC is processed after it, reading the saved reply safely.
 * ensuring the persisted reply is never overwritten.
 *
 * Known limitation: if external proactive message appends before user saveSession, replaceMessagesTail
 * would overwrite with local view (write conflict). Since scheduler does not fire evaluateCandidate during active turns,
 * this does not occur in practice; merge-aware saveSession should be added when scheduler is integrated.
 * to merge-aware strategy.
 */
async function flushPendingProactiveReload(): Promise<void> {
  const pendingId = pendingProactiveReloadId;
  if (!pendingId) return;
  pendingProactiveReloadId = null;
  // Confirm still current session before reloading; user might have switched sessions.
  if (pendingId === currentSessionId) {
    await loadSessionTailIntoUI(pendingId);
  }
}

// ── Quick Preset Capsules ──────────────────────────────────────────
// Semi-transparent capsules displayed below empty-state on empty chats:
// - fill mode: fills preset prompt into input, user edits and sends
// - chat mode: Cyrene speaks first (injects hidden seed message to trigger agent)

interface QuickPreset {
  id: string;
  label: string;
  icon: string;
  mode: "chat" | "fill";
  prompt?: string;
}

const QUICK_PRESETS: QuickPreset[] = [
  { id: "chat",     label: "Chat with Cyrene", icon: `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M33 38H22V30H36V22H44V38H39L36 41L33 38Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 6H36V30H17L13 34L9 30H4V6Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 18H20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M26 18H27" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 18H13" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,  mode: "chat" },
  { id: "schedule", label: "Set Scheduled Task", icon: `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M23.9998 44.3332C34.1251 44.3332 42.3332 36.1251 42.3332 25.9999C42.3332 15.8747 34.1251 7.66656 23.9998 7.66656C13.8746 7.66656 5.6665 15.8747 5.6665 25.9999C5.6665 36.1251 13.8746 44.3332 23.9998 44.3332Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23.7594 15.3536L23.7582 26.3624L31.5305 34.1347" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9.00001L11 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 9.00001L37 4.00001" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, mode: "fill", prompt: "Help me set a scheduled task: " },
  { id: "weather",  label: "Check Weather",   icon: `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M30.7826 24.5652C34.5285 24.5652 37.5652 21.5285 37.5652 17.7826C37.5652 14.0367 34.5285 11 30.7826 11C27.4338 11 24.6518 13.427 24.0996 16.618" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 7C34.1046 7 35 6.10457 35 5C35 3.89543 34.1046 3 33 3C31.8954 3 31 3.89543 31 5C31 6.10457 31.8954 7 33 7Z" fill="currentColor"/><path d="M42 12C43.1046 12 44 11.1046 44 10C44 8.89543 43.1046 8 42 8C40.8954 8 40 8.89543 40 10C40 11.1046 40.8954 12 42 12Z" fill="currentColor"/><path d="M44 21C45.1046 21 46 20.1046 46 19C46 17.8954 45.1046 17 44 17C42.8954 17 42 17.8954 42 19C42 20.1046 42.8954 21 44 21Z" fill="currentColor"/><path d="M22 10C23.1046 10 24 9.10457 24 8C24 6.89543 23.1046 6 22 6C20.8954 6 20 6.89543 20 8C20 9.10457 20.8954 10 22 10Z" fill="currentColor"/><path d="M9.45455 39.9942C6.14242 37.461 4 33.4278 4 28.8851C4 21.2166 10.1052 15 17.6364 15C23.9334 15 29.2336 19.3462 30.8015 25.2533C32.0353 24.6159 33.431 24.2567 34.9091 24.2567C39.9299 24.2567 44 28.4011 44 33.5135C44 37.3094 41.7562 40.5716 38.5455 42" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M22.2426 24.7574C21.1569 23.6716 19.6569 23 18 23C14.6863 23 12 25.6863 12 29C12 30.6569 12.6716 32.1569 13.7574 33.2426" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, mode: "fill", prompt: "Check today's weather for me" },
  { id: "document", label: "Create Document",   icon: `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="6" y="6" width="36" height="36" rx="3" fill="none" stroke="currentColor" stroke-width="4"/><path d="M14 16L18 32L24 19L30 32L34 16" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, mode: "fill", prompt: "Help me create a document: " },
  { id: "email",    label: "Send Email",   icon: `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M36 15H44V28V41H4V28V15H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 19V5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 11L24 5L18 11" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15L24 30L44 15" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`, mode: "fill", prompt: "Help me send an email: " },
];

/** Dynamically generates capsule DOM and binds clicks. Called once at bootstrap end. */
function buildQuickPresets(): void {
  const container = document.getElementById("quick-presets");
  if (!container) return;
  container.replaceChildren();
  for (const preset of QUICK_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat__preset";
    btn.dataset.presetId = preset.id;
    const icon = document.createElement("span");
    icon.className = "chat__preset-icon";
    icon.innerHTML = preset.icon;
    const label = document.createElement("span");
    label.className = "chat__preset-label";
    label.textContent = preset.label;
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.addEventListener("click", () => onPresetClick(preset));
    container.appendChild(btn);
  }
}

function onPresetClick(preset: QuickPreset): void {
  if (preset.mode === "fill") {
    inputEl.value = preset.prompt ?? "";
    inputEl.focus();
    const len = inputEl.value.length;
    inputEl.setSelectionRange(len, len);
    autosize();
  } else {
    void triggerCyreneGreeting();
  }
}

/**
 * "Chat with Cyrene" capsule: let Cyrene speak first.
 * Injects hidden seed message to trigger agent (not pushed to messages array or rendered),
 * reuses existing AG-UI streaming reply mechanism.
 */
async function triggerCyreneGreeting(): Promise<void> {
  if (sending || !currentSessionId) return;

  // Immediately hide empty state (capsules), do not wait for refreshModelConfig async completion
  const emptyEl = document.getElementById("chat-empty");
  if (emptyEl) emptyEl.setAttribute("hidden", "");

  sending = true;
  sendBtn.disabled = true;
  await refreshModelConfig();
  chatHintEl.textContent = currentModelConfig?.connected ? `${currentModelConfig.model} thinking…` : "Model disconnected";

  let streamMsgId = "";
  try {
    streamMsgId = String(Date.now() + 1);
    const streamMsg = { id: streamMsgId, role: "model" as const, content: "", at: Date.now(), thinking: true, transient: true };
    messages.push(streamMsg);
    render();

    let streamContent = "";
    let ttsContent = "";
    let autoSpeakTriggered = false;
    const earlyMinimaxPlayback = createEarlyMinimaxPlayback();
    textMouthStarted = false;
    let pendingTtsCachePromise: Promise<{ cacheKey: string } | null> | null = null;
    let sticker: string | null = null;
    let pendingWeatherCard: Record<string, unknown> | null = null;
    let pendingMusicCard: MusicCardData | null = null;

    let finishRun!: () => void;
    let failRun!: (err: Error) => void;
    const runDone = new Promise<void>((resolve, reject) => {
      finishRun = resolve;
      failRun = reject;
    });

    const deltaQueue: string[] = [];
    let streamSession: StreamingMarkdownSession | null = null;
    let playbackTimer: number | null = null;
    let runFinishedArrived = false;
    let startNextStreamingBubble = false;
    let streamingBubbleCount = 1;
    const allowStreamingBubbleSplit = shouldSegmentAssistantReply(isChatMode() ? "chat" : "work", segmentedOutputMode);
    const getStreamingBubble = (): HTMLElement | null => {
      return getLastBubbleForMessage(streamMsgId);
    };
    const tryFinish = (): void => {
      if (runFinishedArrived && deltaQueue.length === 0 && playbackTimer === null) {
        finishRun();
      }
    };
    const startPlayback = (): void => {
      if (playbackTimer !== null) return;
      playbackTimer = window.setInterval(() => {
        const next = deltaQueue.shift();
        if (next !== undefined) {
          streamContent += next;
          const bubble = startNextStreamingBubble
            ? (appendBubbleForMessage(streamMsgId) ?? getStreamingBubble())
            : getStreamingBubble();
          startNextStreamingBubble = false;
          if (bubble) {
            if (!streamSession) {
              bubble.classList.add("is-streaming");
              streamSession = createStreamingMarkdownSession(getMd(), bubble, streamMsgId, messagesEl);
            }
            streamSession.append(next);
          }
          if (
            allowStreamingBubbleSplit
            && streamingBubbleCount < MAX_ASSISTANT_REPLY_BUBBLES
            && shouldBreakStreamingBubbleAfterChar(next)
          ) {
            startNextStreamingBubble = true;
            streamingBubbleCount += 1;
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        if (playbackTimer !== null) { clearInterval(playbackTimer); playbackTimer = null; }
        tryFinish();
      }, 40);
    };
    const offEvent = registerAguiListener((rawEvent) => {
      try {
        const event = rawEvent as AguiBaseEvent;
        const msg = messages.find(m => m.id === streamMsgId);
        switch (event.type) {
          case "TOOL_CALL_START": {
            const bubble = getStreamingBubble();
            if (bubble) {
              bubble.classList.remove("msg__bubble--thinking");
              bubble.replaceChildren();
              const tip = document.createElement("div");
              tip.className = "msg__tool-tip";
              tip.dataset.toolCallId = event.toolCallId ?? "";
              const icon = document.createElement("span");
              icon.className = "msg__tool-icon";
              icon.textContent = "🔧";
              const text = document.createElement("span");
              text.className = "msg__tool-text";
              text.textContent = "Calling: " + (event.toolCallName ?? "tool");
              tip.appendChild(icon);
              tip.appendChild(text);
              bubble.appendChild(tip);
            }
            break;
          }
          case "TOOL_CALL_END": {
            const bubble = getStreamingBubble();
            if (bubble) {
              const tip = bubble.querySelector(".msg__tool-tip");
              if (tip) {
                const textEl = tip.querySelector(".msg__tool-text");
                if (textEl) textEl.textContent = "Completed";
                tip.classList.add("msg__tool-tip--done");
              }
            }
            break;
          }
          case "TEXT_MESSAGE_START":
            if (msg) { msg.thinking = false; render(); }
            break;
          case "TEXT_MESSAGE_CONTENT":
            if (event.delta) {
              ttsContent += event.delta;
              earlyMinimaxPlayback.append(ttsContent);
              deltaQueue.push(...Array.from(event.delta));
              if (!textMouthStarted) {
                void loadTtsSettings().then((settings) => {
                  if (settings && !settings.ttsAutoRead) {
                    startTextModeMouth();
                  }
                });
              }
              if (msg) { msg.thinking = false; }
              startPlayback();
            }
            break;
          case "TEXT_MESSAGE_END":
            if (!autoSpeakTriggered && ttsContent.trim()) {
              autoSpeakTriggered = true;
              pendingTtsCachePromise = earlyMinimaxPlayback.finish(ttsContent);
            }
            break;
          case "CUSTOM":
            if (event.name === "cyrene.sticker") {
              sticker = (event.value as StickerId | null) ?? null;
            } else if (event.name === "cyrene.weather") {
              pendingWeatherCard = event.value as Record<string, unknown>;
            } else if (event.name === "cyrene.music") {
              pendingMusicCard = normalizeMusicCardData(event.value);
            } else if (event.name === "cyrene.todos") {
              renderTodoPanel(event.value as TodoState | null);
            } else if (event.name === "cyrene.choice") {
              const choiceData = event.value;
              const card = isAskClarificationCard(choiceData)
                ? buildAskClarificationCardEl(choiceData)
                : buildChoiceCardEl(choiceData as {
                    id: string;
                    question: string;
                    options: Array<{ label: string; value: string; description?: string }>;
                    default?: string;
                  });
              messagesEl.appendChild(card);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;
          case "RUN_FINISHED":
            runFinishedArrived = true;
            tryFinish();
            break;
          case "RUN_ERROR":
            failRun(new AgentRenderError(event.code, event.message ?? "Model request failed"));
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("[Chat] onEvent callback threw error:", err);
      }
    });

    // Seed message: not pushed to messages array or rendered, serves only as agent trigger input
    const ack = await window.agui!.run({
      messages: [{ role: "user", content: "[internal] The user clicked 'Chat with Cyrene'. Please initiate a friendly greeting to start the conversation naturally." }],
      styleId: getCurrentStyleId(),
      executionMode: isChatMode() ? "chat" : "work",
      sessionId: currentSessionId || undefined,
    });
    if (!ack.success) {
      offEvent();
      throw new Error(ack.error || "Failed to initiate model request");
    }

    await runDone;
    offEvent();

    // flush + dispose streaming Markdown session (finalizeStreamingBubble will atomically replace in final state)
    if (streamSession) {
      streamSession.flush();
      streamSession.dispose();
      streamSession = null;
    }

    const msg = messages.find(m => m.id === streamMsgId);
    if (msg) {
      msg.thinking = false;
      msg.transient = false;
      msg.content = streamContent;
      msg.sticker = sticker;
      msg.musicCard = pendingMusicCard ?? undefined;
    }
    void saveSession();
    const finishedMsgId = streamMsgId;
    void pendingTtsCachePromise?.then((cache) => {
      if (!cache) return;
      const latestMsg = messages.find(m => m.id === finishedMsgId);
      if (!latestMsg) return;
      latestMsg.ttsCacheKey = cache.cacheKey;
      void saveSession();
    });

    // Final state: upgrade markdown of current streaming bubble only, no full render() rebuild
    finalizeStreamingBubble(streamMsgId, streamContent);

    if (pendingWeatherCard) {
      const card = buildWeatherCardEl(pendingWeatherCard);
      messagesEl.appendChild(card);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      pendingWeatherCard = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model request failed";
    const code = err instanceof AgentRenderError ? err.code : undefined;
    const userMessage = classifyAgentError(code, message);
    const msg = messages.find(m => m.id === streamMsgId);
    if (msg) {
      msg.thinking = false;
      msg.transient = false;
      msg.content = userMessage;
    } else {
      messages.push({
        id: String(Date.now() + 2),
        role: "model",
        content: userMessage,
        at: Date.now(),
      });
    }
    void saveSession();
    finalizeStreamingBubble(streamMsgId, userMessage);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    chatHintEl.textContent = formatModelHint(currentModelConfig);
    inputEl.focus();
    void flushPendingProactiveReload();
  }
}

async function send(): Promise<void> {
  const text = inputEl.value.trim();
  if ((!text && attachedFiles.length === 0) || sending) return;
  if (!currentSessionId) {
    console.warn("[Cyrene Chat] Session not yet initialized, creating emergency session");
    try {
      if (window.chatStore) {
        const created = await window.chatStore.create({ identityId: null });
        currentSessionId = created.id;
      } else {
        currentSessionId = "emergency-" + Date.now();
      }
    } catch {
      currentSessionId = "emergency-" + Date.now();
    }
  }
  const runSessionId = currentSessionId;
  let runMessages = messages;
  const runTailStart = sessionTailStart;

  sending = true;
  sendBtn.disabled = true;
  await refreshModelConfig();
  chatHintEl.textContent = currentModelConfig?.connected ? `${currentModelConfig.model} thinking…` : "Model disconnected";

  const filesForThisTurn = [...attachedFiles];
  const attachmentsForMsg: MessageAttachment[] = filesForThisTurn
    .filter((f) => (f.kind === "image" || f.kind === "document") && typeof f.filePath === "string")
    .map((f) => {
      if (f.kind === "image") {
        return {
          kind: "image",
          name: f.name,
          filePath: f.filePath!,
          mime: f.mime || "application/octet-stream",
          previewUrl: f.previewUrl,
          caption: f.caption,
          hasAnnotations: f.hasAnnotations,
          status: f.status || "pending",
        };
      }
      return {
        kind: "document",
        name: f.name,
        filePath: f.filePath!,
        status: f.status || "pending",
      };
    });

  const stickerMatch = text.match(/\[sticker:([^\]]+)\]/);
  const userStickerId = stickerMatch ? stickerMatch[1] : null;

  const userMsg: Message = {
    id: String(Date.now()),
    role: "user",
    content: text,
    at: Date.now(),
    attachments: attachmentsForMsg.length > 0 ? attachmentsForMsg : undefined,
    modelContext: undefined,
    sticker: userStickerId,
  };
  messages.push(userMsg);
  inputEl.value = "";
  autosize();
  removeAttachedFiles();
  void saveSession();
  render();

  const hintsByKind: string[] = [];
  const modelContextParts: string[] = [];
  let hasDocumentContext = false;
  let hasImageCaptionContext = false;
  let hasDirectImageContext = false;
  let hasUserAnnotationContext = false;
  const appendDocumentContext = (lines: string[]) => {
    if (lines.length === 0) return;
    if (!hasDocumentContext) {
      modelContextParts.push(`[Document Content]\n${lines.join("\n\n")}`);
      hasDocumentContext = true;
      return;
    }
    modelContextParts.push(...lines);
  };
  const appendImageCaptionContext = (line: string) => {
    if (!hasImageCaptionContext) {
      modelContextParts.push("[Image Visual Information]\nThe following is the vision model's observation of the user's images in this turn. Treat it as content you have seen; if analysis failed for an image, do not fabricate.\n" + line);
      hasImageCaptionContext = true;
      return;
    }
    modelContextParts.push(line);
  };
  const appendDirectImageContext = (line: string) => {
    if (!hasDirectImageContext) {
      modelContextParts.push("[Image Attachment]\nThe following images were sent directly to the main model with this message. Please answer directly using the image contents.\n" + line);
      hasDirectImageContext = true;
      return;
    }
    modelContextParts.push(line);
  };
  const appendUserAnnotationContext = () => {
    if (hasUserAnnotationContext) return;
    const notice = userAnnotationNotice(true);
    if (notice) modelContextParts.push(`[User Screenshot Annotation]\n${notice}`);
    hasUserAnnotationContext = true;
  };
  const directImageAttachments: { name: string; filePath: string; mime?: string }[] = [];
  let budgetUsed = 0;
  const budgetExceeded: string[] = [];
  const documentFilesForThisTurn = filesForThisTurn.filter((f) => f.kind === "document" && typeof f.filePath === "string");
  const imageFilesForThisTurn = filesForThisTurn.filter((f) => f.kind === "image");

  if (documentFilesForThisTurn.length > 0) {
    showTransientStatus("Analyzing document...");
    try {
      let waitMessage: Message | null = null;
      const processedDocs = await processDocumentsWithWait({
        processDocuments: async (filePaths, query) => window.chat?.processDocuments(filePaths, query) ?? [],
        filePaths: documentFilesForThisTurn.map((f) => f.filePath!),
        query: text,
        onWaitStart: (content) => {
          waitMessage = {
            id: `document-wait-${Date.now()}`,
            role: "model",
            content,
            at: Date.now(),
            transient: true,
          };
          messages.push(waitMessage);
          render();
        },
        onWaitEnd: () => {
          if (!waitMessage) return;
          const index = messages.indexOf(waitMessage);
          if (index >= 0) messages.splice(index, 1);
          waitMessage = null;
          render();
        },
      });
      for (const f of documentFilesForThisTurn) {
        const result = processedDocs.find((doc) => doc.filePath === f.filePath)
          ?? processedDocs.find((doc) => doc.name === f.name)
          ?? {
            name: f.name,
            kind: "unsupported" as const,
            filePath: f.filePath,
            reason: "Document processing returned no result",
          };
        const msgAtt = userMsg.attachments?.find((att): att is DocumentMessageAttachment =>
          att.kind === "document" && att.filePath === f.filePath
        );
        const processedKind = result.kind === "text" || result.kind === "indexed" || result.kind === "empty" || result.kind === "unsupported"
          ? result.kind
          : "unsupported";
        if (msgAtt) {
          msgAtt.processedKind = processedKind;
          msgAtt.chunks = result.chunks;
          msgAtt.importId = result.kind === "indexed" ? result.importId : undefined;
          msgAtt.reason = result.reason;
        }

        if (result.kind === "text") {
          if (msgAtt) msgAtt.status = "done";
          const docText = result.text || "";
          const remaining = BUDGET_CHARS - budgetUsed;
          if (remaining <= 0) {
            budgetExceeded.push(result.name);
            hintsByKind.push(`📝 ${result.name} (Attachment, content clipped due to turn budget limit)`);
          } else if (docText.length > remaining) {
            const clipped = docText.slice(0, remaining);
            appendDocumentContext([`Document ${result.name} excerpt:\n${clipped}`]);
            budgetExceeded.push(result.name);
            budgetUsed = BUDGET_CHARS;
            hintsByKind.push(`📝 ${result.name} (Attachment, content clipped and injected into turn context)`);
          } else {
            appendDocumentContext([`Document ${result.name} content:\n${docText}`]);
            budgetUsed += docText.length;
            hintsByKind.push(`📝 ${result.name} (Attachment, content injected into turn context)`);
          }
        } else if (result.kind === "indexed") {
          if (result.reason && (result.chunks ?? 0) <= 0) {
            if (msgAtt) msgAtt.status = "error";
            hintsByKind.push(`⚠️ ${result.name} (Document processing failed)`);
            appendDocumentContext(buildDocumentContextLines([result]));
          } else {
            if (msgAtt) msgAtt.status = "done";
            hintsByKind.push(`📚 ${result.name} (Indexed ${result.chunks ?? 0} chunks)`);
            appendDocumentContext(buildDocumentContextLines([result]));
          }
        } else if (result.kind === "empty") {
          if (msgAtt) msgAtt.status = "done";
          hintsByKind.push(`📄 ${result.name} (Empty)`);
          appendDocumentContext(buildDocumentContextLines([result]));
        } else {
          const reason = result.reason || "Unsupported or unreadable";
          if (msgAtt) msgAtt.status = reason === "cancelled" ? "cancelled" : "error";
          hintsByKind.push(`⚠️ ${result.name} (Unsupported or failed to process)`);
          appendDocumentContext(buildDocumentContextLines([{ ...result, reason }]));
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      for (const f of documentFilesForThisTurn) {
        const msgAtt = userMsg.attachments?.find((att): att is DocumentMessageAttachment =>
          att.kind === "document" && att.filePath === f.filePath
        );
        if (msgAtt) {
          msgAtt.status = "error";
          msgAtt.processedKind = "unsupported";
          msgAtt.reason = reason;
        }
        hintsByKind.push(`⚠️ ${f.name} (Document processing failed)`);
        appendDocumentContext(buildDocumentContextLines([{ kind: "error", name: f.name, reason }]));
      }
    } finally {
      hideTransientStatus();
      void saveSession();
      render();
    }
  }

  let imageSendStrategy: { mode: "direct" | "caption" } = { mode: "caption" };
  if (imageFilesForThisTurn.length > 0) {
    try {
      imageSendStrategy = await window.chat.getImageSendStrategy();
    } catch (err) {
      console.warn("[Cyrene Chat] Failed to get image send policy, falling back to caption:", err);
    }
  }
  const shouldCaptionImages = imageFilesForThisTurn.length > 0 && imageSendStrategy.mode !== "direct";
  if (shouldCaptionImages) showTransientStatus("Analyzing image...");
  try {
    for (const f of filesForThisTurn) {
      switch (f.kind) {
        case "document":
          break;
        case "image": {
          const msgAtt = userMsg.attachments?.find((att) => att.filePath === f.filePath);
          if (f.hasAnnotations) appendUserAnnotationContext();
          if (!f.filePath) {
            f.status = "error";
            f.reason = "Missing image path";
            if (msgAtt) msgAtt.status = "error";
            appendImageCaptionContext(`- ${f.name}: Image analysis failed: missing image path. Please honestly explain that you cannot see this image clearly right now.`);
            break;
          }
          if (imageSendStrategy.mode === "direct") {
            f.status = "done";
            if (msgAtt) msgAtt.status = "done";
            directImageAttachments.push({ name: f.name, filePath: f.filePath, mime: f.mime });
            appendDirectImageContext(`- ${f.name}: Image sent directly to main model with this message.`);
            break;
          }
          const result = await window.chat?.captionImage(f.filePath, f.hasAnnotations === true);
          if (result?.ok && result.caption) {
            f.status = "done";
            f.caption = result.caption;
            if (msgAtt) {
              msgAtt.status = "done";
              msgAtt.caption = result.caption;
            }
            appendImageCaptionContext(`- ${f.name}：${result.caption}`);
          } else {
            f.status = "error";
            f.reason = result?.error || "Image analysis failed";
            if (msgAtt) msgAtt.status = "error";
            appendImageCaptionContext(`- ${f.name}: Image analysis failed: ${f.reason}. Please honestly explain that you cannot see this image clearly right now.`);
          }
          break;
        }
        case "unsupported":
          hintsByKind.push(`⚠️ ${f.name} (Unsupported: ${f.reason || ""})`);
          break;
      }
    }
  } finally {
    if (shouldCaptionImages) hideTransientStatus();
  }
  if (budgetExceeded.length > 0) {
    hintsByKind.push(`⚠️ ${budgetExceeded.join(", ")} omitted part of content (exceeded turn budget)`);
  }
  if (hintsByKind.length > 0) {
    modelContextParts.unshift("[Files this turn]\n" + hintsByKind.join("\n"));
  }
  userMsg.modelContext = modelContextParts.join("\n\n");
  void saveSession();
  render();

  let streamMsgId = "";
  try {
    streamMsgId = String(Date.now() + 1);
    const streamMsg = { id: streamMsgId, role: "model", content: "", at: Date.now(), thinking: true, transient: true };
    messages.push(streamMsg);
    // Capture the complete turn only after both the user and assistant placeholder exist.
    // The message objects remain shared with the visible session while the array itself
    // cannot be replaced by a later session load.
    runMessages = [...messages];
    render();

    let streamContent = "";
    let ttsContent = "";
    let autoSpeakTriggered = false;
    const earlyMinimaxPlayback = createEarlyMinimaxPlayback();
    textMouthStarted = false;
    let pendingTtsCachePromise: Promise<{ cacheKey: string } | null> | null = null;
    let sticker: string | null = null;
    let pendingWeatherCard: Record<string, unknown> | null = null;
    let pendingMusicCard: MusicCardData | null = null;

    // Final signal: resolve triggered by RUN_FINISHED/RUN_ERROR in event stream,
    // does not rely on invoke resolve (invoke is only ack, may race with event delivery).
    let finishRun!: () => void;
    let failRun!: (err: Error) => void;
    const runDone = new Promise<void>((resolve, reject) => {
      finishRun = resolve;
      failRun = reject;
    });

    // AG-UI event stream: subscribe to window.agui.onEvent, render by event type
    // Main process sends all deltas after FC completes; renderer plays back at steady pace,
    // providing smooth streaming feel. Incremental span append + CSS fade-in, no full rebuild.
    const deltaQueue: string[] = [];
    let streamSession: StreamingMarkdownSession | null = null;
    let playbackTimer: number | null = null;
    let runFinishedArrived = false;
    let startNextStreamingBubble = false;
    let streamingBubbleCount = 1;
    const allowStreamingBubbleSplit = shouldSegmentAssistantReply(isChatMode() ? "chat" : "work", segmentedOutputMode);
    /** Find current streaming message bubble DOM (rendered once at TEXT_MESSAGE_START with data-msg-id). */
    const getStreamingBubble = (): HTMLElement | null => {
      return getLastBubbleForMessage(streamMsgId);
    };
    // Final condition: RUN_FINISHED received AND playback queue empty. finishRun when both met.
    const tryFinish = (): void => {
      if (runFinishedArrived && deltaQueue.length === 0 && playbackTimer === null) {
        finishRun();
      }
    };
    const startPlayback = (): void => {
      if (playbackTimer !== null) return;
      playbackTimer = window.setInterval(() => {
        const next = deltaQueue.shift();
        if (next !== undefined) {
          streamContent += next;
          // Incrementally append span to bubble with CSS fade-in. Avoid full render() stutter.
          const bubble = startNextStreamingBubble
            ? (appendBubbleForMessage(streamMsgId) ?? getStreamingBubble())
            : getStreamingBubble();
          startNextStreamingBubble = false;
          if (bubble) {
            if (!streamSession) {
              bubble.classList.add("is-streaming");
              streamSession = createStreamingMarkdownSession(getMd(), bubble, streamMsgId, messagesEl);
            }
            streamSession.append(next);
          }
          if (
            allowStreamingBubbleSplit
            && streamingBubbleCount < MAX_ASSISTANT_REPLY_BUBBLES
            && shouldBreakStreamingBubbleAfterChar(next)
          ) {
            startNextStreamingBubble = true;
            streamingBubbleCount += 1;
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        // Queue empty
        if (playbackTimer !== null) { clearInterval(playbackTimer); playbackTimer = null; }
        tryFinish();
      }, 40);
    };
    const offEvent = registerAguiListener((rawEvent) => {
      try {
        const event = rawEvent as AguiBaseEvent;
        const msg = runMessages.find(m => m.id === streamMsgId);
        switch (event.type) {
          case "TOOL_CALL_START": {
            // Tool call start: show "Calling: xxx" in thinking bubble, replacing three dots
            const bubble = getStreamingBubble();
            if (bubble) {
              bubble.classList.remove("msg__bubble--thinking");
              bubble.replaceChildren();
              const tip = document.createElement("div");
              tip.className = "msg__tool-tip";
              tip.dataset.toolCallId = event.toolCallId ?? "";
              const icon = document.createElement("span");
              icon.className = "msg__tool-icon";
              icon.textContent = "🔧";
              const text = document.createElement("span");
              text.className = "msg__tool-text";
              text.textContent = "Calling: " + (event.toolCallName ?? "tool");
              tip.appendChild(icon);
              tip.appendChild(text);
              bubble.appendChild(tip);
            }
            break;
          }
          case "TOOL_CALL_END": {
            // Tool call finished: change status to Completed, fade out to make room for text
            const bubble = getStreamingBubble();
            if (bubble) {
              const tip = bubble.querySelector(".msg__tool-tip");
              if (tip) {
                const textEl = tip.querySelector(".msg__tool-text");
                if (textEl) textEl.textContent = "Completed";
                tip.classList.add("msg__tool-tip--done");
              }
            }
            break;
          }
          case "TEXT_MESSAGE_START":
            // Switch thinking dots → empty bubble, render once to establish DOM (with data-msg-id)
            // Tool notice (if any) cleared by render rebuild, transitioning naturally to text
            if (msg) { msg.thinking = false; render(); }
            break;
          case "TEXT_MESSAGE_CONTENT":
            if (event.delta) {
              ttsContent += event.delta;
              earlyMinimaxPlayback.append(ttsContent);
              deltaQueue.push(...Array.from(event.delta));
              if (!textMouthStarted) {
                void loadTtsSettings().then((settings) => {
                  if (settings && !settings.ttsAutoRead) {
                    startTextModeMouth();
                  }
                });
              }
              if (msg) { msg.thinking = false; }
              startPlayback();
            }
            break;
          case "TEXT_MESSAGE_END":
            // When all text deltas received, ttsContent is fully accumulated; streamContent replays at 40ms.
            // This allows audio to start early, independent of frontend typing animation queue.
            if (!autoSpeakTriggered && ttsContent.trim()) {
              autoSpeakTriggered = true;
              pendingTtsCachePromise = earlyMinimaxPlayback.finish(ttsContent);
            }
            break;
          case "CUSTOM":
            // Custom events sent by main: sticker / weather card / task list / choice card
            if (event.name === "cyrene.sticker") {
              sticker = (event.value as StickerId | null) ?? null;
            } else if (event.name === "cyrene.weather") {
              // Buffer weather data, insert after runDone render (avoids replaceChildren wiping card)
              console.log("[Chat] Received weather card data:", JSON.stringify(event.value)?.slice(0, 100));
              pendingWeatherCard = event.value as Record<string, unknown>;
            } else if (event.name === "cyrene.music") {
              pendingMusicCard = normalizeMusicCardData(event.value);
            } else if (event.name === "cyrene.todos") {
              renderTodoPanel(event.value as TodoState | null);
            } else if (event.name === "cyrene.choice") {
              // Choice card: insert immediately into chat stream (no wait for runDone for interactive response)
              const choiceData = event.value;
              const card = isAskClarificationCard(choiceData)
                ? buildAskClarificationCardEl(choiceData)
                : buildChoiceCardEl(choiceData as {
                    id: string;
                    question: string;
                    options: Array<{ label: string; value: string; description?: string }>;
                    default?: string;
                  });
              messagesEl.appendChild(card);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (event.name === "cyrene.taskPlan") {
              renderPlanCard(event.value);
            }
            break;
          case "RUN_FINISHED":
            // Final signal received, but wait for playback queue to drain before finishRun (ensures stream completes)
            runFinishedArrived = true;
            tryFinish();
            break;
          case "RUN_ERROR":
            failRun(new AgentRenderError(event.code, event.message ?? "Model request failed"));
            break;
          default:
            // TOOL_CALL_* / STEP_* not handled in UI for now (scaffolding stage)
            break;
        }
      } catch (err) {
        console.error("[Chat] onEvent callback threw error:", err);
      }
    });

    // invoke only confirms initiation, does not wait for Observable termination.
    // True completion is driven by RUN_FINISHED/RUN_ERROR event stream (await runDone).
    const modelMessages = buildModelMessages();
    const ack = await window.agui!.run({
      messages: modelMessages,
      userTurnId: userMsg.id,
      assistantTurnId: streamMsgId,
      styleId: getCurrentStyleId(),
      executionMode: isChatMode() ? "chat" : "work",
      sessionId: runSessionId || undefined,
      imageAttachments: directImageAttachments.length > 0 ? directImageAttachments : undefined,
    });
    if (!ack.success) {
      throw new Error(ack.error || "Failed to initiate model request");
    }
    if (clearModelContexts() && runSessionId && window.chatStore) {
      void window.chatStore.replaceTail(runSessionId, runTailStart, toPersistableMessages(runMessages));
    }

    // AG-UI watchdog timer (180s) to prevent indefinite hang if completion events drop
    let watchdogTimer: any = null;
    const watchdogPromise = new Promise<never>((_, reject) => {
      watchdogTimer = setTimeout(() => {
        reject(new Error("Stream connection timed out waiting for completion signal (180s watchdog)"));
        void window.agui?.cancel?.().catch((cancelErr) => {
          console.warn("[Cyrene Chat] Failed to cancel AG-UI run on watchdog timeout:", cancelErr);
        });
      }, 180000);
    });

    try {
      await Promise.race([runDone, watchdogPromise]);
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      offEvent();
      if (playbackTimer !== null) { clearInterval(playbackTimer); playbackTimer = null; }
      if (streamSession) {
        streamSession.flush();
        streamSession.dispose();
        streamSession = null;
      }
    }

    const msg = runMessages.find(m => m.id === streamMsgId);
    if (msg) {
      msg.thinking = false;
      msg.transient = false;
      msg.content = streamContent;
      msg.sticker = sticker;
      msg.musicCard = pendingMusicCard ?? undefined;
    }
    if (runSessionId && window.chatStore) {
      void window.chatStore.replaceTail(runSessionId, runTailStart, toPersistableMessages(runMessages));
    }
    const finishedMsgId = streamMsgId;
    void pendingTtsCachePromise?.then((cache) => {
      if (!cache) return;
      const latestMsg = runMessages.find(m => m.id === finishedMsgId);
      if (!latestMsg) return;
      latestMsg.ttsCacheKey = cache.cacheKey;
      if (runSessionId && window.chatStore) {
        void window.chatStore.replaceTail(runSessionId, runTailStart, toPersistableMessages(runMessages));
      }
    });

    // DOM isolation: only update visible stream bubble if still viewing this exact session
    if (currentSessionId === runSessionId) {
      finalizeStreamingBubble(streamMsgId, streamContent);
    }

    // Append weather card to the end (after model reply)
    if (pendingWeatherCard) {
      console.log("[Chat] Inserted weather card");
      const card = buildWeatherCardEl(pendingWeatherCard);
      messagesEl.appendChild(card);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      pendingWeatherCard = null;
    }
    // TTS already triggered on TEXT_MESSAGE_END, no duplicate playback here
  } catch (err) {
    const message = err instanceof Error ? err.message : "Model request failed";
    const code = err instanceof AgentRenderError ? err.code : undefined;
    const userMessage = classifyAgentError(code, message);
    const msg = runMessages.find(m => m.id === streamMsgId);
    if (msg) {
      msg.thinking = false;
      msg.transient = false;
      msg.content = userMessage;
    } else {
      runMessages.push({
        id: String(Date.now() + 2),
        role: "model",
        content: userMessage,
        at: Date.now(),
      });
    }
    if (runSessionId && window.chatStore) {
      void window.chatStore.replaceTail(runSessionId, runTailStart, toPersistableMessages(runMessages));
    }
    // Use single-bubble upgrade on error, avoiding full render()
    if (currentSessionId === runSessionId) {
      finalizeStreamingBubble(streamMsgId, userMessage);
    }
  } finally {
    sending = false;
    sendBtn.disabled = false;
    chatHintEl.textContent = formatModelHint(currentModelConfig);
    inputEl.focus();
    void flushPendingProactiveReload();
  }
}
async function clearChat(): Promise<void> {
  if (sending) return;
  if (messages.length === 0 && sessionTailStart === 0) return;
  const ok = await showConfirm({
    title: "Clear Conversation",
    message: "Clear current conversation? This cannot be undone.",
    confirmText: "Clear",
    cancelText: "Cancel",
    icon: "🗑️",
    danger: true,
  });
  if (!ok) return;
  if (currentSessionId && window.chatStore) {
    try {
      const success = await window.chatStore.replaceTail(currentSessionId, 0, []);
      if (!success) {
        await showAlert({
          title: "Storage Error",
          message: "Failed to clear chat on disk. Storage operation was unsuccessful.",
          icon: "⚠️",
        });
        return;
      }
    } catch (err) {
      console.warn("[Cyrene Chat] clearChat failed:", err);
      await showAlert({
        title: "Storage Error",
        message: "Failed to clear chat on disk. Please try again.",
        icon: "⚠️",
      });
      return;
    }
  }
  messages.length = 0;
  sessionTailStart = 0;
  render();
}

/* ===== Window controls ===== */
minBtn.addEventListener("click", () => {
  window.chat?.minimize();
});
maxBtn.addEventListener("click", () => {
  window.chat?.toggleMaximize();
});
closeBtn.addEventListener("click", () => {
  window.chat?.close();
});
clearBtn?.addEventListener("click", () => {
  void clearChat();
});

/* ===== Composer ===== */
formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  void send();
});

inputEl.addEventListener("input", autosize);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
});


/* ===== File upload ===== */
const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
const attachBtn = document.getElementById("attach-btn") as HTMLButtonElement | null;
const screenshotBtn = document.getElementById("screenshot-btn") as HTMLButtonElement | null;
let attachedFiles: Attachment[] = [];
	
// ── Path-based File Ingestion ──
// Path extracted in preload (webUtils.getPathForFile); renderer never touches Electron API.
async function ingestDroppedFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  attachBtn!.disabled = true;
  try {
    const results = await window.chat!.ingestDroppedFiles(files);
    if (results && results.length > 0) attachedFiles = [...attachedFiles, ...results];
    updateFileTags();
  } catch (err: unknown) {
    await showAlert({
      title: "File Ingestion Failed",
      message: "File ingestion failed: " + ((err as Error)?.message || String(err)),
      icon: "⚠️",
    });
  } finally {
    attachBtn!.disabled = false;
    fileInput!.value = "";
  }
}
	
	function updateFileTags(): void {
	  const container = document.getElementById("file-tags");
	  if (!container) return;
	  container.innerHTML = "";
	  if (attachedFiles.length === 0) {
	    attachBtn?.classList.remove("has-file");
	    return;
	  }
	  attachBtn?.classList.add("has-file");
	  attachedFiles.forEach((f, i) => {
	    const tag = document.createElement("div");
	    tag.className = "chat__file-tag";
	    if (f.kind === "image" && f.previewUrl) {
	      const preview = document.createElement("img");
	      preview.className = "chat__file-tag-preview";
	      preview.src = f.previewUrl;
	      preview.alt = f.name;
	      tag.appendChild(preview);
	    }
	    const label = document.createElement("span");
	    const icon = getAttachmentIcon(f.kind);
	    const detail = formatAttachmentTagDetail(f);
	    label.textContent = `${icon} ${f.name} ${detail}`;
	    const btn = document.createElement("button");
	    btn.type = "button";
	    btn.className = "file-tag-remove";
	    btn.textContent = "×";
	    btn.addEventListener("click", () => {
	      attachedFiles.splice(i, 1);
	      updateFileTags();
	    });
	    tag.appendChild(label);
	    tag.appendChild(btn);
	    container.appendChild(tag);
	  });
	}
	
	attachBtn?.addEventListener("click", () => {
	  fileInput?.click();
	});
	
	fileInput?.addEventListener("change", () => {
	  if (fileInput.files && fileInput.files.length > 0) {
	    void ingestDroppedFiles(Array.from(fileInput.files));
	  }
	});

/* ===== Screenshot ===== */

/** Unified image attachment insertion (shared by paste and screenshot buttons) */
async function insertImageAttachment(input: {
  base64?: string;
  mime: string;
  filePath?: string;
  previewUrl?: string;
  name?: string;
  hasAnnotations?: boolean;
}): Promise<void> {
  const filePath = input.filePath
    ?? (input.base64
      ? (await window.chat?.saveScreenshotTemp(input.base64, input.mime))?.filePath
      : undefined);
  if (!filePath) throw new Error("SCREENSHOT_FILE_PATH_REQUIRED");

  attachedFiles.push({
    kind: "image",
    name: input.name ?? `Screenshot_${Date.now()}.png`,
    filePath,
    mime: input.mime,
    previewUrl: input.base64
      ? `data:${input.mime};base64,${input.base64}`
      : input.previewUrl,
    hasAnnotations: input.hasAnnotations,
    status: "pending",
  });
  updateFileTags();
}

const screenshotStatus = document.getElementById("screenshot-status");

function announceScreenshotStatus(message: string): void {
  if (screenshotStatus) screenshotStatus.textContent = message;
}

// Screenshot button -> native region selection, then direct attachment insertion.
screenshotBtn?.addEventListener("click", async () => {
  if (!window.chat || screenshotBtn.disabled) return;
  screenshotBtn.disabled = true;
  screenshotBtn.setAttribute("aria-busy", "true");
  announceScreenshotStatus("Screen region capture opened. Select a window or drag across any screen region, or press Escape to cancel.");
  try {
    const result = await window.chat.startScreenshot();
    if (!result?.ok) {
      const cancelled = result?.reason?.toLowerCase().includes("cancel");
      announceScreenshotStatus(cancelled
        ? "Screen capture cancelled."
        : "Screen capture failed. Please try again.");
    }
  } catch {
    announceScreenshotStatus("Screen capture failed. Please try again.");
  } finally {
    screenshotBtn.disabled = false;
    screenshotBtn.removeAttribute("aria-busy");
    screenshotBtn.focus();
  }
});

// Button mode callback: main process sends cropped image directly
window.chat?.onScreenshotInsert?.((data) => {
  void insertImageAttachment({
    mime: data.mime,
    filePath: data.filePath,
    previewUrl: data.previewUrl,
    hasAnnotations: data.hasAnnotations,
    name: `Screenshot_${Date.now()}.png`,
  });
  announceScreenshotStatus("Screenshot attached and ready to send.");
  screenshotBtn?.focus();
});
const cowatchBtn = document.getElementById("cowatch-btn") as HTMLButtonElement | null;

async function handleCoWatchToggle(): Promise<void> {
  if (!window.chat) return;
  try {
    await window.chat.toggleCoWatch?.();
  } catch (err) {
    console.error("[CoWatch] Toggle failed:", err);
  }
}

cowatchBtn?.addEventListener("click", () => void handleCoWatchToggle());

window.chat?.onCoWatchStateChanged?.((state) => {
  if (cowatchBtn) {
    if (state.active) {
      cowatchBtn.classList.add("cowatch-btn--recording");
      const statusLabel = state.status === "capturing"
        ? "Capturing..."
        : state.status === "analyzing"
        ? "Thinking..."
        : "Watching";
      cowatchBtn.title = `🔴 Co-Watching Active (${statusLabel}) · Click or Alt+G to stop`;
      announceScreenshotStatus(`Co-Watch recording mode active 🔴 (${statusLabel}). Cyrene is watching with you in background!`);
    } else {
      cowatchBtn.classList.remove("cowatch-btn--recording");
      cowatchBtn.title = "🎬 Watch Together / Co-Watch Record Mode (Alt+G)";
      announceScreenshotStatus("Co-Watch recording mode stopped.");
    }
  }
});

window.chat?.onCoWatchTriggerObservation?.((data) => {
  // Co-Watch is now fully ambient: captures and observations are processed in the background
  // and delivered directly via Live2D speech bubble and Activity Log without hijacking the chat composer.
  if (data?.filePath) {
    announceScreenshotStatus("Co-Watch screen captured in background!");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === "w" || e.key === "W" || e.key === "g" || e.key === "G")) {
    e.preventDefault();
    void handleCoWatchToggle();
  }
});


// Paste listener: detect clipboard image -> attach (hotkey mode: Alt+Shift+S then Ctrl+V)
document.addEventListener("paste", async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        if (!base64) return;
        try {
          await insertImageAttachment({ base64, mime: blob.type || "image/png" });
        } catch (err) {
          console.error("[Chat] Failed to paste image:", err);
        }
      };
      reader.readAsDataURL(blob);
      break; // Only process first image
    }
  }
});
	
	function removeAttachedFiles(): void {
	  attachedFiles = [];
	  attachBtn?.classList.remove("has-file");
	  const container = document.getElementById("file-tags");
	  if (container) container.innerHTML = "";
	}

/* ===== Drag & drop ===== */
const chatEl = document.querySelector(".chat") as HTMLElement | null;
let dragCounter = 0;

document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCounter += 1;
  chatEl?.classList.add("chat--drag-over");
});

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCounter -= 1;
  if (dragCounter <= 0) {
    dragCounter = 0;
    chatEl?.classList.remove("chat--drag-over");
  }
});

document.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragCounter = 0;
  chatEl?.classList.remove("chat--drag-over");
  // path-based: pass dataTransfer.files directly to ingestDroppedFiles,
  // main process checks fs.statSync to recursively expand files/folders.
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    void ingestDroppedFiles(Array.from(files));
  }
});



/* ===== Work / Chat switch + style / reasoning dropdowns ===== */
(function() {
  var triggers = document.querySelectorAll(".dropdown-trigger");
  var modeOptions = document.querySelectorAll(".mode-switch__option");
  var menus = {
    "style-dropdown": document.getElementById("style-dropdown"),
    "reasoning-dropdown": document.getElementById("reasoning-dropdown")
  };
  var values = {
    "style-dropdown": document.getElementById("style-val"),
    "reasoning-dropdown": document.getElementById("reasoning-val")
  };

  function selectModeOption(value) {
    const normalized = normalizeDefaultChatMode(value);
    modeOptions.forEach(function(option) {
      const active = (option as HTMLElement).dataset.modeValue === normalized;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  modeOptions.forEach(function(option) {
    option.addEventListener("click", function() {
      selectModeOption((option as HTMLElement).dataset.modeValue);
    });
  });

  // Close all dropdowns
  function closeAll() {
    triggers.forEach(function(t) { t.classList.remove("is-open"); });
    Object.keys(menus).forEach(function(k) {
      if (menus[k]) menus[k].classList.remove("is-open");
    });
  }

  // Open a specific dropdown
  function openDropdown(id, trigger) {
    var menu = menus[id];
    if (!menu) return;
    var rect = trigger.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = rect.left + "px";
    menu.classList.add("is-open");
    trigger.classList.add("is-open");
  }

  function selectDropdownOption(id, value) {
    var menu = menus[id];
    if (!menu) return;
    var target = menu.querySelector('.dm-opt[data-value="' + value + '"]');
    if (!target) return;
    menu.querySelectorAll(".dm-opt").forEach(function(o) { o.classList.remove("is-active"); });
    target.classList.add("is-active");
    var val = values[id];
    if (val) val.textContent = target.textContent?.trim() || "";
  }

  // Trigger click
  triggers.forEach(function(t) {
    t.addEventListener("click", function(e) {
      e.stopPropagation();
      var id = t.getAttribute("data-dropdown");
      var isOpen = t.classList.contains("is-open");
      closeAll();
      if (!isOpen) openDropdown(id, t);
    });
  });

  // Option click
  Object.keys(menus).forEach(function(id) {
    var menu = menus[id];
    if (!menu) return;
    menu.querySelectorAll(".dm-opt").forEach(function(opt) {
      opt.addEventListener("click", function() {
        selectDropdownOption(id, opt.getAttribute("data-value"));
        if (id === "style-dropdown") {
          const styleId = normalizeStyleId(opt.getAttribute("data-value"));
          void window.settings?.saveGeneral?.({ currentStyleId: styleId });
        }
        closeAll();
      });
    });
  });

  // ── Reasoning Dropdown: Dynamic Generation ──────────────────────────────
  let reasoningDropdownActive = false;
  let reasoningProviderKey = "";
  let reasoningDropdownDisabled = false;
  let reasoningActivePreference: unknown = null;

  async function rebuildReasoningDropdown() {
    try {
      const state = await window.chat!.getReasoningState() as {
        providerKey: string; providerId: string; model: string;
        preference?: { mode: string; effort?: string };
      };
      reasoningProviderKey = state.providerKey;
      // Dynamic import pure functions (runnable after vite tree-shake)
      const { computeReasoningDropdown, formatReasoningTriggerLabel } = await import("./reasoning-dropdown");
      const view = computeReasoningDropdown(state.providerId, state.model, state.preference);
      reasoningDropdownDisabled = view.disabled;
      reasoningActivePreference = view.activePreference;

      // Populate dropdown items
      const menu = menus["reasoning-dropdown"];
      if (!menu) return;
      // Keep dm-title, clear all subsequent dm-opt
      const title = menu.querySelector(".dm-title");
      menu.replaceChildren();
      if (title) menu.appendChild(title);

      for (const item of view.items) {
        const opt = document.createElement("div");
        opt.className = "dm-opt";
        opt.dataset.reasoningPreference = JSON.stringify(item.preference);
        opt.textContent = item.label;
        if (item.disabled) {
          opt.classList.add("is-disabled");
          opt.style.opacity = "0.4";
          opt.style.pointerEvents = "none";
        }
        if (item.hint) opt.title = item.hint;
        // Currently selected
        if (JSON.stringify(item.preference) === JSON.stringify(view.activePreference)) {
          opt.classList.add("is-active");
        }
        // Disabled items do not bind click
        if (item.disabled) {
          opt.addEventListener("click", (e) => e.stopPropagation());
        } else {
          opt.addEventListener("click", () => {
            if (!window.chat) return;
            window.chat.setReasoning({
              providerKey: reasoningProviderKey,
              preference: item.preference,
            }).then(() => {
              reasoningActivePreference = item.preference;
              menu.querySelectorAll(".dm-opt").forEach(o => o.classList.remove("is-active"));
              opt.classList.add("is-active");
              const val = values["reasoning-dropdown"];
              if (val) val.textContent = item.label;
              closeAll();
            }).catch(() => {});
          });
        }
        menu.appendChild(opt);
      }

      // Update trigger button text
      const val = values["reasoning-dropdown"];
      if (val && view.statusText) {
        val.textContent = view.statusText;
        // dm-title hidden when dropdown is active (view controls visualization)
        const title2 = menu.querySelector(".dm-title") as HTMLElement | null;
        if (title2) title2.style.display = "";
      }
      if (reasoningTrigger) {
        reasoningTrigger.title = view.disabled
          ? "Reasoning control is not supported by the current model"
          : "Select Reasoning Mode";
      }
      reasoningDropdownActive = true;
    } catch {
      // Failedplaceholder（ #4）： disabled ""
      reasoningDropdownDisabled = true;
      reasoningDropdownActive = false;
      const menu = menus["reasoning-dropdown"];
      if (menu) {
        const title = menu.querySelector(".dm-title");
        menu.replaceChildren();
        if (title) menu.appendChild(title);
        const opt = document.createElement("div");
        opt.className = "dm-opt is-disabled";
        opt.textContent = "Default";
        opt.style.opacity = "0.4";
        opt.style.pointerEvents = "none";
        opt.title = "Reasoning control is temporarily unavailable";
        menu.appendChild(opt);
      }
      const val = values["reasoning-dropdown"];
      if (val) val.textContent = "Default";
      if (reasoningTrigger) {
        reasoningTrigger.title = "Reasoning control is temporarily unavailable";
      }
    }
  }

  // Initial load
  void rebuildReasoningDropdown();

  // Re-render on trigger click (model might have changed)
  const reasoningTrigger = document.querySelector<HTMLElement>('.dropdown-trigger[data-dropdown="reasoning-dropdown"]');
  if (reasoningTrigger) {
    reasoningTrigger.addEventListener("click", async (e) => {
      if (reasoningDropdownDisabled) {
        e.stopImmediatePropagation(); // Prevent original handler from opening dropdown when control is disabled
        chatHintEl.textContent = "Reasoning control is not supported by the current model";
        setTimeout(() => {
          chatHintEl.textContent = formatModelHint(currentModelConfig);
        }, 3000);
        return;
      }
      await rebuildReasoningDropdown();
      // Do not prevent original handler: handler will closeAll() + openDropdown(id, t)
    }, true); // capture phase: executed before original handler (bubble registration)
  }

  void window.chat?.getGeneralSettings?.()
    .then(function(settings) {
      selectModeOption(settings?.defaultChatMode);
      selectDropdownOption("style-dropdown", normalizeStyleId(settings?.currentStyleId));
      segmentedOutputMode = settings?.segmentedOutputMode === "chat" || settings?.segmentedOutputMode === "off"
        ? settings.segmentedOutputMode
        : settings?.segmentedOutputMode === "all" ? "all" : "off";
      render(true);
    })
    .catch(function() {
      selectModeOption("work");
      segmentedOutputMode = "off";
      render(true);
    });

  // Click outside closes
  document.addEventListener("click", closeAll);
})();


/* ===== Floating particles (dreamy pink motes) =====
   Renders slowly floating pink/violet particles at the bottom of the .chat container, matching the theme.
   Matching theme with twinkling effect. Canvas is absolute positioned with pointer-events: none,
   ensuring it does not interfere with input, clicks, or scrolling. */
interface Particle {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  hue: number;
  alpha: number;
  twinkle: number;
  twinkleSpeed: number;
}

const PARTICLE_COUNT = 38;
const PARTICLE_HUE_MIN = 305; // pink
const PARTICLE_HUE_MAX = 345; // violet

const particlesCanvas = document.getElementById("particles") as HTMLCanvasElement | null;
const particlesCtx = particlesCanvas ? particlesCanvas.getContext("2d") : null;
let particles: Particle[] = [];
let particlesDpr = 1;
let particlesW = 0;
let particlesH = 0;
let particlesRaf: number | null = null;

function spawnParticle(): Particle {
  return {
    x: Math.random() * particlesW,
    y: Math.random() * particlesH,
    size: 0.6 + Math.random() * 2.4,
    vx: (Math.random() - 0.5) * 0.18,
    vy: -0.05 - Math.random() * 0.22,
    hue: PARTICLE_HUE_MIN + Math.random() * (PARTICLE_HUE_MAX - PARTICLE_HUE_MIN),
    alpha: 0.25 + Math.random() * 0.5,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.005 + Math.random() * 0.012,
  };
}

function resizeParticles(): void {
  if (!particlesCanvas || !particlesCtx) return;
  const rect = particlesCanvas.getBoundingClientRect();
  particlesDpr = window.devicePixelRatio || 1;
  particlesW = rect.width;
  particlesH = rect.height;
  particlesCanvas.width = Math.max(1, Math.round(rect.width * particlesDpr));
  particlesCanvas.height = Math.max(1, Math.round(rect.height * particlesDpr));
  particlesCtx.setTransform(particlesDpr, 0, 0, particlesDpr, 0, 0);
}

function drawParticles(): void {
  if (!particlesCtx) return;
  particlesCtx.clearRect(0, 0, particlesW, particlesH);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.twinkle += p.twinkleSpeed;
    if (p.y < -10) {
      p.y = particlesH + 10;
      p.x = Math.random() * particlesW;
    }
    if (p.x < -10) p.x = particlesW + 10;
    if (p.x > particlesW + 10) p.x = -10;

    const flicker = 0.65 + Math.sin(p.twinkle) * 0.35;
    const a = p.alpha * flicker;
    const r = p.size * 3;
    const grad = particlesCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, `hsla(${p.hue}, 90%, 80%, ${a})`);
    grad.addColorStop(0.5, `hsla(${p.hue}, 90%, 70%, ${a * 0.4})`);
    grad.addColorStop(1, `hsla(${p.hue}, 90%, 70%, 0)`);
    particlesCtx.fillStyle = grad;
    particlesCtx.beginPath();
    particlesCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    particlesCtx.fill();
  }
  particlesRaf = requestAnimationFrame(drawParticles);
}

if (particlesCtx) {
  resizeParticles();
  particles = Array.from({ length: PARTICLE_COUNT }, spawnParticle);
  particlesRaf = requestAnimationFrame(drawParticles);
  window.addEventListener("resize", resizeParticles);
}


// Startup: migrate legacy localStorage → select session → render
// Fetch user sticker catalog to memory before bootstrap rendering history messages — otherwise
// pure sticker messages (bubbles hidden) would render blank before enabledStickers finishes loading.
void (async () => {
  await loadEnabledStickers();
  await bootstrap();
  buildQuickPresets();
  installSchedulerEventListener();
  void initModelConfig();
})();

window.addEventListener("beforeunload", () => {
  for (const off of [...activeAguiOffs]) off();
  schedulerEventsOff?.();
  schedulerEventsOff = null;
  stopCurrentTts();
  if (particlesRaf !== null) cancelAnimationFrame(particlesRaf);
  particlesRaf = null;
  window.removeEventListener("resize", resizeParticles);
});

// Preserved pending permission requests across render() calls
const pendingPermissionRequests = new Map<string, any>();

window.settings?.onPermissionApprovalRequest?.((req) => {
  console.log("[Cyrene/Chat] permission approval request:", req.id, req.toolId);
  pendingPermissionRequests.set(req.id, req);
  const card = buildApprovalCardEl(req);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// main → renderer: Switch window to specified session when clicked in Settings panel / New Chat
window.chatStore?.onSwitchSession(async (sessionId) => {
  if (!window.chatStore) return;
  if (sending) {
    console.warn("[Cyrene Chat] Session switch deferred: active generation in progress");
    return;
  }
  if (sessionId === currentSessionId) return;
  const session = await window.chatStore.get(sessionId);
  if (session) loadSessionIntoUI(session);
});

// Main broadcast on any session change — two handlers:
// 1. Current active session deleted externally → fallback to latest / create new
// 2. Refresh list when sidebar expands (triggered on create/rename/delete in other windows)
window.chatStore?.onChanged(async () => {
  if (!window.chatStore || !currentSessionId) return;
  const sessions = await window.chatStore.list();
  for (const session of sessions) {
    const seenAt = seenSessionUpdatedAt.get(session.id) ?? 0;
    if (session.purpose === "proactive-chat" && session.id !== currentSessionId && session.updatedAt > seenAt) {
      unreadProactiveSessionIds.add(session.id);
    }
  }
  // Mark unread before refresh to ensure unread indicator appears immediately.
  if (chatRail && !chatRail.hidden) void renderRailList();
  const stillExists = await window.chatStore.get(currentSessionId);
  if (stillExists) {
    const decision = decideReloadCurrentSession({
      purpose: stillExists.purpose,
      updatedAt: stillExists.updatedAt,
      seenAt: seenSessionUpdatedAt.get(stillExists.id) ?? 0,
      sending,
    });
    if (decision === "reload") {
      await loadSessionTailIntoUI(stillExists.id);
    } else if (decision === "defer") {
      // External changes during sending: queue and flush after sending finishes (see finally blocks).
      pendingProactiveReloadId = stillExists.id;
    }
    return;
  }
  // Current session was deleted externally: fallback to latest / create new
  const list = sessions;
  let next: ChatStoreSession | null = null;
  if (list.length > 0) next = await window.chatStore.get(list[0].id);
  if (!next) next = await window.chatStore.create({ identityId: null });
  if (next) loadSessionIntoUI(next);
});
autosize();
inputEl.focus();

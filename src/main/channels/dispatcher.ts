// channels/dispatcher - Inbound message processing core.
//
// Design principles:
//   - Agnostic of concrete platforms. Platform information is used only to resolve adapters, log, and construct sessionId.
//   - Completely side-effect-free: UI broadcasting, memory storage, and sticker inference are performed via external callbacks.
//   - Session ID generation rule:
//     `channel:<channel>:<sha256(channel:senderId).slice(0,16)>`
//     Prefix prevents cross-platform ID collisions; 16-character hash saves space and protects privacy.
//   - Capability degradation:
//     Translates OutgoingMessage according to target channel capability:
//     image -> text description / card -> markdown / sticker skipped if unsupported.
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import type {
  ChannelCapability,
  ChannelId,
  IncomingMessage,
  OutgoingMessage,
  OutgoingPart,
} from "./types";
import { channelManager, type ChannelManager } from "./manager";
import { loadChannelsSettings, type ChannelsSettings } from "./settings-store";
import { appendLog, reloadLogFromDisk } from "./message-log";
import { appendHistory as appendChannelHistory } from "./history-log";
import { resolveLocalStickerPath } from "../sticker-protocol";
import { getStickersDir, loadUserStickerManifest } from "../sticker-storage";
import { BUILT_IN_STICKER_FILES } from "../sticker-descriptions";
import { BUILT_IN_STICKER_IDS } from "../../shared/sticker-types";
import { splitTextBySentenceBreaks } from "../../shared/message-segmentation";
import {
  normalizeMobileMessageSegmentationMode,
  type MobileMessageSegmentationMode,
} from "../../shared/preferences";
import { rememberProactiveChannelRecipient } from "./proactive-delivery";

/** Lightweight ChatMessage shape for conversation history (compatible with orchestrator ChatMessage). */
interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
}

type TtsAudioFormat = "mp3" | "wav" | "pcm";

interface DispatcherTtsContext {
  channel: ChannelId;
}

interface DispatcherTtsResult {
  audio: Buffer;
  format: TtsAudioFormat;
  mime: string;
  extension: ".mp3" | ".wav" | ".pcm";
}

const LOG = "[ChannelDispatcher]";

/** Session ID cache (for deduplication / debugging / capacity management) */
const sessionIndex = new Map<string, { channel: ChannelId; senderId: string; lastAt: number }>();

/** Rate limiter: maximum N messages per minute per user */
class RateLimiter {
  private buckets = new Map<string, number[]>(); // key = channel:senderId -> timestamp[]
  constructor(private settings: ChannelsSettings) {}

  /** Check and record a hit. Returns true = allowed; false = rate limit exceeded. */
  hit(channel: ChannelId, senderId: string): boolean {
    const key = `${channel}:${senderId}`;
    const now = Date.now();
    const arr = this.buckets.get(key) ?? [];
    // Prune entries older than 60s
    const fresh = arr.filter((t) => now - t < 60_000);
    if (fresh.length >= this.settings.rateLimitPerUser) {
      this.buckets.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.buckets.set(key, fresh);

    // Channel-level global rate limiting
    const chKey = `__channel__:${channel}`;
    const chArr = this.buckets.get(chKey) ?? [];
    const chFresh = chArr.filter((t) => now - t < 60_000);
    if (chFresh.length >= this.settings.rateLimitPerChannel) {
      this.buckets.set(chKey, chFresh);
      return false;
    }
    chFresh.push(now);
    this.buckets.set(chKey, chFresh);

    return true;
  }

  /** Reset all rate-limiting buckets (used in tests) */
  reset(): void {
    this.buckets.clear();
  }
}

/** Computes a stable, anonymous sessionId. */
export function makeSessionId(channel: ChannelId, senderId: string): string {
  const hash = createHash("sha256")
    .update(`${channel}:${senderId}`)
    .digest("hex")
    .slice(0, 16);
  return `channel:${channel}:${hash}`;
}

/** Records sessionId -> original senderId (for debugging; does not affect runtime) */
function recordSession(channel: ChannelId, senderId: string, sessionId: string): void {
  sessionIndex.set(sessionId, { channel, senderId, lastAt: Date.now() });
  // Capacity management: evict oldest entry if size exceeds 5000 (approximate LRU)
  if (sessionIndex.size > 5000) {
    const oldest = [...sessionIndex.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
    if (oldest) sessionIndex.delete(oldest[0]);
  }
}

/** Reverse-lookups original senderId from sessionId. */
export function lookupOriginalSender(sessionId: string): { channel: ChannelId; senderId: string } | null {
  const entry = sessionIndex.get(sessionId);
  return entry ? { channel: entry.channel, senderId: entry.senderId } : null;
}

/**
 * Resolves a sticker ID to an absolute local filesystem path.
 *
 * - Built-in stickers (BUILT_IN_STICKER_IDS): resolved from public/stickers/<file>
 * - User stickers: resolved from userData/stickers/<file> via manifest
 * - Returns null if file not found or path traversal detected
 */
export function resolveStickerImagePath(stickerId: string): string | null {
  if (!stickerId) return null;

  // Built-in sticker: map using BUILT_IN_STICKER_FILES to public directory
  if ((BUILT_IN_STICKER_IDS as readonly string[]).includes(stickerId)) {
    const file = BUILT_IN_STICKER_FILES[stickerId];
    if (!file) return null;
    const appPath = app.getAppPath();
    // Prefer built production path, fallback to dev path
    const candidates = [
      path.join(appPath, "dist", "renderer", "stickers", file),
      path.join(appPath, "src", "renderer", "public", "stickers", file),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  // User sticker: retrieve file field from manifest and resolve safely
  const manifest = loadUserStickerManifest();
  const meta = manifest[stickerId];
  if (!meta) return null;
  return resolveLocalStickerPath(getStickersDir(), meta.file);
}

/** Dispatcher dependencies (dependency injection). */
export interface DispatcherDeps {
  manager: ChannelManager;
  /** Desktop chatWindow for mirrored display (optional) */
  getChatWindow?: () => { webContents: { isDestroyed(): boolean; send: (channel: string, ...args: unknown[]) => void }; isDestroyed(): boolean } | null;
  /** Full agent execution callback. Returns reply text and optional sticker ID. */
  buildAndRunAgent?: (msg: IncomingMessage, sessionId: string, priorMessages?: ChatMessage[]) => Promise<{ text: string; sticker: string | null }>;
  /** Reads recent N messages from conversation history for this sessionId. */
  loadRecentChannelHistory?: (sessionId: string, limit: number) => Promise<ChatMessage[]>;
  /** Synthesizes text to audio buffer. Returns null on failure. */
  synthesizeTts?: (text: string, context: DispatcherTtsContext) => Promise<Buffer | DispatcherTtsResult | null>;
  /** Notifies desktop chatWindow of inbound/outbound bot messages. */
  broadcastChat?: (event: {
    type: "bot:incoming" | "bot:outgoing";
    channel: string;
    senderId: string;
    senderName?: string;
    chatId: string;
    text: string;
    at: number;
  }) => void;
  /** Reads general application preferences. */
  loadGeneralSettings?: () => { mobileMessageSegmentation?: MobileMessageSegmentationMode };
}

export function buildTextOutgoingParts(
  replyText: string,
  mobileMessageSegmentation: MobileMessageSegmentationMode,
): OutgoingPart[] {
  const mode = normalizeMobileMessageSegmentationMode(mobileMessageSegmentation);
  const texts = mode === "on" ? splitTextBySentenceBreaks(replyText) : [replyText];
  return texts.map((text) => ({ kind: "text", text }));
}

export function shouldAppendChannelTtsAudio(
  channel: ChannelId,
  ttsEnabled: boolean,
  hasSynthesizeTts: boolean,
  adapterSupportsAudio: boolean | undefined,
): boolean {
  if (channel === "wechat") return false;
  return ttsEnabled && hasSynthesizeTts && adapterSupportsAudio === true;
}

export class ChannelDispatcher {
  private settings: ChannelsSettings;
  private limiter: RateLimiter;
  deps: DispatcherDeps;

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
    this.settings = loadChannelsSettings();
    this.limiter = new RateLimiter(this.settings);
    reloadLogFromDisk();
  }

  /** Reload settings when UI updates rate limits */
  reloadSettings(): void {
    this.settings = loadChannelsSettings();
    this.limiter = new RateLimiter(this.settings);
  }

  /**
   * Processes an incoming message. Invoked by manager adapter callback.
   * Steps: rate limit -> calculate sessionId -> invoke agent -> construct OutgoingMessage.
   */
  async handleIncoming(msg: IncomingMessage): Promise<OutgoingMessage | null> {
    if (!this.limiter.hit(msg.channel, msg.senderId)) {
      console.warn(LOG, `Rate limited: ${msg.channel}:${msg.senderId}`);
      return null;
    }

    const sessionId = makeSessionId(msg.channel, msg.senderId);
    recordSession(msg.channel, msg.senderId, sessionId);
    rememberProactiveChannelRecipient(msg, sessionId);

    // Broadcast inbound message to desktop chatWindow
    if (this.settings.mirrorToDesktop) {
      try {
        this.deps.broadcastChat?.({
          type: "bot:incoming",
          channel: msg.channel,
          senderId: msg.senderId,
          senderName: msg.senderName,
          chatId: msg.chatId,
          text: msg.text,
          at: msg.at.getTime(),
        });
      } catch (err) {
        console.warn(LOG, "broadcastChat (incoming) failed:", err);
      }
    }

    // Write inbound message to log
    try {
      appendLog({
        dir: "incoming",
        channel: msg.channel,
        senderId: msg.senderId,
        senderName: msg.senderName,
        chatId: msg.chatId,
        text: msg.text,
        hasAttachments: (msg.attachments?.length ?? 0) > 0,
      });
    } catch (err) {
      console.warn(LOG, "appendLog (incoming) failed:", err);
    }

    // Append inbound message to conversation history
    try {
      appendChannelHistory(sessionId, "user", msg.text);
    } catch (err) {
      console.warn(LOG, "appendHistory (incoming) failed:", err);
    }

    // Agent invocation
    let replyText: string;
    let sticker: string | null = null;
    if (this.deps.buildAndRunAgent) {
      let priorMessages: ChatMessage[] | undefined;
      if (this.deps.loadRecentChannelHistory) {
        try {
          priorMessages = await this.deps.loadRecentChannelHistory(sessionId, 16);
        } catch (err) {
          console.warn(LOG, "loadRecentChannelHistory failed; continuing without history:", err);
          priorMessages = undefined;
        }
      }
      try {
        const result = await this.deps.buildAndRunAgent(msg, sessionId, priorMessages);
        replyText = result.text;
        sticker = result.sticker;
      } catch (err) {
        console.error(LOG, "Agent invocation failed:", err instanceof Error ? err.message : err);
        return null;
      }
    } else {
      replyText = `[echo][${msg.channel}][${msg.senderId}] ${msg.text}`;
      console.log(LOG, "Phase 0 echo (buildAndRunAgent unavailable):", replyText);
    }

    // Construct OutgoingMessage parts
    const mobileMessageSegmentation = normalizeMobileMessageSegmentationMode(
      this.deps.loadGeneralSettings?.().mobileMessageSegmentation,
    );
    const parts: OutgoingPart[] = buildTextOutgoingParts(replyText, mobileMessageSegmentation);

    // Append TTS audio if enabled and adapter supports audio
    console.log(LOG, `TTS decision: ttsEnabled=${this.settings.ttsEnabled} hasFn=${!!this.deps.synthesizeTts}`);
    const adapterCap = this.deps.manager.getAdapter(msg.channel)?.capability;
    console.log(LOG, `TTS decision: adapterCap.audio=${adapterCap?.audio}`);
    if (shouldAppendChannelTtsAudio(msg.channel, this.settings.ttsEnabled, !!this.deps.synthesizeTts, adapterCap?.audio)) {
      if (this.deps.synthesizeTts) {
        try {
          const audioResult = normalizeTtsResult(await this.deps.synthesizeTts(replyText, { channel: msg.channel }));
          console.log(LOG, `TTS result: length=${audioResult?.audio.length ?? "null"} format=${audioResult?.format ?? "null"}`);
          if (audioResult && audioResult.audio.length > 0) {
            const audioDir = path.join(app.getPath("userData"), "channels", "audio");
            fs.mkdirSync(audioDir, { recursive: true });
            const audioPath = path.join(audioDir, `${msg.channel}-${Date.now()}${audioResult.extension}`);
            fs.writeFileSync(audioPath, audioResult.audio);
            console.log(LOG, `TTS verify: written path=${audioPath} ext=${audioResult.extension} mime=${audioResult.mime}`);
            parts.push({ kind: "audio", filePath: audioPath, mime: audioResult.mime });
            console.log(LOG, `TTS synthesis completed: ${audioResult.audio.length} bytes -> ${audioPath}`);
          }
        } catch (err) {
          console.warn(LOG, "TTS synthesis failed; skipping audio:", err instanceof Error ? err.message : err);
        }
      }
    }

    // Append sticker if selected and enabled
    if (sticker && this.settings.stickerEnabled) {
      const stickerPath = resolveStickerImagePath(sticker);
      if (stickerPath) {
        parts.push({ kind: "sticker", stickerId: sticker, imagePath: stickerPath });
        console.log(LOG, `Sticker selected: id=${sticker} -> ${stickerPath}`);
      } else {
        console.warn(LOG, `Sticker resolution failed; skipping: id=${sticker}`);
      }
    }

    // Broadcast outbound message to desktop chatWindow
    if (this.settings.mirrorToDesktop) {
      try {
        this.deps.broadcastChat?.({
          type: "bot:outgoing",
          channel: msg.channel,
          senderId: msg.senderId,
          senderName: msg.senderName,
          chatId: msg.chatId,
          text: replyText,
          at: Date.now(),
        });
      } catch (err) {
        console.warn(LOG, "broadcastChat (outgoing) failed:", err);
      }
    }

    // Write outbound message to log
    try {
      appendLog({
        dir: "outgoing",
        channel: msg.channel,
        senderId: msg.senderId,
        senderName: msg.senderName,
        chatId: msg.chatId,
        text: replyText,
        hasAttachments: parts.some((p) => p.kind === "audio"),
      });
    } catch (err) {
      console.warn(LOG, "appendLog (outgoing) failed:", err);
    }

    // Append outbound message to conversation history
    try {
      appendChannelHistory(sessionId, "assistant", replyText);
    } catch (err) {
      console.warn(LOG, "appendHistory (outgoing) failed:", err);
    }

    // Construct OutgoingMessage and apply capability degradation
    const outgoing: OutgoingMessage = {
      channel: msg.channel,
      targetId: msg.chatId,
      threadId: msg.threadId,
      parts,
    };
    return this.downgradeToCapability(outgoing, this.deps.manager.getAdapter(msg.channel)?.capability);
  }

  /** Downgrades message parts according to target channel capabilities. Pure function. */
  downgradeToCapability(msg: OutgoingMessage, cap: ChannelCapability | undefined): OutgoingMessage {
    if (!cap) return msg;
    const parts: OutgoingPart[] = [];
    for (const p of msg.parts) {
      if (p.kind === "text") {
        if (cap.maxTextLength > 0 && p.text.length > cap.maxTextLength) {
          parts.push({
            kind: "text",
            text: p.text.slice(0, Math.max(0, cap.maxTextLength - 25)) + "\n...(truncated: too long)",
          });
        } else {
          parts.push(p);
        }
      } else if (p.kind === "image" && !cap.image) {
        parts.push({ kind: "text", text: `[Image] ${p.caption ?? p.url ?? p.filePath ?? ""}` });
      } else if (p.kind === "audio" && !cap.audio) {
        parts.push({ kind: "text", text: `[Voice message ${p.mime}; view in the desktop app]` });
      } else if (p.kind === "file" && !cap.file) {
        parts.push({ kind: "text", text: `[File] ${p.name ?? p.filePath}` });
      } else if (p.kind === "video" && !cap.video) {
        parts.push({ kind: "text", text: `[Video] ${p.name ?? p.filePath}` });
      } else if (p.kind === "card" && !cap.card) {
        const lines: string[] = [p.title];
        if (p.markdown) lines.push(p.markdown);
        if (p.fields && p.fields.length > 0) {
          lines.push(...p.fields.map((f) => `${f.key}: ${f.value}`));
        }
        parts.push({ kind: "text", text: lines.join(cap.markdown ? "\n" : "\n") });
      } else if (p.kind === "sticker" && !cap.sticker) {
        // skip
      } else {
        parts.push(p);
      }
    }
    return { ...msg, parts };
  }
}

function normalizeTtsResult(result: Buffer | DispatcherTtsResult | null): DispatcherTtsResult | null {
  if (!result) return null;
  if (Buffer.isBuffer(result)) {
    return {
      audio: result,
      format: "mp3",
      mime: "audio/mpeg",
      extension: ".mp3",
    };
  }
  return result;
}

/** Process-level singleton */
export const channelDispatcher = new ChannelDispatcher({
  manager: channelManager,
});

/** Injects buildAndRunAgent into the dispatcher */
export function setDispatcherBuildAndRunAgent(
  fn: (msg: IncomingMessage, sessionId: string, priorMessages?: ChatMessage[]) => Promise<{ text: string; sticker: string | null }>,
): void {
  channelDispatcher.deps.buildAndRunAgent = fn;
}

/** Injects TTS synthesizer */
export function setDispatcherSynthesizeTts(
  fn: (text: string, context: DispatcherTtsContext) => Promise<Buffer | DispatcherTtsResult | null>,
): void {
  channelDispatcher.deps.synthesizeTts = fn;
}

/** Injects recent conversation history loader */
export function setDispatcherLoadRecentHistory(
  fn: (sessionId: string, limit: number) => Promise<{ role: "user" | "assistant"; content?: string }[]>,
): void {
  channelDispatcher.deps.loadRecentChannelHistory = fn;
}

/** Injects desktop mirror broadcaster */
export function setDispatcherBroadcastChat(
  fn: (event: {
    type: "bot:incoming" | "bot:outgoing";
    channel: string;
    senderId: string;
    senderName?: string;
    chatId: string;
    text: string;
    at: number;
  }) => void,
): void {
  channelDispatcher.deps.broadcastChat = fn;
}

/** Injects general application settings loader */
export function setDispatcherLoadGeneralSettings(
  fn: () => { mobileMessageSegmentation?: MobileMessageSegmentationMode },
): void {
  channelDispatcher.deps.loadGeneralSettings = fn;
}

// Unified data types for the channels module.
//
// Design principle: All external entrypoints (WeChat/Feishu/Discord/...) must normalize messages
// into IncomingMessage / OutgoingMessage formats before handing them to the dispatcher.
// This decouples the dispatcher from concrete platforms - new channels require zero changes to the dispatcher.
//
// Naming convention: camelCase for all fields, optional fields marked with ?; timestamps use Date.
import type { WebContents } from "electron";

/** Channel ID union type. Extend here when adding new channels. */
export type ChannelId = "wechat" | "feishu";

/** Channel capability declaration. Dispatcher performs degradation based on capabilities. */
export interface ChannelCapability {
  /** Plain text message */
  text: boolean;
  /** Image message */
  image: boolean;
  /** TTS audio message */
  audio: boolean;
  /** File attachment */
  file: boolean;
  /** Video message */
  video: boolean;
  /** Markdown rich text (supported by certain channels) */
  markdown: boolean;
  /** Rich cards (Feishu interactive / Discord embed) */
  card: boolean;
  /** Custom stickers/emojis */
  sticker: boolean;
  /** Maximum single message text length. Exceeding text is truncated with a notice based on capability. */
  maxTextLength: number;
}

/** Inbound attachment. Adapters download locally and populate filePath. */
export interface ChannelAttachment {
  kind: "image" | "audio" | "file" | "video";
  /** Remote URL (empty if adapter has already downloaded locally) */
  url?: string;
  /** Local path (populated when downloaded by adapter) */
  filePath?: string;
  mime?: string;
  caption?: string;
}

/** Inbound message: adapters -> dispatcher. */
export interface IncomingMessage {
  channel: ChannelId;
  /** Platform native sender ID. Dispatcher hashes and truncates to 16 chars as sessionId. */
  senderId: string;
  /** Display name (nickname/open_id alias) for logs/UI. */
  senderName?: string;
  /** Conversation ID. For direct messages, usually equals senderId. */
  chatId: string;
  /** Group chat / thread ID. Undefined for direct messages. */
  threadId?: string;
  text: string;
  attachments?: ChannelAttachment[];
  at: Date;
  /** Raw platform payload for debugging; not serialized. */
  _raw?: unknown;
}

/** Single fragment of an outgoing message. Multimodal messages use parts array; degradation done in dispatcher. */
export type OutgoingPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url?: string; filePath?: string; caption?: string }
  | { kind: "audio"; filePath: string; mime: string }
  | { kind: "file"; filePath: string; name?: string; mime?: string }
  | { kind: "video"; filePath: string; name?: string; mime?: string }
  | {
      kind: "card";
      title: string;
      markdown?: string;
      fields?: Array<{ key: string; value: string }>;
    }
  | { kind: "sticker"; stickerId: string; imagePath: string };

/** Outgoing message: dispatcher -> adapters. */
export interface OutgoingMessage {
  channel: ChannelId;
  /** Recipient target (direct message = senderId; group chat = chatId) */
  targetId: string;
  threadId?: string;
  parts: OutgoingPart[];
}

/** Channel status for UI display */
export interface ChannelStatus {
  enabled: boolean;
  /** "running" | "offline" | "starting" | "config_missing" | "error" */
  phase: "running" | "offline" | "starting" | "config_missing" | "error";
  message?: string;
  /** Channel-specific extra status fields (e.g. WeChat account nickname, Feishu token expiry) */
  detail?: Record<string, unknown>;
}

/** Signature of ChannelAdapter's internal onMessage handler.
 * Returning null indicates the message is ignored (permissions/rate limiting/not in allowlist); adapter will not reply. */
export type MessageHandler = (
  msg: IncomingMessage,
) => Promise<OutgoingMessage | null>;

/** Callback signature when inbound-server passes an inbound request to manager for routing */
export interface InboundRouteContext {
  /** Used to push AG-UI events to desktop chatWindow (optional). */
  chatWindow?: WebContents | null;
  /** Used to broadcast outgoing messages back to desktop for mirrored display (optional). */
  broadcastChat?: (event: { type: "bot:message"; payload: unknown }) => void;
}

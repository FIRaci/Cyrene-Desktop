// Chat session persistence data shape (shared between main / renderer).
//
// Design points:
// - ChatSession is the complete payload with messages, stored in sessions/<id>.json;
// - ChatSessionMeta is the index entry without messages, stored in index.json;
//   List rendering only reads index.json to avoid loading all conversation messages into memory.
// - identityId is currently reserved -- default null for new sessions,
import type { MusicCardData } from "./music-card";

// - schemaVersion for future schema migrations; currently fixed at 1.

export type ChatRole = "user" | "model";

export type ChatSessionPurpose = "proactive-chat";

export type ChatStickerId =
  | "playful"
  | "love-happy"
  | "confident"
  | "serious"
  | "calm"
  | "peek"
  | "clingy-confused"
  | "love-calm";

/** Arbitrary sticker ID (built-in + user-defined) */
export type AnyStickerId = string;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
  /** Optional reasoning / thinking text captured from thinking models */
  reasoning?: string;
  /** Not directly rendered in chat bubble, but included in model context. */
  modelContext?: string;
  attachments?: MessageAttachment[];
  /** Sticker ID (built-in or user-defined) */
  sticker?: string | null;
  /** TTS cache key. Only stores key, not absolute path, to prevent session JSON invalidation if userData path changes. */
  ttsCacheKey?: string;
  /** Music candidate card actually presented; persisted presentation does not extend Skill candidate TTL. */
  musicCard?: MusicCardData;
}

export type MessageAttachment = ImageMessageAttachment | DocumentMessageAttachment;

export interface ImageMessageAttachment {
  kind: "image";
  name: string;
  filePath: string;
  mime: string;
  previewUrl?: string;
  caption?: string;
  status: "pending" | "done" | "error";
}

export interface DocumentMessageAttachment {
  kind: "document";
  name: string;
  filePath: string;
  status: "pending" | "done" | "error";
  processedKind?: "text" | "indexed" | "empty" | "unsupported";
  chunks?: number;
  reason?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  identityId: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
  /** Stable identifier for system-purpose sessions; not set for normal user sessions. */
  purpose?: ChatSessionPurpose;
  // Whether user manually renamed session; when true, title is no longer derived from messages.
  // Legacy data without this field is treated as false (backward compatibility).
  titleIsCustom?: boolean;
}

// Lightweight metadata in index.json (used for list rendering).
export interface ChatSessionMeta {
  id: string;
  title: string;
  identityId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  purpose?: ChatSessionPurpose;
}

export const CHAT_SCHEMA_VERSION = 1 as const;

// Default identity display name (used across all sessions until persona panel is implemented).

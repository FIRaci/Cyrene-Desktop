import path from "node:path";
import type { CDNMedia } from "./ilink-protocol-client";

type InboundItemType = 1 | 2 | 3 | 4 | 5;

export interface InboundWechatItem {
  type: InboundItemType;
  image_item?: {
    file_name?: unknown;
    name?: unknown;
    media?: unknown;
  };
  voice_item?: {
    file_name?: unknown;
    name?: unknown;
    media?: unknown;
    sample_rate?: unknown;
  };
  file_item?: {
    file_name?: unknown;
    name?: unknown;
    media?: unknown;
  };
  video_item?: {
    file_name?: unknown;
    name?: unknown;
    media?: unknown;
  };
}

export type InboundMediaKind = "image" | "voice" | "file" | "video";

export interface InboundMediaDescriptor {
  kind: InboundMediaKind;
  fileName: string;
  extension: string;
  analyzable: boolean;
  media?: CDNMedia;
  sampleRate?: number;
}

const ANALYZABLE_FILE_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown",
  ".json", ".csv", ".tsv", ".yaml", ".yml",
  ".pdf", ".docx", ".xlsx",
  ".js", ".ts", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".cs",
  ".html", ".css", ".xml", ".toml", ".ini", ".env", ".log",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export const SAVE_INTENT_TTL_MS = 5 * 60 * 1000;

export function getWechatDisplayName(callPreference: unknown): string {
  const name = typeof callPreference === "string" ? callPreference.trim() : "";
  return name || "friend";
}

function asFileName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? path.basename(trimmed) : fallback;
}

export function getFileExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function isAnalyzableWechatFile(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ANALYZABLE_FILE_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

export function isWechatSaveIntent(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;
  return /save(?:it|this|thefile)?to(?:my)?desktop|保存到桌面|存到桌面|放到桌面|代收|帮我收|帮我保存|保存文件|收一下/.test(normalized);
}

export function describeInboundWechatMedia(items: InboundWechatItem[]): InboundMediaDescriptor[] {
  const media: InboundMediaDescriptor[] = [];
  for (const item of items) {
    if (item.type === 2 && item.image_item) {
      const fileName = asFileName(item.image_item.file_name ?? item.image_item.name, "wechat-image");
      media.push({
        kind: "image",
        fileName,
        extension: getFileExtension(fileName),
        analyzable: true,
        media: asCdnMedia(item.image_item.media),
      });
    } else if (item.type === 3 && item.voice_item) {
      const fileName = asFileName(item.voice_item.file_name ?? item.voice_item.name, "wechat-voice");
      media.push({
        kind: "voice",
        fileName,
        extension: getFileExtension(fileName),
        analyzable: false,
        media: asCdnMedia(item.voice_item.media),
        sampleRate: typeof item.voice_item.sample_rate === "number" ? item.voice_item.sample_rate : undefined,
      });
    } else if (item.type === 4 && item.file_item) {
      const fileName = asFileName(item.file_item.file_name ?? item.file_item.name, "wechat-file");
      media.push({
        kind: "file",
        fileName,
        extension: getFileExtension(fileName),
        analyzable: isAnalyzableWechatFile(fileName),
        media: asCdnMedia(item.file_item.media),
      });
    } else if (item.type === 5 && item.video_item) {
      const fileName = asFileName(item.video_item.file_name ?? item.video_item.name, "wechat-video");
      media.push({
        kind: "video",
        fileName,
        extension: getFileExtension(fileName),
        analyzable: false,
        media: asCdnMedia(item.video_item.media),
      });
    }
  }
  return media;
}

function asCdnMedia(value: unknown): CDNMedia | undefined {
  if (!value || typeof value !== "object") return undefined;
  const media = value as Partial<CDNMedia>;
  if (typeof media.encrypt_query_param !== "string" || typeof media.aes_key !== "string") return undefined;
  return {
    encrypt_query_param: media.encrypt_query_param,
    aes_key: media.aes_key,
    encrypt_type: media.encrypt_type,
    full_url: media.full_url,
  };
}

export function buildUnsupportedWechatFilePrompt(username: string): string {
  return `${username}, I cannot analyze this file yet. If you want me to keep it for you, reply “save to desktop” within five minutes.`;
}

export function buildWechatVideoPrompt(username: string): string {
  return `${username}, I cannot view this video yet. If you only want me to keep it for you, reply “save to desktop” within five minutes.`;
}

export function buildWechatSaveIntentPrompt(username: string): string {
  return `Of course, ${username}. Send the file and I will place it in the “Cyrene Inbox” folder on your desktop.`;
}

export function buildWechatSaveSuccessPrompt(username: string, filePath: string): string {
  return `Saved, ${username}. I placed it in the “Cyrene Inbox” folder on your desktop: ${filePath}`;
}

export function buildWechatAsrMissingPrompt(username: string): string {
  return `${username}, speech recognition is not configured yet, so I cannot understand this voice message. Please send text instead.`;
}

export function buildWechatAsrFailedPrompt(username: string, reason: string): string {
  return `${username}, I could not understand this voice message: ${reason}. Please send it again as text.`;
}

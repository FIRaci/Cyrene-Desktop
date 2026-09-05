// Channels configuration storage: userData/channels-settings.json
//
// Follows the GeneralSettings pattern in index.ts: load / save / normalize triad.
// Touches Electron only via app.getPath.
//
// Field security classification:
//   - Public fields (switches, ports, whitelists): stored in plain text
//   - Sensitive fields (Feishu AppSecret/Token/Encrypt Key): encrypted on disk.
//
// Encryption strategy (by priority):
//   1. safeStorage (OS keychain: Windows DPAPI / macOS Keychain / Linux libsecret)
//      -> stored with prefix `enc:<base64>`
//   2. When safeStorage is unavailable (headless / sandbox / missing libsecret): machine fingerprint XOR obfuscation
//      -> stored with prefix `obf:<base64>` - not true encryption, but prevents trivial sniffing via cat / grep
//
// Rationale:
//   - Merely falling back to plaintext causes silent data loss on restart
//   - Obfuscation ensures round-trip survival across restarts even if not reverse-engineering proof
//   - If safeStorage is unavailable and user demands high security, a passphrase prompt can be added later
import * as fs from "fs";
import * as path from "path";
import { app, safeStorage } from "electron";
import type { ChannelId } from "./types";

/** Prefix after safeStorage encryption. Decrypted upon reading when encountered */
const ENC_PREFIX = "enc:";
/** Base64 obfuscation prefix (fallback when safeStorage is unavailable; preserves round-trip) */
const OBF_PREFIX = "obf:";
/** Plaintext fallback marker (for legacy data migration) */
const PLAIN_PREFIX = "plain:";

/** Check whether safeStorage is available in the current environment. */
let safeStorageAvailable: boolean | null = null;
function isSafeStorageAvailable(): boolean {
  if (safeStorageAvailable !== null) return safeStorageAvailable;
  try {
    safeStorageAvailable = safeStorage.isEncryptionAvailable();
  } catch {
    safeStorageAvailable = false;
  }
  return safeStorageAvailable;
}

/** Machine fingerprint XOR obfuscation key - guarantees round-trip across restarts.
 *  Uses userData absolute path + app name SHA-256 -> 16 bytes. */
function getMachineKey(): Buffer {
  const seed = `${app.getPath("userData")}::${app.getName()}::cyrene-bot-secret`;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(seed).digest().subarray(0, 16);
}

/** XOR obfuscation (basic deterrent against casual inspection). */
function obfuscate(plain: string): string {
  const key = getMachineKey();
  const buf = Buffer.from(plain, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    // eslint-disable-next-line no-bitwise
    out[i] = buf[i] ^ key[i % key.length];
  }
  return OBF_PREFIX + out.toString("base64");
}

/** XOR deobfuscation (must run on the same machine - key derived from userData path). */
function deobfuscate(stored: string): string {
  const key = getMachineKey();
  const b64 = stored.slice(OBF_PREFIX.length);
  const buf = Buffer.from(b64, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    // eslint-disable-next-line no-bitwise
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out.toString("utf8");
}

/** Encrypt a string. Priority: safeStorage > machine fingerprint obfuscation > plaintext */
function encryptField(plain: string): string {
  if (!plain) return "";
  if (isSafeStorageAvailable()) {
    try {
      const buf = safeStorage.encryptString(plain);
      return ENC_PREFIX + buf.toString("base64");
    } catch (err) {
      console.warn("[ChannelsSettings] safeStorage.encryptString failed; using obfuscation fallback:", err);
    }
  }
  return obfuscate(plain);
}

/** Decrypt a string. Recognizes enc:/obf:/plain: prefixes. Returns empty string for empty input. */
function decryptField(stored: string): string {
  if (!stored) return "";
  if (stored.startsWith(ENC_PREFIX)) {
    if (!isSafeStorageAvailable()) {
      console.warn("[ChannelsSettings] safeStorage is unavailable; cannot decrypt enc: field");
      return "";
    }
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
      return safeStorage.decryptString(buf);
    } catch (err) {
      console.warn("[ChannelsSettings] safeStorage.decryptString failed:", err);
      return "";
    }
  }
  if (stored.startsWith(OBF_PREFIX)) {
    try {
      return deobfuscate(stored);
    } catch (err) {
      console.warn("[ChannelsSettings] deobfuscation failed:", err);
      return "";
    }
  }
  if (stored.startsWith(PLAIN_PREFIX)) {
    return stored.slice(PLAIN_PREFIX.length);
  }
  // Legacy data / fallback: treat as plaintext
  return stored;
}

export interface ChannelRuntimeConfig {
  /** Whether this channel is enabled */
  enabled: boolean;
  /** Custom CLI path (populated if manually specified by user; otherwise autodetected) */
  manualCliPath?: string;
  /** Public webhook callback URL configured by the user (for Feishu etc.) */
  publicWebhookUrl?: string;
}

export interface WechatChannelConfig extends ChannelRuntimeConfig {
  /** List of users awaiting approval */
  pairingPending?: Array<{ code: string; senderId: string; createdAt: number }>;
  /** Current QR code for login (base64 PNG), session-level, not persisted */
}

export interface FeishuChannelConfig extends ChannelRuntimeConfig {
  appId?: string;
  /**
   * AppSecret. Encrypted on disk using safeStorage / obfuscation.
   * Decrypted upon loading so runtime consumers receive plaintext.
   */
  appSecret?: string;
}

/** Plaintext AppSecret reader for callers */
export function decryptFeishuSecret(cfg: FeishuChannelConfig | undefined): string {
  return decryptField(cfg?.appSecret ?? "");
}

export type ChannelToolSandbox = "off" | "safe-only" | "all";

export interface ChannelsSettings {
  wechat: WechatChannelConfig;
  feishu: FeishuChannelConfig;
  /** Port bound by the inbound HTTP server. 0 = random free port. */
  inboundPort: number;
  /** HMAC shared secret. Automatically generated on startup if empty. */
  sharedSecret: string;
  /** Global: Maximum messages per minute per user */
  rateLimitPerUser: number;
  /** Global: Maximum messages per minute per channel */
  rateLimitPerChannel: number;
  /** Global: Whether to send TTS audio messages */
  ttsEnabled: boolean;
  /** Global: Whether to send stickers */
  stickerEnabled: boolean;
  /** Global: Whether to mirror bot conversations to desktop chatWindow */
  mirrorToDesktop: boolean;
  /** Global: Tool execution sandbox restrictions */
  toolSandbox: ChannelToolSandbox;
}

const DEFAULT_SETTINGS: ChannelsSettings = {
  wechat: { enabled: false },
  feishu: { enabled: false },
  inboundPort: 0,
  sharedSecret: "",
  rateLimitPerUser: 10,
  rateLimitPerChannel: 100,
  ttsEnabled: true,
  stickerEnabled: true,
  mirrorToDesktop: true,
  toolSandbox: "all",
};

function filePath(): string {
  return path.join(app.getPath("userData"), "channels-settings.json");
}

function normalize(input: Partial<ChannelsSettings> | null | undefined): ChannelsSettings {
  const safeNum = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const safeBool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;

  const safeStr = (v: unknown): string => (typeof v === "string" ? v : "");
  const safeToolSandbox = (v: unknown): ChannelToolSandbox =>
    v === "off" || v === "all" ? v : "safe-only";

  const w: Partial<WechatChannelConfig> | undefined = input?.wechat;
  const f: Partial<FeishuChannelConfig> | undefined = input?.feishu;

  return {
    wechat: {
      enabled: safeBool(w?.enabled, false),
      manualCliPath: typeof w?.manualCliPath === "string" ? w.manualCliPath : undefined,
      publicWebhookUrl: typeof w?.publicWebhookUrl === "string" ? w.publicWebhookUrl : undefined,
      pairingPending: Array.isArray(w?.pairingPending)
        ? w!.pairingPending!.map((p) => ({
            code: safeStr((p as { code?: unknown }).code),
            senderId: safeStr((p as { senderId?: unknown }).senderId),
            createdAt: safeNum((p as { createdAt?: unknown }).createdAt, Date.now()),
          }))
        : [],
    },
    feishu: {
      enabled: safeBool(f?.enabled, false),
      manualCliPath: typeof f?.manualCliPath === "string" ? f?.manualCliPath : undefined,
      publicWebhookUrl: typeof f?.publicWebhookUrl === "string" ? f?.publicWebhookUrl : undefined,
      appId: typeof f?.appId === "string" ? f?.appId : undefined,
      // appSecret field: external API sees plaintext, disk stores encrypted enc:/obf: prefixed string.
      appSecret: typeof f?.appSecret === "string" ? f?.appSecret : undefined,
    },
    inboundPort: safeNum(input?.inboundPort, 0, 0, 65535),
    sharedSecret: typeof input?.sharedSecret === "string" ? input.sharedSecret : "",
    rateLimitPerUser: safeNum(input?.rateLimitPerUser, 10, 1, 1000),
    rateLimitPerChannel: safeNum(input?.rateLimitPerChannel, 100, 1, 10000),
    ttsEnabled: safeBool(input?.ttsEnabled, true),
    stickerEnabled: safeBool(input?.stickerEnabled, true),
    mirrorToDesktop: safeBool(input?.mirrorToDesktop, true),
    toolSandbox: safeToolSandbox(input?.toolSandbox),
  };
}

export function loadChannelsSettings(): ChannelsSettings {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return { ...DEFAULT_SETTINGS };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ChannelsSettings>;
    const loaded = normalize(raw);
    // Sensitive field decryption boundary: disk stores enc: prefix, runtime API exposes plaintext
    if (loaded.feishu.appSecret) {
      loaded.feishu.appSecret = decryptField(loaded.feishu.appSecret);
    }
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveChannelsSettings(patch: Partial<ChannelsSettings>): ChannelsSettings {
  const existing = loadChannelsSettings();
  const merged: Partial<ChannelsSettings> = { ...existing, ...patch };
  if (patch.wechat) merged.wechat = { ...existing.wechat, ...patch.wechat };
  if (patch.feishu) merged.feishu = { ...existing.feishu, ...patch.feishu };

  // Sensitive field encryption boundary: UI provides plaintext, wrap before saving to disk.
  // Avoid re-encrypting if already prefixed.
  if (typeof merged.feishu?.appSecret === "string" && merged.feishu.appSecret) {
    const v = merged.feishu.appSecret;
    if (!v.startsWith(ENC_PREFIX) && !v.startsWith(OBF_PREFIX) && !v.startsWith(PLAIN_PREFIX)) {
      merged.feishu.appSecret = encryptField(v);
    }
  }

  const final = normalize(merged);
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(final, null, 2), "utf8");

  // Return decrypted copy so runtime caller receives plaintext
  const out: ChannelsSettings = {
    ...final,
    feishu: {
      ...final.feishu,
      appSecret: decryptField(final.feishu.appSecret ?? ""),
    },
  };
  return out;
}

/** Channel settings patch type for type-safe save operations */
export type ChannelConfigPatch = Partial<{
  wechat: Partial<WechatChannelConfig>;
  feishu: Partial<FeishuChannelConfig>;
  inboundPort: number;
  sharedSecret: string;
  rateLimitPerUser: number;
  rateLimitPerChannel: number;
  ttsEnabled: boolean;
  stickerEnabled: boolean;
  mirrorToDesktop: boolean;
  toolSandbox: ChannelToolSandbox;
}>;

/** Returns the configuration subset for a given channelId */
export function getChannelConfig<K extends ChannelId>(
  settings: ChannelsSettings,
  channel: K,
): K extends "wechat" ? WechatChannelConfig : FeishuChannelConfig {
  return (settings[channel] as unknown) as K extends "wechat"
    ? WechatChannelConfig
    : FeishuChannelConfig;
}

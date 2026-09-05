// FeishuAdapter - implements ChannelAdapter.
//
// Connection method: Persistent WebSocket (native support via official Feishu SDK).
// Advantages over HTTP webhooks:
//   - No public HTTPS URL required (Feishu SDK initiates outbound connection)
//   - No Verification Token / Encrypt Key needed (WS handles authentication)
//   - No intranet penetration needed
//   - Automatic reconnect, heartbeat, and ACK handling by the SDK
//
// Data flow:
//   Feishu server <--WSS--> @larksuiteoapi/node-sdk WSClient
//       | onMessage (normalized LarkChannel event)
//       | LarkChannel.on('message')
//   FeishuAdapter.handleLarkMessage -> adapter.onMessage (dispatcher)
//       | CyreneAgent runs
//   LarkChannel.send(chatId, { text }) -> Feishu server
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  type LarkChannel,
  type NormalizedMessage,
  type SendInput,
  type EventName,
} from "@larksuiteoapi/node-sdk";
import type { ChannelAdapter } from "../base";
import type {
  ChannelCapability,
  ChannelStatus,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
  OutgoingPart,
} from "../../types";
import { loadChannelsSettings } from "../../settings-store";
import { getAudioDurationMs } from "./audio-duration";

const LOG = "[FeishuAdapter]";

/** Feishu capability declaration */
const FEISHU_CAPABILITY: ChannelCapability = {
  text: true,
  image: true,
  audio: true,
  file: true,
  video: true,
  markdown: true,
  card: true,
  sticker: true,
  maxTextLength: 4000,
};

/** Maps Feishu resource kind to attachment extension and mime type */
function resourceKindToExt(ktype: string): { ext: string; mime: string } {
  switch (ktype) {
    case "image": return { ext: ".png", mime: "image/png" };
    case "audio": return { ext: ".mp3", mime: "audio/mpeg" };
    case "video": return { ext: ".mp4", mime: "video/mp4" };
    case "file":  return { ext: ".bin", mime: "application/octet-stream" };
    case "sticker": return { ext: ".png", mime: "image/png" };
    default: return { ext: ".bin", mime: "application/octet-stream" };
  }
}

/** Downloads Feishu resource to local cache directory. Returns local path or null on failure. */
async function downloadLarkResource(
  channel: LarkChannel,
  messageId: string,
  fileKey: string,
  kind: string,
): Promise<string | null> {
  const cacheDir = path.join(app.getPath("userData"), "channels", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const { ext } = resourceKindToExt(kind);
  const shortKey = fileKey.slice(-8);
  const localPath = path.join(cacheDir, `feishu-${messageId}-${shortKey}${ext}`);
  if (fs.existsSync(localPath)) return localPath; // Already downloaded
  try {
    const typeParam = (kind === "file" || kind === "audio" || kind === "video") ? "file" : "image";
    const res = await channel.rawClient.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: typeParam },
    });
    if (res && typeof res.writeFile === "function") {
      await res.writeFile(localPath);
    } else {
      const stream = res.getReadableStream();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve());
        stream.on("error", (e: Error) => reject(e));
      });
      fs.writeFileSync(localPath, Buffer.concat(chunks));
    }
    const stat = fs.statSync(localPath);
    console.log(LOG, `Downloaded Feishu resource -> ${localPath} (${stat.size} bytes, kind=${kind})`);
    return localPath;
  } catch (err) {
    console.warn(LOG, `Failed to download Feishu resource: messageId=${messageId} fileKey=${fileKey} err=`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Normalizes Feishu NormalizedMessage -> IncomingMessage (downloads attachments asynchronously) */
async function normalizeLarkMessage(
  channel: LarkChannel,
  msg: NormalizedMessage,
): Promise<IncomingMessage> {
  let text = "";
  const rawType = msg.rawContentType ?? "text";
  const attachments: IncomingMessage["attachments"] = [];

  if (rawType === "text") {
    try {
      const c = JSON.parse(msg.content) as { text?: string };
      text = c.text ?? msg.content;
    } catch {
      text = msg.content;
    }
  } else if (rawType === "image" || rawType === "file" || rawType === "audio" || rawType === "video" || rawType === "sticker") {
    for (const r of msg.resources ?? []) {
      const localPath = await downloadLarkResource(channel, msg.messageId, r.fileKey, r.type);
      if (localPath) {
        const { mime } = resourceKindToExt(r.type);
        attachments.push({
          kind: r.type === "sticker" ? "image" : (r.type as "image" | "file" | "audio" | "video"),
          filePath: localPath,
          mime,
          caption: r.fileName,
        });
        if (!text) text = `[${rawType}]`;
        text = (text ? text + "\n" : "") + `[Attachment: ${localPath}]`;
      }
    }
    if (attachments.length === 0) text = `[${rawType}]`;
  } else {
    text = `[${rawType}]`;
  }

  return {
    channel: "feishu",
    senderId: msg.senderId ?? "",
    senderName: msg.senderName,
    chatId: msg.chatId,
    threadId: msg.threadId,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
    at: new Date(msg.createTime ?? Date.now()),
    _raw: msg,
  };
}

/** Translates OutgoingMessage.parts to Feishu SendInput and transmits */
async function sendLark(channel: LarkChannel, targetId: string, part: OutgoingPart): Promise<{ messageId: string } | null> {
  let result: { messageId: string } | null = null;
  switch (part.kind) {
    case "text": {
      result = (await channel.send(targetId, { text: part.text } as SendInput)) ?? null;
      break;
    }
    case "image": {
      if (part.filePath) {
        result = (await channel.send(targetId, {
          image: { source: part.filePath },
        } as SendInput)) ?? null;
      } else if (part.url) {
        throw new Error("An image URL must be downloaded to a local filePath before sending.");
      } else {
        throw new Error("image part needs filePath or url");
      }
      break;
    }
    case "audio": {
      const duration = await getAudioDurationMs(part.filePath);
      console.log("[Feishu audio] send file:", part.filePath, "duration:", duration, "mime:", part.mime);
      if (!duration) {
        throw new Error(`Could not determine audio duration: ${part.filePath}`);
      }
      result = (await channel.send(targetId, {
        audio: {
          source: part.filePath,
          duration,
        },
      } as SendInput)) ?? null;
      break;
    }
    case "card": {
      result = (await channel.send(targetId, {
        card: {
          schema: "2.0",
          header: { title: { tag: "plain_text", content: part.title }, template: "blue" },
          elements: [
            { tag: "div", text: { tag: "lark_md", content: part.markdown ?? "" } },
            ...(part.fields && part.fields.length > 0
              ? [
                  {
                    tag: "div",
                    fields: part.fields.map((f) => ({
                      is_short: true,
                      text: { tag: "lark_md", content: `**${f.key}**\n${f.value}` },
                    })),
                  },
                ]
              : []),
          ],
        },
      } as unknown as SendInput)) ?? null;
      break;
    }
    case "sticker": {
      result = (await channel.send(targetId, { file_key: part.imagePath } as unknown as SendInput)) ?? null;
      break;
    }
  }
  return result;
}

export class FeishuAdapter implements ChannelAdapter {
  readonly id = "feishu" as const;
  readonly displayName = "Feishu";
  readonly capability = FEISHU_CAPABILITY;
  onMessage: MessageHandler | null = null;

  private channel: LarkChannel | null = null;
  private status: ChannelStatus = { enabled: false, phase: "config_missing" };

  constructor() {
    // Initialized in start()
  }

  /** Rebuilds LarkChannel instance when user updates AppID/Secret in UI */
  private async rebuildChannel(): Promise<LarkChannel | null> {
    const settings = loadChannelsSettings().feishu;
    if (!settings.enabled) {
      this.status = { enabled: false, phase: "offline", message: "Disabled" };
      return null;
    }
    if (!settings.appId || !settings.appSecret) {
      this.status = {
        enabled: true,
        phase: "config_missing",
        message: "App ID / App Secret is missing",
      };
      return null;
    }

    const ch = createLarkChannel({
      appId: settings.appId,
      appSecret: settings.appSecret,
      domain: Domain.Feishu,
      loggerLevel: LoggerLevel.warn,
      transport: "websocket",
    });

    ch.on("message" as EventName, async (msg: NormalizedMessage) => {
      // Direct messages only
      if (msg.chatType !== "p2p") {
        console.log(LOG, `Ignoring ${msg.chatType} message (direct messages only)`);
        return;
      }
      try {
        const inMsg = await normalizeLarkMessage(ch, msg);
        if (this.onMessage) {
          await this.onMessage(inMsg);
        }
      } catch (err) {
        console.error(LOG, "Failed to process inbound message:", err);
      }
    });

    ch.on("error" as EventName, (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, "channel error:", msg);
      this.status = { enabled: true, phase: "error", message: msg };
    });
    ch.on("reconnecting" as EventName, () => {
      console.log(LOG, "reconnecting...");
      this.status = { enabled: true, phase: "starting", message: "Reconnecting" };
    });
    ch.on("reconnected" as EventName, () => {
      console.log(LOG, "reconnected");
      this.status = { enabled: true, phase: "running", message: "Connected" };
    });

    this.channel = ch;
    return ch;
  }

  async start(): Promise<void> {
    const ch = await this.rebuildChannel();
    if (!ch) return;

    try {
      await ch.connect();
      this.status = { enabled: true, phase: "running", message: "Persistent connection established" };
      console.log(LOG, "WebSocket persistent connection is ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(LOG, "connect() failed:", msg);
      this.status = { enabled: true, phase: "error", message: msg };
    }
  }

  async stop(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.disconnect();
      } catch (err) {
        console.warn(LOG, "Disconnect failed:", err);
      }
      this.channel = null;
    }
    this.status = { enabled: false, phase: "offline", message: "Stopped" };
  }

  getStatus(): ChannelStatus {
    const settings = loadChannelsSettings().feishu;
    if (!settings.enabled) {
      return { enabled: false, phase: "offline", message: "Disabled" };
    }
    if (!settings.appId || !settings.appSecret) {
      return { enabled: true, phase: "config_missing", message: "App ID / App Secret is missing" };
    }
    return this.status;
  }

  async send(msg: OutgoingMessage): Promise<{ ok: boolean; error?: string }> {
    if (!this.channel) {
      console.warn(LOG, "Send failed: persistent connection is not established");
      return { ok: false, error: "The Feishu persistent connection is not established." };
    }
    if (!msg.parts || msg.parts.length === 0) {
      return { ok: false, error: "There is no content to send." };
    }
    console.log(LOG, `send: targetId=${msg.targetId} parts=${msg.parts.length}`);
    let lastErr: string | undefined;
    let anyOk = false;
    for (const part of msg.parts) {
      try {
        const r = await sendLark(this.channel, msg.targetId, part);
        console.log(LOG, `send ok: messageId=${r?.messageId ?? "?"}`);
        anyOk = true;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        console.error(LOG, `send part failed: targetId=${msg.targetId} part=${part.kind} err=`, lastErr, err);
      }
    }
    if (!anyOk) return { ok: false, error: lastErr ?? "send failed" };
    return { ok: true };
  }

  /** Triggers rebuild (called when user modifies AppID/Secret) */
  public async rebuild(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.disconnect();
      } catch {
        /* ignore */
      }
      this.channel = null;
    }
    await this.start();
  }
}

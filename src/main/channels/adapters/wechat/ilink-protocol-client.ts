// iLink Protocol Client - HTTP client for WeChat iLink Bot API.
// Zero native dependency (uses Node 22 fetch + crypto.randomUUID).
import { randomUUID } from "node:crypto";

const BASE_URL = "https://ilinkai.weixin.qq.com";
const LONG_POLL_TIMEOUT_MS = 35_000;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ItemType = 1 | 2 | 3 | 4 | 5;  // text|image|voice|file|video
export type MessageType = 1;
export enum MediaType {
  IMAGE = 1,
  VIDEO = 2,
  FILE = 3,
  VOICE = 4,
}

export interface Credentials {
  botToken: string;
  ilinkBotId: string;
  baseUrl: string;
  ilinkUserId: string;
  /** Display account id */
  accountId?: string;
}

/** Inbound message */
export interface WeixinMessage {
  msgId: string;
  fromUserId: string;
  toUserId: string;
  msgType: number;            // 1=user, 2=bot echo
  content: string;            // Extracted from item_list[].text_item.text
  items: WeixinItem[];
  contextToken: string;       // Carried forward when replying
  createTimeMs?: number;
  raw: unknown;
}

/** iLink item shape (consistent with WireMessageItem) */
export interface WeixinItem {
  type: ItemType;             // 1=text 2=image 3=voice 4=file 5=video
  text_item?: { text: string };
  image_item?: any;
  voice_item?: any;
  file_item?: any;
  video_item?: any;
}

/** iLink raw WireMessage shape (snake_case) */
export interface WireMessage {
  message_id?: number;
  from_user_id: string;
  to_user_id: string;
  message_type: number;
  message_state?: number;
  context_token: string;
  create_time_ms?: number;
  item_list: WeixinItem[];
  [k: string]: unknown;
}

/** getupdates response */
interface GetUpdatesResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WireMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface CDNMedia {
  encrypt_query_param: string;
  aes_key: string;
  encrypt_type?: 0 | 1;
  full_url?: string;
}

export interface SendMessageItem {
  type: ItemType;
  text_item?: { text: string };
  image_item?: any;
  voice_item?: any;
  file_item?: any;
  video_item?: any;
}

export interface GetUploadUrlRequest {
  filekey: string;
  media_type: MediaType;
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResponse {
  upload_param: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

// -----------------------------------------------------------------------------
// Client
// -----------------------------------------------------------------------------

export interface ILinkClientOptions {
  /** Injected random wechat-uin generator (can be pinned in tests) */
  wechatUin?: string;
}

export class ILinkClient {
  private baseUrl: string;
  private botToken: string;
  private botId: string;
  private wechatUin: string;

  constructor(creds: Credentials, opts: ILinkClientOptions = {}) {
    this.baseUrl = creds.baseUrl || BASE_URL;
    this.botToken = creds.botToken;
    this.botId = creds.ilinkBotId;
    this.wechatUin = opts.wechatUin ?? randomWechatUin();
  }

  botUserId(): string {
    return this.botId;
  }

  // -- Long poll loop --------------------------------------------------------

  /**
   * Long-poll for new messages.
   * Holds for up to 35 seconds; immediately requests again with updated get_updates_buf upon return.
   * Throws SessionExpiredError when ret=-14.
   */
  async getUpdates(buf = ""): Promise<{ messages: WeixinMessage[]; buf: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LONG_POLL_TIMEOUT_MS + 5_000);

    try {
      const resp = await this.doJson<unknown>("POST", "/ilink/bot/getupdates", {
        get_updates_buf: buf,
        base_info: { channel_version: "2.0.0" },
      }, { signal: ctrl.signal });

      const data = resp as GetUpdatesResponse;
      if (data.ret === -14) {
        throw new SessionExpiredError("iLink session expired (ret=-14)");
      }
      if (data.ret !== undefined && data.ret !== 0) {
        throw new Error(`iLink getupdates failed: ret=${data.ret} ${data.errmsg ?? ""}`);
      }

      // Filter out bot echo messages (message_type=2)
      const wires = (data.msgs ?? []).filter((m) => m.message_type === 1);
      return {
        messages: wires.map((m) => this.#wireToMessage(m)),
        buf: data.get_updates_buf ?? "",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Converts iLink WireMessage to WeixinMessage */
  #wireToMessage(w: WireMessage): WeixinMessage {
    const text = (w.item_list ?? [])
      .filter((it) => it.type === 1 && it.text_item?.text)
      .map((it) => it.text_item!.text)
      .join("");
    return {
      msgId: String(w.message_id ?? ""),
      fromUserId: w.from_user_id,
      toUserId: w.to_user_id,
      msgType: w.message_type,
      content: text,
      items: w.item_list ?? [],
      contextToken: w.context_token,
      createTimeMs: w.create_time_ms,
      raw: w,
    };
  }

  // -- Send ------------------------------------------------------------------

  /** Sends text message */
  async sendText(toUserId: string, text: string, contextToken: string): Promise<{ ok: boolean; error?: string }> {
    return this.sendMessage(toUserId, [{ type: 1, text_item: { text } }], contextToken);
  }

  /**
   * General sendmessage.
   * @param toUserId Recipient user id
   * @param itemList Contains one or more items (text/image/voice/file/video)
   * @param contextToken Forwarded from inbound message
   */
  async sendMessage(
    toUserId: string,
    itemList: SendMessageItem[],
    contextToken: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await this.doJson<unknown>("POST", "/ilink/bot/sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: randomUUID(),
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: itemList,
        },
        base_info: { channel_version: "2.0.0" },
      });
      const data = resp as { ret?: number; errmsg?: string };
      if (data.ret === -14) throw new SessionExpiredError("session expired on send");
      if (data.ret !== 0 && data.ret !== undefined) {
        return { ok: false, error: data.errmsg ?? `ret=${data.ret}` };
      }
      return { ok: true };
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      return { ok: false, error: String(err) };
    }
  }

  async getUploadUrl(req: GetUploadUrlRequest): Promise<GetUploadUrlResponse> {
    const resp = await this.doJson<unknown>("POST", "/ilink/bot/getuploadurl", {
      ...req,
      base_info: { channel_version: "2.0.0" },
    });
    const data = resp as GetUploadUrlResponse & { ret?: number; errmsg?: string };
    if (data.ret === -14) throw new SessionExpiredError("session expired on getuploadurl");
    if (data.ret !== 0 && data.ret !== undefined) {
      throw new Error(`iLink getuploadurl failed: ${data.errmsg ?? `ret=${data.ret}`}`);
    }
    return data;
  }

  // -- Typing ----------------------------------------------------------------

  /** Fetches typing_ticket (per-user) */
  async getConfig(userId: string, contextToken: string): Promise<{ typingTicket?: string }> {
    try {
      const resp = await this.doJson<unknown>("POST", "/ilink/bot/getconfig", {
        ilink_user_id: userId,
        context_token: contextToken,
      });
      const data = resp as { ret?: number; typing_ticket?: string; errmsg?: string };
      if (data.ret === 0) {
        return { typingTicket: data.typing_ticket };
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Sends typing indicator */
  async sendTyping(userId: string, typingTicket: string, status: 1 | 2 = 1): Promise<void> {
    await this.doJson<unknown>("POST", "/ilink/bot/sendtyping", {
      ilink_user_id: userId,
      typing_ticket: typingTicket,
      status,
    });
  }

  // -- Low level -------------------------------------------------------------

  private async doJson<T>(method: string, path: string, body: unknown, init?: RequestInit): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this.headers(),
      body: JSON.stringify(body),
      ...init,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Non-JSON response from ${method} ${path}: ${text.slice(0, 200)}`);
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${this.botToken}`,
      "X-WECHAT-UIN": this.wechatUin,
    };
  }
}

// -----------------------------------------------------------------------------
// Login flow (anonymous client)
// -----------------------------------------------------------------------------

export interface QrCodeResp {
  qrcode: string;
  qrcode_img_content: string;   // base64 PNG
}

export interface QrStatusResp {
  status: "init" | "scanned" | "confirmed" | "expired" | string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

/** Fetches login QR code */
export async function fetchQrCode(): Promise<QrCodeResp> {
  const uin = randomWechatUin();
  const url = `${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
  const res = await fetch(url, { headers: { "X-WECHAT-UIN": uin } });
  const text = await res.text();
  if (!res.ok) throw new Error(`qrcode fetch failed: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as QrCodeResp;
}

/** Polls scan status (long-poll 40s) */
export async function pollQrStatus(qrcode: string, signal?: AbortSignal): Promise<QrStatusResp> {
  const uin = randomWechatUin();
  const url = `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  const res = await fetch(url, {
    headers: { "X-WECHAT-UIN": uin },
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`qrcode status failed: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as QrStatusResp;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export class SessionExpiredError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SessionExpiredError";
  }
}

function randomWechatUin(): string {
  const n = (Math.random() * 0xffffffff) >>> 0;
  const s = String(n);
  return Buffer.from(s, "utf8").toString("base64");
}

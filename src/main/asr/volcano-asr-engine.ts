// 阿里云实时语音识别 ASR 引擎 —— WebSocket + JSON 协议。
//
// 文档：https://help.aliyun.com/zh/isi/developer-reference/websocket
// URL：wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=<token>
// 鉴权：用 AccessKeyId + AccessKeySecret 获取临时 token，拼到 URL 里
// 协议：JSON 文本帧（StartTranscription/StopTranscription）+ 二进制帧（PCM 音频）
// 音频：PCM 16kHz/16bit/mono

import { WebSocket } from "ws";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";

const LOG_PREFIX = "[AliyunASR]";
const NLS_GATEWAY = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";

/** 阿里云 ASR 流式识别会话 */
export class VolcanoAsrStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private ready = false;
  private audioBuffer = Buffer.alloc(0);
  private taskId = randomUUID().replace(/-/g, "");
  private appKey = "";
  private startReject: ((reason: Error) => void) | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lifecycleAbort = new AbortController();

  constructor(
    private readonly onPartial: (text: string) => void,
    private readonly onFinal: (text: string) => void,
    private readonly options: { startTimeoutMs?: number; maxQueuedAudioBytes?: number } = {},
  ) {}

  /** 开始识别会话：获取 token → 连 WebSocket → 发 StartTranscription */
  async start(
    appKey: string,
    accessKeyId: string,
    accessKeySecret: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.stopped) throw new Error("ASR stream has been stopped");
    this.appKey = appKey;
    const abortFromCaller = () => this.lifecycleAbort.abort(signal?.reason ?? new Error("ASR start aborted"));
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });

    const token = await this.getToken(accessKeyId, accessKeySecret, this.lifecycleAbort.signal);
    if (this.stopped || this.lifecycleAbort.signal.aborted) {
      throw this.abortReason("ASR stream has been stopped");
    }

    const url = `${NLS_GATEWAY}?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);
    const onLifecycleAbort = () => this.failStart(this.abortReason("ASR start aborted"));
    this.lifecycleAbort.signal.addEventListener("abort", onLifecycleAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        this.startReject = reject;
        this.startTimer = setTimeout(() => {
          this.failStart(new Error("ASR readiness handshake timed out"));
        }, this.options.startTimeoutMs ?? 10_000);

        this.ws?.on("open", () => {
          if (this.stopped) return this.failStart(new Error("ASR stream has been stopped"));
          this.sendStartTranscription(appKey, language);
        });
        this.ws?.on("message", (raw: Buffer) => this.handleMessage(raw, resolve));
        this.ws?.on("error", (err) => this.failStart(new Error(`ASR WebSocket error: ${err.message}`)));
        this.ws?.on("close", (code) => {
          if (!this.ready && !this.stopped) this.failStart(new Error(`ASR WebSocket closed before ready (${code})`));
        });
      });
    } finally {
      this.lifecycleAbort.signal.removeEventListener("abort", onLifecycleAbort);
      signal?.removeEventListener("abort", abortFromCaller);
      this.clearStartTimer();
      this.startReject = null;
    }
  }

  /** 发送 StartTranscription 指令（JSON 文本帧） */
  private sendStartTranscription(appKey: string, language: string): void {
    const requestedLanguage = normalizeAsrLanguage(language);
    // SpeechTranscriber binds its recognition language/model to the project
    // identified by appkey. The WebSocket payload has no supported language
    // selector, so do not send language/language_hints fields that this protocol
    // does not define. Keep the normalized selection visible for diagnostics.
    console.log(LOG_PREFIX, `StartTranscription language=${requestedLanguage} (configured by appkey)`);
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StartTranscription",
        appkey: appKey,
      },
      payload: {
        format: "pcm",
        sample_rate: 16000,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        max_sentence_silence: 800,
      },
    };
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch (err) {
      console.error(LOG_PREFIX, "发送 StartTranscription 失败:", err);
    }
  }

  /** 发送一帧 PCM 音频（攒够 200ms/6400 字节再发） */
  sendAudio(pcmFrame: Buffer): void {
    if (this.stopped || pcmFrame.length === 0) return;
    this.audioBuffer = Buffer.concat([this.audioBuffer, pcmFrame]);
    const maxQueued = this.options.maxQueuedAudioBytes ?? 1_024_000;
    if (!this.ready && this.audioBuffer.length > maxQueued) {
      this.audioBuffer = this.audioBuffer.subarray(this.audioBuffer.length - maxQueued);
    }
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.flushFullAudioChunks();
  }

  private flushFullAudioChunks(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 200ms = 16000 * 0.2 * 2 = 6400 字节
    while (this.audioBuffer.length >= 6400) {
      const chunk = this.audioBuffer.subarray(0, 6400);
      this.audioBuffer = this.audioBuffer.subarray(6400);
      ws.send(chunk, { binary: true });
    }
  }

  /** 结束识别：发剩余音频 + StopTranscription */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.lifecycleAbort.abort(new Error("ASR stream has been stopped"));
    if (!this.ready) {
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      try { this.ws?.terminate(); } catch { /* ignore */ }
      return;
    }

    // 发剩余音频
    if (this.audioBuffer.length > 0) {
      try { this.ws.send(this.audioBuffer, { binary: true }); } catch { /* ignore */ }
      this.audioBuffer = Buffer.alloc(0);
    }

    // 发 StopTranscription 指令
    const msg = {
      header: {
        message_id: randomUUID().replace(/-/g, ""),
        task_id: this.taskId,
        namespace: "SpeechTranscriber",
        name: "StopTranscription",
        appkey: this.appKey,
      },
    };
    try { this.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }

    setTimeout(() => { try { this.ws?.close(); } catch { /* ignore */ } }, 2000);
  }

  /** 解析服务端 JSON 响应 */
  private handleMessage(raw: Buffer, resolveStart?: () => void): void {
    try {
      const msg = JSON.parse(raw.toString()) as {
        header?: {
          status?: number;
          status_text?: string;
          task_id?: string;
          name?: string;
        };
        payload?: {
          result?: string;
          index?: number;
          time?: number;
          confidence?: number;
        };
      };

      const status = msg.header?.status;
      const eventName = msg.header?.name;

      if (status !== 20000000 && status !== undefined) {
        this.failStart(new Error(`ASR rejected the session: ${status} ${msg.header?.status_text ?? ""}`.trim()));
        return;
      }

      if (eventName === "TranscriptionStarted") {
        this.ready = true;
        this.clearStartTimer();
        this.flushFullAudioChunks();
        resolveStart?.();
      } else if (eventName === "TranscriptionResultChanged") {
        // 中间结果
        const text = msg.payload?.result ?? "";
        if (text) this.onPartial(text);
      } else if (eventName === "SentenceEnd") {
        // 最终结果
        const text = msg.payload?.result ?? "";
        if (text) {
          console.log(LOG_PREFIX, "最终识别:", text);
          this.onFinal(text);
        }
      } else if (eventName === "TranscriptionCompleted") {
        console.log(LOG_PREFIX, "转写已完成");
      }
    } catch (err) {
      console.error(LOG_PREFIX, "解析响应失败:", err);
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private failStart(error: Error): void {
    this.clearStartTimer();
    const reject = this.startReject;
    this.startReject = null;
    reject?.(error);
    if (!this.ready) {
      try { this.ws?.terminate(); } catch { /* ignore */ }
    }
  }

  private abortReason(fallback: string): Error {
    const reason = this.lifecycleAbort.signal.reason;
    return reason instanceof Error ? reason : new Error(reason ? String(reason) : fallback);
  }

  /** 用 AccessKeyId + AccessKeySecret 获取阿里云临时 token */
  private async getToken(accessKeyId: string, accessKeySecret: string, signal: AbortSignal): Promise<string> {
    // 阿里云 NLS token 获取：RPC 风格 API 签名
    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: "CreateToken",
      Format: "JSON",
      RegionId: "cn-shanghai",
      SignatureMethod: "HMAC-SHA256",
      SignatureNonce: randomUUID().replace(/-/g, ""),
      SignatureVersion: "1.0",
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      Version: "2019-02-28",
    };

    // 按字母序排列参数
    const sortedKeys = Object.keys(params).sort();
    const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");

    // 构建签名字符串
    const stringToSign = `GET&%2F&${encodeURIComponent(canonicalQuery)}`;

    // HMAC-SHA256 签名（阿里云签名附加 &）
    const signature = createHmac("sha256", accessKeySecret + "&")
      .update(stringToSign)
      .digest("base64");

    // 构建完整 URL
    const url = `https://nls-meta.cn-shanghai.aliyuncs.com/?${canonicalQuery}&Signature=${encodeURIComponent(signature)}`;

    const resp = await fetch(url, { signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as { Token?: { Id?: string }; errmsg?: string };
    if (!data.Token?.Id) throw new Error(data.errmsg || "Failed to obtain an authentication token");
    return data.Token.Id;
  }
}

export type AsrLanguage = "zh" | "en" | "auto";

/**
 * Normalize the UI setting without claiming that SpeechTranscriber can switch
 * models inside a session. Unknown/legacy values use the appkey's configured
 * model, which is the same behavior as `auto`.
 */
export function normalizeAsrLanguage(language: string): AsrLanguage {
  const normalized = language.trim().toLowerCase();
  return normalized === "zh" || normalized === "en" ? normalized : "auto";
}

// ── 配置注入 ──

export interface AsrConfig {
  appKey: string;
  accessKeyId: string;
  accessKeySecret: string;
  language: string;
  engine: string;
}

let asrConfigGetter: (() => AsrConfig | null) | null = null;

export function setAsrConfig(getter: () => AsrConfig | null): void {
  asrConfigGetter = getter;
}

export function getAsrConfig(): AsrConfig | null {
  return asrConfigGetter?.() ?? null;
}

// Aliyun real-time ASR engine — WebSocket + JSON protocol.
//
// Documentation: https://help.aliyun.com/zh/isi/developer-reference/websocket
// URL: wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1?token=<token>
// Auth: Acquire temporary token with AccessKeyId + AccessKeySecret, appended to URL
// Protocol: JSON text frames (StartTranscription/StopTranscription) + binary frames (PCM audio)
// Audio: PCM 16kHz/16bit/mono

import { WebSocket } from "ws";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";

const LOG_PREFIX = "[AliyunASR]";
const NLS_GATEWAY = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";

/** Aliyun ASR streaming recognition session */
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

  /** Starts recognition session: acquire token -> connect WebSocket -> send StartTranscription */
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

  /** Sends StartTranscription command (JSON text frame) */
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
      console.error(LOG_PREFIX, "Failed to send StartTranscription:", err);
    }
  }

  /** Sends a PCM audio frame (buffers 200ms/6400 bytes before sending) */
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
    // 200ms = 16000 * 0.2 * 2 = 6400 bytes
    while (this.audioBuffer.length >= 6400) {
      const chunk = this.audioBuffer.subarray(0, 6400);
      this.audioBuffer = this.audioBuffer.subarray(6400);
      ws.send(chunk, { binary: true });
    }
  }

  /** Ends recognition: flush remaining audio + StopTranscription */
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

    // Send remaining audio
    if (this.audioBuffer.length > 0) {
      try { this.ws.send(this.audioBuffer, { binary: true }); } catch { /* ignore */ }
      this.audioBuffer = Buffer.alloc(0);
    }

    // Send StopTranscription command
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

  /** Parse server JSON response */
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
        // Partial result
        const text = msg.payload?.result ?? "";
        if (text) this.onPartial(text);
      } else if (eventName === "SentenceEnd") {
        // Final result
        const text = msg.payload?.result ?? "";
        if (text) {
          console.log(LOG_PREFIX, "Final recognition:", text);
          this.onFinal(text);
        }
      } else if (eventName === "TranscriptionCompleted") {
        console.log(LOG_PREFIX, "Transcription completed");
      }
    } catch (err) {
      console.error(LOG_PREFIX, "Failed to parse response:", err);
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

  /** Acquire temporary Aliyun token with AccessKeyId + AccessKeySecret */
  private async getToken(accessKeyId: string, accessKeySecret: string, signal: AbortSignal): Promise<string> {
    // Aliyun NLS token acquisition: RPC style API signature
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

    // Sort parameters alphabetically
    const sortedKeys = Object.keys(params).sort();
    const canonicalQuery = sortedKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");

    // Build signature string
    const stringToSign = `GET&%2F&${encodeURIComponent(canonicalQuery)}`;

    // HMAC-SHA256 signature (Aliyun signature appends &)
    const signature = createHmac("sha256", accessKeySecret + "&")
      .update(stringToSign)
      .digest("base64");

    // Build full URL
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

// ── Configuration Injection ──

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

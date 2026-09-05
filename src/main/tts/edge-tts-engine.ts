// Microsoft Edge Neural TTS Engine
// Provides studio-grade neural voice synthesis without API keys.
// Default character voice: zh-CN-XiaoyiNeural (Lively, Cartoon, Anime Girl — sweet, ethereal & expressive).

import * as crypto from "crypto";
import { WebSocket } from "ws";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_MAX_ENTRIES = 120;

// In-memory cache for common companion phrases (0ms latency on repeated queries)
const audioCache = new Map<string, { buffer: Buffer; format: string; timestamp: number }>();

export interface EdgeTtsOptions {
  text: string;
  voice?: string;
  pitch?: string;
  rate?: string;
  volume?: string;
  format?: string;
  timeoutMs?: number;
}

export interface EdgeTtsResult {
  audio: Buffer;
  format: string;
}

function generateSecMsGec(): string {
  const WIN_EPOCH = 11644473600;
  let ticks = (Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 10000000;
  const strToHash = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash("sha256").update(strToHash, "ascii").digest("hex").toUpperCase();
}

/**
 * Infers appropriate expressive neural voice based on language and text content.
 * Defaults to en-US-AnaNeural (Cyrene's sweet, cheerful English companion voice).
 */
export function resolveBestNeuralVoice(text: string, preferredVoice?: string): string {
  if (preferredVoice) return preferredVoice;

  // Japanese characters
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) {
    return "ja-JP-NanamiNeural";
  }

  // Vietnamese accented characters
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) {
    return "vi-VN-HoaiMyNeural";
  }

  // Chinese characters
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return "zh-CN-XiaoyiNeural";
  }

  // Default: Sweet English anime companion voice for Cyrene
  return "en-US-AnaNeural";
}

/**
 * Synthesizes text to high-fidelity neural MP3 using Microsoft Edge speech service.
 */
export async function synthesizeEdgeTts(options: EdgeTtsOptions): Promise<EdgeTtsResult> {
  const text = String(options.text || "").trim();
  if (!text) {
    throw new Error("Edge TTS text cannot be empty");
  }

  const voice = resolveBestNeuralVoice(text, options.voice);
  const pitch = options.pitch || "+10Hz";
  const rate = options.rate || "+3%";
  const volume = options.volume || "+0%";
  const format = options.format || "audio-24khz-48kbitrate-mono-mp3";
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const cacheKey = `${voice}|${pitch}|${rate}|${format}|${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    return { audio: cached.buffer, format: cached.format };
  }

  const secMsGec = generateSecMsGec();
  const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
  const wsUrl = `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  return new Promise<EdgeTtsResult>((resolve, reject) => {
    let ws: WebSocket | null = null;
    let timer: NodeJS.Timeout | null = null;
    const chunks: Buffer[] = [];
    let completed = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (ws) {
        try {
          ws.removeAllListeners();
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch { /* ignore */ }
        ws = null;
      }
    };

    timer = setTimeout(() => {
      if (!completed) {
        cleanup();
        reject(new Error(`Edge TTS synthesis timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
          "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
          Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: `muid=${muid};`,
        },
      });
    } catch (err) {
      cleanup();
      reject(err);
      return;
    }

    ws.on("open", () => {
      try {
        const reqId = crypto.randomBytes(16).toString("hex");

        // Step 1: Send speech configuration
        const configMsg =
          "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                  outputFormat: format,
                },
              },
            },
          });
        ws?.send(configMsg);

        // Step 2: Escape text for SSML
        const escapedText = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

        // Step 3: Send SSML
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${voice}"><prosody pitch="${pitch}" rate="${rate}" volume="${volume}">${escapedText}</prosody></voice></speak>`;
        const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
        ws?.send(ssmlMsg);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    ws.on("message", (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.from(data as ArrayBuffer);
        if (buf.length >= 2) {
          const headerLen = buf.readUInt16BE(0);
          if (buf.length >= headerLen + 2) {
            chunks.push(buf.subarray(headerLen + 2));
          }
        }
      } else {
        const textData = String(data);
        if (textData.includes("turn.end")) {
          completed = true;
          const totalBuffer = Buffer.concat(chunks);
          cleanup();

          if (totalBuffer.length === 0) {
            reject(new Error("Edge TTS returned zero audio bytes"));
            return;
          }

          // Cache audio result
          if (audioCache.size >= CACHE_MAX_ENTRIES) {
            const oldestKey = audioCache.keys().next().value;
            if (oldestKey) audioCache.delete(oldestKey);
          }
          audioCache.set(cacheKey, { buffer: totalBuffer, format: "mp3", timestamp: Date.now() });

          resolve({ audio: totalBuffer, format: "mp3" });
        }
      }
    });

    ws.on("error", (err: Error) => {
      if (!completed) {
        cleanup();
        reject(err);
      }
    });

    ws.on("close", () => {
      if (!completed && chunks.length > 0) {
        completed = true;
        const totalBuffer = Buffer.concat(chunks);
        cleanup();
        resolve({ audio: totalBuffer, format: "mp3" });
      }
    });
  });
}

// GPT-SoVITS local TTS engine
// Interface: official api_v2 (POST /api/tts), returns wav bytes
// Reference: https://github.com/RVC-Boss/GPT-SoVITS
import * as fs from "fs";

export interface GptsovitsSynthesizeOptions {
  baseUrl: string;          // e.g. "http://localhost:9880", without path
  refAudioPath: string;     // Reference audio absolute path
  promptText: string;      // Reference audio transcript text
  text: string;             // Text to synthesize
  textLang?: "en" | "zh";
  promptLang?: "en" | "zh";
  speed?: number;           // 0.5~2, default 1
  format?: "wav" | "mp3";   // Default wav
  timeoutMs?: number;      // Default 60000 (local inference might be slow)
  debugLog?: (entry: Record<string, unknown>) => void;
}

export interface GptsovitsSynthesizeResult {
  audio: Buffer;
  format: "wav" | "mp3";
}

const DEFAULT_TIMEOUT_MS = 60000;
const TTS_PATH = "/tts";

/**
 * Calls GPT-SoVITS api_v2.
 * Request body application/x-www-form-urlencoded:
 *   refer_wav_path / prompt_text / text / text_language / prompt_language / speed_factor / streaming / format
 * Returns complete wav (or mp3) bytes.
 */
export async function synthesize(opts: GptsovitsSynthesizeOptions): Promise<GptsovitsSynthesizeResult> {
  const format: "wav" | "mp3" = opts.format ?? "wav";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestId = `gptsovits-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const log = (entry: Record<string, unknown>) => {
    try { opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry }); } catch { /* ignore */ }
  };

  // 1) Input validation
  if (!opts.baseUrl) throw new Error("GPT-SoVITS API URL is required");
  if (!opts.refAudioPath) throw new Error("Reference audio path is required");
  if (!opts.promptText) throw new Error("Reference audio transcript is required");
  if (!opts.text) throw new Error("Synthesis text is required");
  if (!fs.existsSync(opts.refAudioPath)) {
    throw new Error(`Reference audio file does not exist: ${opts.refAudioPath}`);
  }

  // 2) Build JSON body (raw object, not wrapped in data)
  // Contract ref GPT-SoVITS api_v2.py: POST /tts, body is TTS_Request model
  // Required fields: text / text_lang / ref_audio_path / prompt_lang
  // Cyrene's Hugging Face GPT-SoVITS model is strictly Mandarin Chinese (HSR-Cyrene-GPT-SoVITS).
  // Strictly default to "zh" and never fallback to "en".
  const text_lang = opts.textLang === "en" ? "zh" : (opts.textLang ?? "zh");
  const prompt_lang = opts.promptLang === "en" ? "zh" : (opts.promptLang ?? "zh");

  const body = JSON.stringify({
    text: opts.text,
    text_lang,
    ref_audio_path: opts.refAudioPath,
    prompt_text: opts.promptText,
    prompt_lang,
    speed_factor: opts.speed ?? 1,
    streaming_mode: false,
    media_type: format,
  });

  // Strip trailing slash from baseUrl, append /api/tts
  const endpoint = `${opts.baseUrl.replace(/\/+$/, "")}${TTS_PATH}`;
  log({ stage: "request_start", endpoint, format, textLen: opts.text.length });

  // 3) Send request + full timeout control and buffer protection with transient retry
  const maxAttempts = opts.timeoutMs && opts.timeoutMs < 5000 ? 1 : 3;
  let audio!: Buffer;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const message = `GPT-SoVITS returned HTTP ${res.status}: ${text.slice(0, 300)}`;
        log({ stage: "http_error", status: res.status, body: text.slice(0, 300) });
        throw new Error(message);
      }

      const arrayBuf = await res.arrayBuffer();
      audio = Buffer.from(arrayBuf);
      log({ stage: "audio_received", bytes: audio.length, costMs: Date.now() - startedAt });

      if (audio.length === 0) {
        throw new Error("GPT-SoVITS returned empty audio buffer");
      }
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isTransient = String(lastErr).includes("ECONNREFUSED") || String(lastErr).includes("fetch failed");
      if (attempt < maxAttempts && isTransient) {
        log({ stage: "retry_waiting", attempt, error: String(lastErr) });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }

  // Validate magic bytes: wav starts with "RIFF", mp3 starts with ID3 or 0xFF 0xFB
  const isWav = audio.slice(0, 4).toString("ascii") === "RIFF";
  const isMp3 = audio[0] === 0x49 /* I (ID3) */ || audio[0] === 0xff;
  if (format === "wav" && !isWav && !isMp3) {
    log({ phase: "warn", message: "Expected WAV audio but the response did not have a RIFF header", firstBytes: audio.slice(0, 4).toString("hex") });
  }

  log({
    phase: "response.final",
    durationMs: Date.now() - startedAt,
    audioBytes: audio.length,
    isWav,
    isMp3,
  });

  return { audio, format };
}

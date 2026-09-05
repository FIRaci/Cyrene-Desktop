// MiniMax TTS engine
//
// Three core functions:
// 1. uploadFile — Upload audio file (voice/sample), get file_id
// 2. cloneVoice — Rapid voice cloning, upload file_id + voice_id for training
// 3. synthesize — WebSocket streaming speech synthesis, returns complete audio buffer
//
// API Reference: https://platform.minimaxi.com/document
// Auth: Authorization: Bearer {API_KEY}

import * as fs from "fs";
import * as path from "path";
import { WebSocket } from "ws";

const BASE_URL = "https://api.minimaxi.com";
const WS_URL = "wss://api.minimaxi.com/ws/v1/t2a_v2";
const HTTP_TIMEOUT_MS = 60_000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// ── Upload Audio File ──────────────────────────────────────────────

export interface UploadedFile {
  file_id: string;
  bytes: number;
  filename: string;
  purpose: string;
}

/**
 * Upload audio file (voice clone or prompt audio sample), returns file_id.
 * - purpose="voice_clone": voice sample (10s to 5min, <=20MB)
 * - purpose="prompt_audio": prompt sample (<=8s, <=20MB)
 */
export async function uploadFile(
  apiKey: string,
  filePath: string,
  purpose: "voice_clone" | "prompt_audio",
): Promise<UploadedFile> {
  const fileName = path.basename(filePath);
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("The selected audio path is not a file.");
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error("The selected audio file exceeds the 20 MB limit.");
  const fileBuffer = await fs.promises.readFile(filePath);

  // Construct multipart/form-data
  const boundary = "----CyreneTTS" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];

  // purpose field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`,
    ),
  );

  // file field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const response = await fetch(`${BASE_URL}/v1/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  const data = (await response.json()) as {
    file?: { file_id: string; bytes: number; filename: string; purpose: string };
    base_resp?: { status_code: number; status_msg: string };
  };

  if (data.base_resp?.status_code !== 0 || !data.file) {
    throw new Error(`Upload failed: ${data.base_resp?.status_msg ?? "Unknown error"} (code: ${data.base_resp?.status_code})`);
  }

  return {
    file_id: String(data.file.file_id),
    bytes: data.file.bytes,
    filename: data.file.filename,
    purpose: data.file.purpose,
  };
}

// ── Rapid Voice Clone ──────────────────────────────────────────────

export interface CloneVoiceOptions {
  apiKey: string;
  fileId: string;              // Voice file file_id
  voiceId: string;             // Custom voice ID (user defined)
  promptAudioId?: string;      // Prompt audio file_id (optional)
  promptText?: string;         // Transcript text for prompt audio (optional)
  text: string;                // Clone comparison text (synthesized during training for comparison)
  model?: string;              // Default speech-2.8-hd
}

export interface CloneVoiceResult {
  voiceId: string;
  audioDemo?: string;          // Preview audio download URL (if available)
  raw: unknown;
}

/**
 * Rapid voice cloning. After uploading file_id + voice_id, MiniMax trains the voice.
 * On success, voice_id can be used for subsequent synthesize calls.
 */
export async function cloneVoice(opts: CloneVoiceOptions): Promise<CloneVoiceResult> {
  const payload: Record<string, unknown> = {
    file_id: Number(opts.fileId),
    voice_id: opts.voiceId,
    text: opts.text,
    model: opts.model ?? "speech-2.8-hd",
  };

  if (opts.promptAudioId && opts.promptText) {
    payload.clone_prompt = {
      prompt_audio: Number(opts.promptAudioId),
      prompt_text: opts.promptText,
    };
  }

  const response = await fetch(`${BASE_URL}/v1/voice_clone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  const data = (await response.json()) as {
    data?: { audio?: string; demo_audio?: string };
    base_resp?: { status_code: number; status_msg: string };
  };

  if (data.base_resp?.status_code !== 0) {
    throw new Error(`Voice cloning failed: ${data.base_resp?.status_msg ?? "Unknown error"} (code: ${data.base_resp?.status_code})`);
  }

  return {
    voiceId: opts.voiceId,
    audioDemo: data.data?.audio ?? data.data?.demo_audio,
    raw: data,
  };
}

// ── WebSocket Streaming Speech Synthesis ────────────────────────────────────

export interface SynthesizeOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  speed?: number;        // Speech speed 0.5~2, default 1
  volume?: number;       // Volume 0~2, default 1
  pitch?: number;        // Pitch -12~12, default 0
  model?: string;        // Default speech-2.8-hd
  format?: "mp3" | "wav" | "pcm";  // Default mp3
  sampleRate?: number;   // Default 32000
  debugLog?: (entry: Record<string, unknown>) => void; // Local diagnostic log (not uploaded)
  /** Streaming callback: invoked for each received audio chunk (passes base64). Omit for full buffer mode. */
  onChunk?: (chunkBase64: string) => void;
}

/**
 * WebSocket streaming speech synthesis.
 * Establish WS connection -> task_start -> task_continue (send text) -> receive hex audio chunks -> concatenate -> return full buffer.
 * Timeout 30 seconds.
 */
export async function synthesize(opts: SynthesizeOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    const requestId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    let audioHexChars = 0;
    let audioChunkCount = 0;
    let resolved = false;

    const log = (entry: Record<string, unknown>) => {
      try { opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry }); } catch { /* ignore */ }
    };

    log({
      phase: "request.begin",
      endpoint: WS_URL,
      textChars: Array.from(opts.text).length,
      textUtf8Bytes: Buffer.byteLength(opts.text, "utf8"),
      request: {
        task_start: {
          event: "task_start",
          model: opts.model ?? "speech-2.8-hd",
          voice_setting: {
            voice_id: opts.voiceId,
            speed: opts.speed ?? 1,
            vol: opts.volume ?? 1,
            pitch: opts.pitch ?? 0,
            english_normalization: false,
          },
          audio_setting: {
            sample_rate: opts.sampleRate ?? 32000,
            bitrate: 128000,
            format: opts.format ?? "mp3",
            channel: 1,
          },
        },
        task_continue: {
          event: "task_continue",
          text: opts.text,
        },
      },
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch { /* ignore */ }
        log({ phase: "error", error: "Speech synthesis timed out (30 seconds)", durationMs: Date.now() - startedAt });
        reject(new Error("Speech synthesis timed out (30 seconds)"));
      }
    }, 30000);

    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    ws.on("open", () => {
      log({ phase: "ws.open" });
      // After connection established, await connected_success from MiniMax
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          event?: string;
          data?: { audio?: string };
          is_final?: boolean;
          base_resp?: { status_code: number; status_msg: string };
        };

        // Connected successfully -> send task_start
        if (msg.event === "connected_success") {
          log({ phase: "response.event", event: msg.event, base_resp: msg.base_resp ?? null });
          const startMsg = {
            event: "task_start",
            model: opts.model ?? "speech-2.8-hd",
            voice_setting: {
              voice_id: opts.voiceId,
              speed: opts.speed ?? 1,
              vol: opts.volume ?? 1,
              pitch: opts.pitch ?? 0,
              english_normalization: false,
            },
            audio_setting: {
              sample_rate: opts.sampleRate ?? 32000,
              bitrate: 128000,
              format: opts.format ?? "mp3",
              channel: 1,
            },
          };
          ws.send(JSON.stringify(startMsg));
          log({ phase: "request.sent", event: "task_start" });
          return;
        }

        // Task started successfully -> send task_continue (send text)
        if (msg.event === "task_started") {
          log({ phase: "response.event", event: msg.event, base_resp: msg.base_resp ?? null });
          ws.send(JSON.stringify({ event: "task_continue", text: opts.text }));
          log({ phase: "request.sent", event: "task_continue", textChars: Array.from(opts.text).length });
          return;
        }

        // Received audio chunk -> hex decode and append. Audio payload is large, log length only.
        if (msg.data?.audio) {
          const chunkBuf = Buffer.from(msg.data.audio, "hex");
          audioChunks.push(chunkBuf);
          audioChunkCount += 1;
          audioHexChars += msg.data.audio.length;
          // Streaming mode: invoke callback on each chunk received (base64)
          if (opts.onChunk) {
            try { opts.onChunk(chunkBuf.toString("base64")); } catch { /* ignore */ }
          }
          log({ phase: "response.audio_chunk", hexChars: msg.data.audio.length, chunkIndex: audioChunkCount });
        }

        // Synthesis completed
        if (msg.is_final) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try { ws.send(JSON.stringify({ event: "task_finish" })); } catch { /* ignore */ }
            const audioBuffer = Buffer.concat(audioChunks);
            log({
              phase: "response.final",
              base_resp: msg.base_resp ?? null,
              durationMs: Date.now() - startedAt,
              audioChunkCount,
              audioHexChars,
              audioBytes: audioBuffer.length,
            });
            ws.close();
            resolve(audioBuffer);
          }
          return;
        }

        // Error
        if (msg.base_resp?.status_code && msg.base_resp.status_code !== 0) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            log({ phase: "error", base_resp: msg.base_resp, durationMs: Date.now() - startedAt });
            reject(new Error(`Synthesis failed: ${msg.base_resp.status_msg} (code: ${msg.base_resp.status_code})`));
          }
        }
      } catch (err) {
        // Single message parse failure does not affect overall flow
        log({ phase: "response.parse_error", error: err instanceof Error ? err.message : String(err), rawPreview: raw.toString().slice(0, 500) });
      }
    });

    ws.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log({ phase: "error", error: `WebSocket connection failed: ${err.message}`, durationMs: Date.now() - startedAt });
        reject(new Error(`WebSocket connection failed: ${err.message}`));
      }
    });

    ws.on("close", () => {
      log({ phase: "ws.close", resolved, durationMs: Date.now() - startedAt });
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // On connection close: if audio chunks already exist return buffer; otherwise error
        if (audioChunks.length > 0) {
          const audioBuffer = Buffer.concat(audioChunks);
          log({ phase: "response.close_with_audio", audioChunkCount, audioHexChars, audioBytes: audioBuffer.length });
          resolve(audioBuffer);
        } else {
          log({ phase: "error", error: "The connection closed before audio data was received", durationMs: Date.now() - startedAt });
          reject(new Error("The connection closed before audio data was received"));
        }
      }
    });
  });
}

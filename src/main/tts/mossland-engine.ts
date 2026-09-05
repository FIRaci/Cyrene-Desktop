// Mossland TTS engine (api.mosi.cn / Mossland cloud).
//
// Supported functions:
//   - synthesize()      POST /v1/audio/speech       Single speaker moss-tts (delivery_method=audio -> binary)
//   - cloneVoice()      POST /v1/audio/voices       multipart/form-data upload reference audio, returns voice_id
//   - listVoices()      GET  /v1/audio/voices       Fetch list of cloned voice_ids under account
//
// Deferred features:
//   - Multi-speaker model moss-ttsd (POST /v1/audio/speech/speakers)
//   - voice-generator model (POST /v1/audio/voice/generations)
//   - async / webhook (synchronous delivery_method=audio suffices for settings tests + chat auto-read)
//
// Error handling: Mossland error response is JSON { error: { message, type, param, code } },
// mapped to friendly messages by `code`, HTTP 5xx thrown directly.

import * as fs from "node:fs";
import * as path from "node:path";

const BASE_URL = "https://api.mosi.cn";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Error code -> user-friendly messages. Covers common codes documented by Mossland;
 * Falls back to server message field when encountering unlisted codes.
 */
const ERROR_CODE_MAP: Record<string, string> = {
  // 4xx
  missing_required_field: "A required field is missing. Check the request and try again.",
  invalid_field_value: "A field value is invalid. Check the request and try again.",
  unsupported_response_format: "Unsupported audio format. Use mp3, wav, or pcm.",
  invalid_url: "The URL is invalid.",
  url_not_allowed: "The URL is not allowed; use a public HTTPS URL.",
  insufficient_credits: "The account has insufficient credits.",
  authentication_error: "The API key is invalid. Check the Authorization header.",
  permission_error: "Permission denied. Check the API key permissions.",
  file_not_found: "The file was not found.",
  voice_not_found: "The voice was not found. Create it again and retry.",
  task_not_found: "The task was not found.",
  rate_limit_exceeded: "Too many requests. Try again later.",
  concurrency_limit_exceeded: "The concurrency limit was exceeded. Try again later.",
  safety_guardrail_blocked: "The content was blocked by the safety policy. Revise it and try again.",
  // 5xx
  internal: "The service encountered an internal error. Try again later.",
  upstream: "An upstream service failed. Try again later.",
  service: "The service is temporarily unavailable. Try again later.",
  timeout: "The request timed out. Try again later.",
};

interface MosslandErrorBody {
  error?: {
    // Synchronous error format (documented): message / type / param / code
    message?: string;
    type?: string;
    param?: string | null;
    code?: string;
    // Asynchronous / task failure format (observed): error_code / error_msg
    error_code?: number | string;
    error_msg?: string;
    internal_error_msg?: string;
  };
}

/** Parses fetch error responses into unified "code + message" for caller exceptions. */
function buildError(prefix: string, status: number, rawBody: string): Error {
  // HTTP 413: Gateway body size limit rejected before body parsing, no JSON error payload
  if (status === 413) {
    return new Error(`${prefix}: The uploaded file exceeds the service limit (HTTP 413). Compress or shorten the audio and try again.`);
  }
  // Attempt parsing JSON error body (Mossland has two formats: sync code/message, async error_code/error_msg)
  let code: string | undefined;
  let upstreamMsg: string | undefined;
  try {
    const parsed = JSON.parse(rawBody) as MosslandErrorBody;
    // Prioritize async / task failure format (error_code + error_msg)
    if (parsed.error?.error_msg) {
      code = String(parsed.error.error_code ?? "");
      upstreamMsg = parsed.error.error_msg;
    } else {
      // Synchronous error format (code + message)
      code = parsed.error?.code;
      upstreamMsg = parsed.error?.message;
    }
  } catch {
    // Non-JSON error payload (e.g. gateway interception), throw raw
    return new Error(`${prefix}：HTTP ${status} ${rawBody.slice(0, 200)}`);
  }
  const friendly = code && ERROR_CODE_MAP[code];
  const detail = friendly ?? upstreamMsg ?? `Unknown error (code: ${code ?? "?"})`;
  return new Error(`${prefix}：${detail} (HTTP ${status}${code ? `, code: ${code}` : ""})`);
}

/** Generic fetch wrapper: Bearer auth + AbortController timeout. */
async function mossFetch(
  url: string,
  init: RequestInit & { apiKey: string; timeoutMs?: number },
): Promise<Response> {
  const { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(rest.headers ?? {}),
      },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── synthesize ──────────────────────────────────────────────

export interface MosslandSynthesizeOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  speed?: number;
  volume?: number;
  model?: string;                       // Default "moss-tts"
  format?: "mp3" | "wav" | "pcm";       // Default "mp3"
}

export interface MosslandSynthesizeResult {
  audio: Buffer;
  format: "mp3" | "wav" | "pcm";
}

/**
 * Single speaker synthesis: POST /v1/audio/speech.
 * Uses delivery_method=audio to receive binary stream directly (avoids extra GET URL round-trip).
 */
export async function synthesize(opts: MosslandSynthesizeOptions): Promise<MosslandSynthesizeResult> {
  const format = opts.format ?? "mp3";
  const model = opts.model ?? "moss-tts";

  if (!opts.apiKey) throw new Error("Mossland synthesis failed: API key is required");
  if (!opts.voiceId) throw new Error("Mossland synthesis failed: voice_id is required; clone a voice first");
  if (!opts.text) throw new Error("Mossland synthesis failed: synthesis text is required");

  // Only send documented fields; Mossland validates strictly and returns 400 on unknown fields
  const body: Record<string, unknown> = {
    model,
    input: opts.text,
    voice_id: opts.voiceId,
    response_format: format,
    delivery_method: "audio",
  };

  const response = await mossFetch(`${BASE_URL}/v1/audio/speech`, {
    method: "POST",
    apiKey: opts.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text();
    console.error("[Mossland] Synthesis failed with HTTP", response.status, "body:", raw);
    throw buildError("Mossland synthesis failed", response.status, raw);
  }

  // delivery_method=audio: response body is direct audio binary
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("Mossland synthesis failed: the service returned empty audio");
  }
  return { audio, format };
}

// ── cloneVoice ──────────────────────────────────────────────

export interface MosslandCloneOptions {
  apiKey: string;
  filePath: string;             // Local audio absolute path
  name?: string;
  description?: string;
}

export interface MosslandCloneResult {
  voiceId: string;
  name?: string;
  createdAt?: number;           // Unix seconds
}

/**
 * Voice cloning: POST /v1/audio/voices (multipart/form-data).
 * Fields: audio_sample (required) + name (optional) + description (optional).
 */
export async function cloneVoice(opts: MosslandCloneOptions): Promise<MosslandCloneResult> {
  if (!opts.apiKey) throw new Error("Mossland voice cloning failed: API key is required");
  if (!opts.filePath || !fs.existsSync(opts.filePath)) {
    throw new Error(`Mossland voice cloning failed: reference audio does not exist (${opts.filePath ?? ""})`);
  }

  // Use fixed ASCII filename with original extension, avoiding non-ASCII header encoding issues
  const ext = path.extname(opts.filePath) || ".wav";
  const safeFileName = "audio_sample" + ext;
  const fileBuffer = fs.readFileSync(opts.filePath);

  // Build multipart/form-data (similar to minimax-engine.uploadFile)
  const boundary = "----CyreneMossland" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];

  // audio_sample file field
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio_sample"; filename="${safeFileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from("\r\n"));

  // Optional text fields: name / description (encoded as UTF-8)
  if (opts.name) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${opts.name}\r\n`,
        "utf-8",
      ),
    );
  }
  if (opts.description) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${opts.description}\r\n`,
        "utf-8",
      ),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const response = await mossFetch(`${BASE_URL}/v1/audio/voices`, {
    method: "POST",
    apiKey: opts.apiKey,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!response.ok) {
    const raw = await response.text();
    throw buildError("Mossland voice cloning failed", response.status, raw);
  }

  const data = (await response.json()) as {
    id?: string;
    object?: string;
    name?: string;
    created_at?: number;
  };
  if (!data.id) {
    throw new Error("Mossland voice cloning failed: the service did not return voice_id");
  }
  return {
    voiceId: data.id,
    name: data.name,
    createdAt: data.created_at,
  };
}

// ── listVoices ──────────────────────────────────────────────

export interface MosslandVoiceInfo {
  id: string;
  name: string;
  createdAt: number;            // Unix seconds
}

export interface MosslandListVoicesResult {
  voices: MosslandVoiceInfo[];
}

/**
 * Fetch list of cloned voices: GET /v1/audio/voices?limit=50.
 * Returns { data, has_more, ... }, takes data array.
 * Mossland API lacks GET /v1/audio/voices/{id}, so listing is used.
 */
export async function listVoices(opts: { apiKey: string; limit?: number }): Promise<MosslandListVoicesResult> {
  if (!opts.apiKey) throw new Error("Failed to list Mossland voices: API key is required");

  const limit = opts.limit ?? 50;
  const url = `${BASE_URL}/v1/audio/voices?limit=${limit}`;

  const response = await mossFetch(url, {
    method: "GET",
    apiKey: opts.apiKey,
  });

  if (!response.ok) {
    const raw = await response.text();
    throw buildError("Failed to list Mossland voices", response.status, raw);
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: string; name?: string; created_at?: number }>;
  };
  const voices: MosslandVoiceInfo[] = [];
  for (const v of data.data ?? []) {
    if (!v.id) continue;
    voices.push({
      id: v.id,
      name: v.name ?? "(unnamed)",
      createdAt: typeof v.created_at === "number" ? v.created_at : 0,
    });
  }
  return { voices };
}

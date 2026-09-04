// 自定义云端 TTS 引擎
// 固定 HTTP 合约：POST endpointUrl，返回音频二进制或 JSON base64。

export interface CustomCloudSynthesizeOptions {
  endpointUrl: string;
  apiKey?: string;
  voiceId?: string;
  text: string;
  speed?: number;
  volume?: number;
  format?: "wav" | "mp3";
  timeoutMs?: number;
  debugLog?: (entry: Record<string, unknown>) => void;
}

export interface CustomCloudSynthesizeResult {
  audio: Buffer;
  format: "wav" | "mp3";
}

const DEFAULT_TIMEOUT_MS = 30000;

function normalizeFormat(value: unknown, fallback: "wav" | "mp3"): "wav" | "mp3" {
  return value === "wav" || value === "mp3" ? value : fallback;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes("application/json");
}

function guessFormatFromContentType(contentType: string, fallback: "wav" | "mp3"): "wav" | "mp3" {
  const lower = contentType.toLowerCase();
  if (lower.includes("wav") || lower.includes("wave")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  return fallback;
}

export async function synthesize(opts: CustomCloudSynthesizeOptions): Promise<CustomCloudSynthesizeResult> {
  const endpointUrl = opts.endpointUrl?.trim();
  const text = opts.text?.trim();
  const format = opts.format ?? "mp3";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestId = `custom-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const log = (entry: Record<string, unknown>) => {
    try { opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry }); } catch { /* ignore */ }
  };

  if (!endpointUrl) throw new Error("Custom cloud TTS URL is required");
  if (!text) throw new Error("Synthesis text is required");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = opts.apiKey?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  log({
    phase: "request.begin",
    endpoint: endpointUrl,
    textChars: Array.from(text).length,
    format,
    timeoutMs,
  });

  let audio: Buffer;
  let resultFormat: "mp3" | "wav" | "pcm";

  try {
    const resp = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        voiceId: opts.voiceId?.trim() || undefined,
        speed: opts.speed ?? 1,
        volume: opts.volume ?? 1,
        format,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const preview = (await resp.text().catch(() => "")).slice(0, 200);
      log({ phase: "error", status: resp.status, bodyPreview: preview, durationMs: Date.now() - startedAt });
      throw new Error(`Custom cloud TTS synthesis failed: ${resp.status} ${preview}`.trim());
    }

    const contentType = resp.headers.get("Content-Type") ?? "";
    resultFormat = guessFormatFromContentType(contentType, format);

    const contentLengthHeader = Number(resp.headers.get("Content-Length"));
    if (contentLengthHeader && contentLengthHeader > 35 * 1024 * 1024) {
      throw new Error("Custom cloud TTS response Content-Length exceeds 35MB limit");
    }

    if (isJsonContentType(contentType)) {
      const rawText = await resp.text();
      if (rawText.length > 35 * 1024 * 1024) {
        throw new Error("Custom cloud TTS JSON text exceeds 35MB limit");
      }
      const data = JSON.parse(rawText) as {
        audioBase64?: unknown;
        format?: unknown;
      };
      if (typeof data.audioBase64 !== "string" || !data.audioBase64.trim()) {
        throw new Error("Custom cloud TTS response did not contain audioBase64");
      }
      // Reject oversized base64 payload (>35MB chars = ~25MB binary) before allocating Buffer
      if (data.audioBase64.length > 35 * 1024 * 1024) {
        throw new Error("Custom cloud TTS response base64 exceeds 25MB safety limit");
      }
      audio = Buffer.from(data.audioBase64, "base64");
      if (audio.length > 25 * 1024 * 1024) {
        throw new Error("Custom cloud TTS response audio exceeds 25MB safety limit");
      }
      resultFormat = normalizeFormat(data.format, format);
    } else {
      const arrayBuf = await resp.arrayBuffer();
      if (arrayBuf.byteLength > 25 * 1024 * 1024) {
        throw new Error("Custom cloud TTS response exceeds 25MB safety limit");
      }
      audio = Buffer.from(arrayBuf);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      log({ phase: "error", error: `Synthesis timed out (${timeoutMs}ms)`, durationMs: Date.now() - startedAt });
      throw new Error(`Custom cloud TTS synthesis timed out (${timeoutMs}ms)`);
    }
    log({ phase: "error", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt });
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }

  if (audio.length === 0) {
    throw new Error("Custom cloud TTS returned empty audio");
  }

  log({
    phase: "response.final",
    durationMs: Date.now() - startedAt,
    audioBytes: audio.length,
    format: resultFormat,
  });

  return { audio, format: resultFormat as "wav" | "mp3" };
}

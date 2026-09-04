// 小米 MiMo TTS 引擎
// 官方接口：POST /v1/chat/completions，返回 choices[0].message.audio.data base64。

import * as fs from "fs";
import * as path from "path";

export interface MimoSynthesizeOptions {
  apiKey: string;
  text: string;
  voiceAudioPath?: string;
  stylePrompt?: string;
  model?: "mimo-v2.5-tts-voiceclone";
  endpointUrl?: string;
  debugLog?: (entry: Record<string, unknown>) => void;
}

export interface MimoSynthesizeResult {
  audio: Buffer;
  format: "wav";
}

const DEFAULT_ENDPOINT_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const DEFAULT_MODEL: MimoSynthesizeOptions["model"] = "mimo-v2.5-tts-voiceclone";
const REQUEST_TIMEOUT_MS = 60_000;

function guessAudioMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "audio/mpeg";
}

function buildVoiceDataUrl(filePath: string): string {
  const audio = fs.readFileSync(filePath);
  if (audio.length === 0) {
    throw new Error("MiMo voice-clone audio is empty");
  }
  return `data:${guessAudioMime(filePath)};base64,${audio.toString("base64")}`;
}

export async function synthesize(opts: MimoSynthesizeOptions): Promise<MimoSynthesizeResult> {
  const apiKey = opts.apiKey?.trim();
  const text = opts.text?.trim();
  const endpointUrl = opts.endpointUrl?.trim() || DEFAULT_ENDPOINT_URL;
  const voiceAudioPath = opts.voiceAudioPath?.trim();
  const stylePrompt = opts.stylePrompt?.trim();
  const requestId = `mimo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const log = (entry: Record<string, unknown>) => {
    try { opts.debugLog?.({ requestId, ts: new Date().toISOString(), ...entry }); } catch { /* ignore */ }
  };

  if (!apiKey) throw new Error("MiMo API key is required");
  if (!text) throw new Error("Synthesis text is required");
  if (!voiceAudioPath) throw new Error("MiMo voice-clone audio is required");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (stylePrompt) messages.push({ role: "user", content: stylePrompt });
  messages.push({ role: "assistant", content: text });
  const voice = buildVoiceDataUrl(voiceAudioPath);

  log({
    phase: "request.begin",
    endpoint: endpointUrl,
    model: opts.model ?? DEFAULT_MODEL,
    voiceAudioPath,
    textChars: Array.from(text).length,
    hasStylePrompt: Boolean(stylePrompt),
  });

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages,
        audio: {
          format: "wav",
          voice,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    log({ phase: "error", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt });
    throw new Error(`MiMo TTS request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const preview = (await response.text().catch(() => "")).slice(0, 200);
    log({ phase: "error", status: response.status, bodyPreview: preview, durationMs: Date.now() - startedAt });
    throw new Error(`MiMo TTS synthesis failed: ${response.status} ${preview}`.trim());
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        audio?: {
          data?: unknown;
        };
      };
    }>;
  };
  const base64 = data.choices?.[0]?.message?.audio?.data;
  if (typeof base64 !== "string" || !base64.trim()) {
    throw new Error("MiMo TTS response did not contain audio data");
  }

  const audio = Buffer.from(base64, "base64");
  if (audio.length === 0) {
    throw new Error("MiMo TTS returned empty audio");
  }

  log({
    phase: "response.final",
    durationMs: Date.now() - startedAt,
    audioBytes: audio.length,
    format: "wav",
  });

  return { audio, format: "wav" };
}

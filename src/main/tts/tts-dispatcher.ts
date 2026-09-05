import * as fs from "fs";
import * as path from "path";
import { synthesize as minimaxSynthesize } from "./minimax-engine";
import { synthesize as gptsovitsSynthesize } from "./gptsovits-engine";
import { synthesize as customCloudSynthesize } from "./custom-cloud-engine";
import { synthesize as mimoSynthesize } from "./mimo-engine";
import { synthesize as mosslandSynthesize } from "./mossland-engine";
import { synthesizeEdgeTts } from "./edge-tts-engine";
import type { TtsEngine } from "../../shared/tts-types";

function getDefaultCyreneRefAudioPath(): string {
  const candidates: string[] = [];
  if (typeof process !== "undefined" && (process as unknown as { resourcesPath?: string }).resourcesPath) {
    candidates.push(path.join((process as unknown as { resourcesPath: string }).resourcesPath, "resources", "voice", "cyrene", "ref_audio.wav"));
  }
  candidates.push(path.join(process.cwd(), "resources", "voice", "cyrene", "ref_audio.wav"));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getDefaultCyrenePromptText(): string {
  const candidates: string[] = [];
  if (typeof process !== "undefined" && (process as unknown as { resourcesPath?: string }).resourcesPath) {
    candidates.push(path.join((process as unknown as { resourcesPath: string }).resourcesPath, "resources", "voice", "cyrene", "prompt_text.txt"));
  }
  candidates.push(path.join(process.cwd(), "resources", "voice", "cyrene", "prompt_text.txt"));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const text = fs.readFileSync(c, "utf8").trim();
        if (text) return text;
      } catch { /* ignore */ }
    }
  }
  return "";
}

export interface SynthesizeByEnginePayload {
  text: string;
  speed?: number;
  volume?: number;
  // minimax specific
  apiKey?: string;
  voiceId?: string;
  model?: string;
  // gptsovits specific
  baseUrl?: string;
  refAudioPath?: string;
  promptText?: string;
  textLang?: "en" | "zh";
  promptLang?: "en" | "zh";
  format?: "wav" | "mp3";
  // custom-cloud specific
  endpointUrl?: string;
  timeoutMs?: number;
  // mimo specific
  voiceAudioPath?: string;
  stylePrompt?: string;
  // mossland specific (overlaps with minimax fields: apiKey/voiceId/model/format, adds format option pcm)
  mosslandFormat?: "mp3" | "wav" | "pcm";
}

export interface SynthesizeByEngineResult {
  audio: Buffer;
  format: "wav" | "mp3" | "pcm";
}

/**
 * Dispatches to corresponding engine for synthesis based on engine option.
 * Call TTS bypasses cache (real-time priority).
 * Throws error when engine === "off".
 */
export async function synthesizeByEngine(
  engine: TtsEngine,
  payload: SynthesizeByEnginePayload,
): Promise<SynthesizeByEngineResult> {
  if (engine === "minimax") {
    if (!payload.apiKey || !payload.voiceId) {
      throw new Error("MiniMax TTS is missing apiKey/voiceId");
    }
    const audio = await minimaxSynthesize({
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      model: payload.model ?? "speech-2.8-turbo",
      format: payload.format ?? "mp3",
    });
    return { audio, format: payload.format ?? "mp3" };
  }

  if (engine === "gptsovits") {
    const baseUrl = payload.baseUrl || "http://127.0.0.1:9880";
    const defaultRef = getDefaultCyreneRefAudioPath();
    const refAudioPath = payload.refAudioPath || (fs.existsSync(defaultRef) ? defaultRef : payload.refAudioPath);
    const promptText = payload.promptText || getDefaultCyrenePromptText();

    if (!baseUrl || !refAudioPath || !promptText) {
      throw new Error("GPT-SoVITS TTS is missing baseUrl/refAudioPath/promptText");
    }
    const result = await gptsovitsSynthesize({
      baseUrl,
      refAudioPath,
      promptText,
      text: payload.text,
      textLang: payload.textLang,
      promptLang: payload.promptLang,
      speed: payload.speed,
      format: payload.format ?? "wav",
    });
    return { audio: result.audio, format: result.format };
  }

  if (engine === "custom-cloud") {
    if (!payload.endpointUrl) {
      throw new Error("Custom cloud TTS is missing endpointUrl");
    }
    const result = await customCloudSynthesize({
      endpointUrl: payload.endpointUrl,
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      format: payload.format ?? "mp3",
      timeoutMs: payload.timeoutMs,
    });
    return { audio: result.audio, format: result.format };
  }

  if (engine === "mimo") {
    if (!payload.apiKey || !payload.voiceAudioPath) {
      throw new Error("MiMo TTS is missing apiKey/voiceAudioPath");
    }
    const result = await mimoSynthesize({
      apiKey: payload.apiKey,
      voiceAudioPath: payload.voiceAudioPath,
      text: payload.text,
      stylePrompt: payload.stylePrompt ?? payload.promptText,
      model: "mimo-v2.5-tts-voiceclone",
    });
    return { audio: result.audio, format: result.format };
  }

  if (engine === "mossland") {
    if (!payload.apiKey || !payload.voiceId) {
      throw new Error("Mossland TTS is missing apiKey/voiceId");
    }
    const format = payload.mosslandFormat ?? "mp3";
    const result = await mosslandSynthesize({
      apiKey: payload.apiKey,
      voiceId: payload.voiceId,
      text: payload.text,
      speed: payload.speed,
      volume: payload.volume,
      model: payload.model ?? "moss-tts",
      format,
    });
    return { audio: result.audio, format: result.format };
  }

  if (engine === "edge") {
    const result = await synthesizeEdgeTts({
      text: payload.text,
      voice: payload.voiceId || undefined,
      pitch: "+10Hz",
      rate: "+3%",
    });
    return { audio: result.audio, format: "mp3" };
  }

  throw new Error(`TTS engine is not enabled (engine=${engine})`);
}

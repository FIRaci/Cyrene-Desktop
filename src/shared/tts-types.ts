// TTS engine shared types (shared between main / renderer).

export type TtsEngine = "off" | "web-speech" | "minimax" | "gptsovits" | "custom-cloud" | "mimo" | "mossland" | "edge";

export type GptsovitsLanguageMode = "english" | "original-mandarin";

/** GPT-SoVITS synthesis request (renderer -> main process IPC payload). */
export interface GptsovitsSynthesizeRequest {
  baseUrl: string;             // e.g. "http://localhost:9880", without path
  refAudioPath: string;        // Reference audio absolute path
  promptText: string;          // Prompt text corresponding to reference audio
  text: string;                // Text to synthesize
  languageMode?: GptsovitsLanguageMode;
  textLang?: "en" | "zh";
  promptLang?: "en" | "zh";
  speed?: number;              // 0.5~2, default 1
  format?: "wav" | "mp3";      // Default wav
}

/** Custom cloud TTS synthesis request (renderer -> main process IPC payload). */
export interface CustomCloudSynthesizeRequest {
  endpointUrl: string;          // User custom cloud TTS endpoint
  apiKey?: string;              // Optional; Authorization header omitted when empty
  voiceId?: string;             // Optional voice ID, forwarded to user cloud gateway
  text: string;                 // Text to synthesize
  speed?: number;               // 0.5~2, default 1
  volume?: number;              // 0~1, default 1
  format?: "wav" | "mp3";       // Default mp3
  timeoutMs?: number;           // Default 30000
}

/** Xiaomi MiMo TTS synthesis request (renderer -> main process IPC payload). */
export interface MimoSynthesizeRequest {
  apiKey: string;               // Xiaomi MiMo API Key, passed via api-key header
  text: string;                 // Text to synthesize
  voiceAudioPath?: string;      // Cyrene cloned reference audio path, converted to data URL during synthesis
  stylePrompt?: string;         // Optional style prompt as user message
}

/** Mossland TTS synthesis request (renderer -> main process IPC payload).
 *  Base URL fixed to https://api.mosi.cn/v1, hardcoded in main process;
 *  User only provides apiKey + cloned voiceId + text. */
export interface MosslandSynthesizeRequest {
  apiKey: string;               // Bearer token
  voiceId: string;              // Required: voice_id obtained from clone
  text: string;                 // Text to synthesize
  speed?: number;               // 0.5~2, default 1
  volume?: number;              // 0~1, default 1
  model?: string;               // Default "moss-tts"; moss-ttsd (multi-speaker) not yet supported
  format?: "mp3" | "wav" | "pcm";  // Default "mp3"
}

/** Mossland voice clone request (multipart/form-data uploaded to POST /v1/audio/voices). */
export interface MosslandCloneRequest {
  apiKey: string;
  filePath: string;             // Local audio absolute path, read by main process then sent via multipart
  name?: string;                // Optional, name for voice
  description?: string;         // Optional, description for voice
}

/** Mossland clone response. */
export interface MosslandCloneResult {
  voiceId: string;              // ID returned by server
  name?: string;
  createdAt?: number;           // Unix seconds
}

/** One entry in Mossland voice list. */
export interface MosslandVoiceInfo {
  id: string;                   // voice_id
  name: string;
  createdAt: number;            // Unix seconds
}

/** Mossland list voices response. */
export interface MosslandListVoicesResult {
  voices: MosslandVoiceInfo[];
}

/** TTS synthesis response (main process -> renderer IPC response). Shared across engines. */
export interface TtsSynthesizeResult {
  base64: string;              // Audio bytes in base64
  cacheKey: string;            // Cache key (for replay)
  cached: boolean;             // Whether cache was hit
  format: "wav" | "mp3" | "pcm"; // Actual returned audio format; mossland may return pcm
}

/** Canonical list of allowed GeneralSettings mutation keys through the TTS IPC channel. */
export const ALLOWED_TTS_SETTING_KEYS = [
  "ttsEngine",
  "ttsAutoRead",
  "ttsSpeed",
  "ttsVolume",
  "ttsMinimaxKey",
  "ttsMinimaxVoiceId",
  "ttsMinimaxModel",
  "ttsStreaming",
  "ttsGptsovitsBaseUrl",
  "ttsGptsovitsRefAudioPath",
  "ttsGptsovitsPromptText",
  "ttsGptsovitsFormat",
  "ttsGptsovitsLanguageMode",
  "ttsRvcEnabled",
  "ttsRvcBaseUrl",
  "ttsRvcModel",
  "ttsRvcPitch",
  "ttsRvcIndexRate",
  "ttsCustomCloudEndpointUrl",
  "ttsCustomCloudApiKey",
  "ttsCustomCloudVoiceId",
  "ttsCustomCloudFormat",
  "ttsCustomCloudTimeoutMs",
  "ttsMimoKey",
  "ttsMimoVoiceAudioPath",
  "ttsMimoStylePrompt",
  "ttsMosslandKey",
  "ttsMosslandVoiceId",
  "ttsMosslandModel",
  "ttsMosslandTestText",
  "ttsMosslandFormat",
  "searchMinimaxKey",
  "searchEngine",
  "playwrightMcpEnabled",
  "proactiveChatMode",
] as const;

export type TtsSettingKey = typeof ALLOWED_TTS_SETTING_KEYS[number];

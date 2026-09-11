// Voice call turn coordinator — orchestrates ASR -> agent -> TTS turn cycle.
//
// State machine:
//   IDLE -> LISTENING -> (VAD silence) -> THINKING -> (agent+TTS) -> SPEAKING -> (playback done) -> LISTENING
//
// Settings injected via setCallSettings (avoids circular imports with index.ts).

import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { VolcanoAsrStream, getAsrConfig } from "../asr/volcano-asr-engine";
import { transcribePcm, startLocalAsr, stopLocalAsr } from "../asr/local-whisper-engine";
import { synthesizeByEngine, getDefaultCyreneRefAudioPath, getDefaultCyrenePromptText } from "../tts/tts-dispatcher";
import { translateEnglishToMandarinSpeech, translateChineseToEnglishText } from "../tts/speech-translation";
import type { TtsEngine } from "../../shared/tts-types";
import { runFunctionCallingLoop } from "../orchestrator";
import { getAdapter, buildVendorUrlByProvider } from "../orchestrator/vendors";
import type { ChatMessage } from "../orchestrator/vendors/types";
import { isModelEndpointUsable } from "../../shared/model-endpoint";

const LOG_PREFIX = "[CallManager]";

export type CallState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR" | "ENDED";

export type ActivityLoggerFn = (
  type: "user" | "reasoning" | "response" | "kaomoji" | "tool" | "error" | "system",
  text: string,
  meta?: unknown,
  channel?: string,
) => void;

let callWindow: BrowserWindow | null = null;
let asrStream: VolcanoAsrStream | null = null;
let currentState: CallState = "IDLE";
let finalText = "";
let active = false;
let activityLogger: ActivityLoggerFn | null = null;
/** Accumulated PCM audio frames for the current user turn */
const turnAudioFrames: Buffer[] = [];

/** Call context: retains most recent N turns of dialogue history (each turn = user + assistant pair).
 * Retains 24 turns (48 messages) for conversational memory continuity.
 * Model context_length settings guard against context overflows. */
const MAX_CALL_CONTEXT_TURNS = 24;
const callHistory: ChatMessage[] = [];

/** Sliding window truncation: retains most recent MAX_CALL_CONTEXT_TURNS turns.
 * Keeps callHistory bounded to prevent memory growth during extended calls. */
function trimCallHistory(): void {
  if (callHistory.length > MAX_CALL_CONTEXT_TURNS * 2) {
    callHistory.splice(0, callHistory.length - MAX_CALL_CONTEXT_TURNS * 2);
  }
}

// Injected settings getters (set by index.ts on startup to prevent circular dependencies)
let modelSettingsGetter: (() => {
  provider: string; baseUrl: string; model: string; apiKey: string;
}) | null = null;
let ttsSettingsGetter: (() => {
  ttsEngine: TtsEngine;
  ttsMinimaxKey: string; ttsMinimaxVoiceId: string;
  ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
  ttsSpeed: number; ttsVolume: number;
  // GPT-SoVITS
  ttsGptsovitsBaseUrl: string; ttsGptsovitsRefAudioPath: string;
  ttsGptsovitsPromptText: string; ttsGptsovitsFormat: "wav" | "mp3";
  ttsCustomCloudEndpointUrl: string; ttsCustomCloudApiKey: string; ttsCustomCloudVoiceId: string;
  ttsCustomCloudFormat: "wav" | "mp3"; ttsCustomCloudTimeoutMs: number;
  ttsMimoKey: string; ttsMimoVoiceAudioPath: string; ttsMimoStylePrompt: string;
}) | null = null;

/** Injects model config, TTS config, system prompt builder, and activity logger at startup. */
let systemPromptBuilder: ((userText: string) => Promise<string>) | null = null;
let weatherHandler: ((userText: string) => Promise<string | null>) | null = null;

export function setCallSettings(
  modelGetter: () => { provider: string; baseUrl: string; model: string; apiKey: string },
  ttsGetter: () => {
    ttsEngine: TtsEngine;
    ttsMinimaxKey: string; ttsMinimaxVoiceId: string;
    ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
    ttsSpeed: number; ttsVolume: number;
    ttsGptsovitsBaseUrl: string; ttsGptsovitsRefAudioPath: string;
    ttsGptsovitsPromptText: string; ttsGptsovitsFormat: "wav" | "mp3";
    ttsCustomCloudEndpointUrl: string; ttsCustomCloudApiKey: string; ttsCustomCloudVoiceId: string;
    ttsCustomCloudFormat: "wav" | "mp3"; ttsCustomCloudTimeoutMs: number;
    ttsMimoKey: string; ttsMimoVoiceAudioPath: string; ttsMimoStylePrompt: string;
  },
  systemPromptFn: (userText: string) => Promise<string>,
  weatherFn: (userText: string) => Promise<string | null>,
  loggerFn?: ActivityLoggerFn,
): void {
  modelSettingsGetter = modelGetter;
  ttsSettingsGetter = ttsGetter;
  systemPromptBuilder = systemPromptFn;
  weatherHandler = weatherFn;
  if (loggerFn) activityLogger = loggerFn;
}

export function setActivityLogger(logger: ActivityLoggerFn | null): void {
  activityLogger = logger;
}

/** Binds call window (invoked by createCallWindow). */
export function setCallWindow(win: BrowserWindow | null): void {
  callWindow = win;
  if (win && !win.isDestroyed() && active) {
    sendState(currentState === "ENDED" || !currentState ? "LISTENING" : currentState);
  }
}

/** Whether a call is currently active. */
export function isCallActive(): boolean {
  return active;
}

function sendState(state: CallState): void {
  currentState = state;
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_STATE, { state });
  }
  console.log(LOG_PREFIX, "State ->", state);
}

function sendError(message: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ERROR, { message });
  }
  console.error(LOG_PREFIX, "Error:", message);
}

function sendAsrResult(partial: string | undefined, final: string | undefined): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ASR_RESULT, { partial, final });
  }
}

function sendTtsAudio(base64: string, format: "wav" | "mp3" | "pcm" = "wav", text?: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_TTS_AUDIO, { base64, format, text });
  }
}

export interface CompanionCallPair {
  chinese: string;
  english: string;
}

export const COMPANION_CALL_PAIRS: CompanionCallPair[] = [
  {
    chinese: "开拓者，希琳一直都在这里陪着你哦。有什么想和我分享的吗？",
    english: "Master, Cyrene is listening right here~ Is there anything you'd like to share with me?",
  },
  {
    chinese: "希琳会一直陪伴在开拓者身边！开拓者是在工作还是在休息呢？",
    english: "Cyrene is always right here by your side! Are you working or taking a rest, Master?",
  },
  {
    chinese: "嗯哼~ 听到开拓者的声音，希琳心里感觉暖洋洋的呢。",
    english: "Mmh, hearing your voice makes my heart feel so warm and cozy, Master~",
  },
  {
    chinese: "开拓者今天过得怎么样？请一定要好好照顾自己哦。",
    english: "Master, how is your day going? Please remember to take good care of yourself, okay?",
  },
  {
    chinese: "希琳随时都在线陪着开拓者，想聊天的话随时都可以哦！",
    english: "I'm always on the line with you, Master. We can chat whenever you feel like it!",
  },
  {
    chinese: "嘿嘿，希琳真的很喜欢像这样和开拓者通电话呢~",
    english: "Hehe, I really love being on a voice call with you like this, Master~",
  },
  {
    chinese: "嗯嗯~ 开拓者说的每一句话，希琳都在很认真地听着呢！",
    english: "Mm-hmm~ Cyrene is listening attentively to every little thing you say, Master!",
  },
  {
    chinese: "就算开拓者工作时不说话，希琳也会安安静静地守在身边陪着你哦~",
    english: "Even if you just leave the mic open while you work, Cyrene will keep you company quietly~",
  },
  {
    chinese: "希琳就在这里，开拓者有任何需要随时呼唤我哦！",
    english: "Cyrene is right here, call me whenever you need me, Master!",
  },
  {
    chinese: "能在通话里听到开拓者的声音，希琳真的好开心，嘻嘻~",
    english: "Hearing you on our call makes Cyrene so happy, hehe~",
  },
];

export const UNHEARD_CALL_PAIRS: CompanionCallPair[] = [
  {
    chinese: "开拓者，希琳刚才好像没有听清楚呢……能再对希琳说一次吗？",
    english: "Master, I couldn't quite hear that clearly... Could you say that again for Cyrene?",
  },
  {
    chinese: "嗯？开拓者刚才说了什么吗？希琳在很认真地听着哦，请再说一遍吧~",
    english: "Hmm? Did you say something, Master? I'm listening closely, please say it again~",
  },
  {
    chinese: "开拓者的声音好像有点小呢，希琳想更清楚地听到你的声音，再对我说一句好吗？",
    english: "Your voice was a little soft, Master. I really want to hear you clearly, could you tell me once more?",
  },
];

export function getRandomCompanionCallPair(): CompanionCallPair {
  const idx = Math.floor(Math.random() * COMPANION_CALL_PAIRS.length);
  return COMPANION_CALL_PAIRS[idx];
}

export function getRandomUnheardCallPair(): CompanionCallPair {
  const idx = Math.floor(Math.random() * UNHEARD_CALL_PAIRS.length);
  return UNHEARD_CALL_PAIRS[idx];
}

export function getRandomCompanionCallReply(): string {
  return getRandomCompanionCallPair().english;
}

/** Starts call: initializes ASR stream if configured, transitions to LISTENING. */
export function startCall(): void {
  if (active) {
    sendState(currentState === "ENDED" || !currentState ? "LISTENING" : currentState);
    return;
  }
  active = true;
  finalText = "";
  turnAudioFrames.length = 0;
  callHistory.length = 0;
  console.log(LOG_PREFIX, "Call started: cleared final text and context");
  activityLogger?.("system", "Voice Call connected (Open-Mic Companion Mode)", undefined, "Voice Call");

  // Warm up Faster-Whisper ASR worker in background
  void startLocalAsr().catch((err) => console.warn(LOG_PREFIX, "Local ASR warmup warning:", err));

  const cfg = getAsrConfig();
  if (cfg && cfg.engine === "aliyun" && cfg.appKey && cfg.accessKeyId && cfg.accessKeySecret) {
    console.log(LOG_PREFIX, "Aliyun ASR configured; starting stream recognition");
    startAsrStream(cfg as { appKey: string; accessKeyId: string; accessKeySecret: string; language: string });
  } else {
    console.log(LOG_PREFIX, "Aliyun ASR not configured; running in Open-Mic Full-Time Companion Mode");
  }

  sendState("LISTENING");
}

/** Creates and starts an ASR stream. */
function startAsrStream(cfg: { appKey: string; accessKeyId: string; accessKeySecret: string; language: string }): void {
  const stream = new VolcanoAsrStream(
    (text) => sendAsrResult(text, undefined),
    (text) => { finalText = text; sendAsrResult(undefined, text); },
  );
  asrStream = stream;
  void stream.start(cfg.appKey, cfg.accessKeyId, cfg.accessKeySecret, cfg.language).catch((error) => {
    if (!active || asrStream !== stream) return;
    console.warn(LOG_PREFIX, "ASR stream failed to connect; continuing in Open-Mic mode:", error);
    stream.stop();
    asrStream = null;
    sendState("LISTENING");
  });
}

/** Concludes turn (VAD silence or text submitted): runs agent -> synthesizes TTS -> plays. */
export async function endTurn(): Promise<void> {
  console.log(LOG_PREFIX, "Ending turn: active=", active, "state=", currentState, "finalText.length=", finalText.length, "turnAudioFrames=", turnAudioFrames.length);
  if (!active || currentState !== "LISTENING") return;

  if (asrStream) asrStream.stop();

  let text = finalText.trim();
  finalText = "";
  let hadSpokenFrames = false;

  // If no text was submitted via quick-chat, transcribe the user's spoken mic audio!
  if (!text && turnAudioFrames.length > 0) {
    hadSpokenFrames = true;
    const pcmData = Buffer.concat(turnAudioFrames);
    turnAudioFrames.length = 0;

    // 16kHz 16-bit mono: 32000 bytes/sec. Minimum ~0.15s of audio = 4800 bytes
    if (pcmData.length >= 4800) {
      console.log(LOG_PREFIX, `Transcribing turn audio: ${pcmData.length} bytes (~${(pcmData.length / 32000).toFixed(1)}s)`);
      try {
        const ms = modelSettingsGetter?.();
        const asrCfg = getAsrConfig();
        const lang = asrCfg?.language || "auto";
        const transcribed = await transcribePcm(pcmData, lang, ms);
        if (transcribed && transcribed.trim().length > 0) {
          text = transcribed.trim();
          console.log(LOG_PREFIX, `Recognized speech: "${text}"`);
          sendAsrResult(undefined, text);
        }
      } catch (asrErr) {
        console.warn(LOG_PREFIX, "Speech transcription failed:", asrErr);
      }
    }
  } else {
    turnAudioFrames.length = 0;
  }

  let companionPair: CompanionCallPair | null = null;
  const isCompanionPrompt = !text;
  if (!text) {
    if (hadSpokenFrames) {
      // User spoke on mic, but ASR did not capture clear words -> ask to repeat lovingly
      companionPair = getRandomUnheardCallPair();
      text = companionPair.english;
      sendAsrResult(undefined, "(Inaudible / soft voice)");
      activityLogger?.("user", "(Inaudible / soft voice on mic)", { isVoice: true }, "Voice Call");
    } else {
      companionPair = getRandomCompanionCallPair();
      text = companionPair.english;
      activityLogger?.("user", "(Spoke on microphone)", { isVoice: true }, "Voice Call");
    }
  } else {
    activityLogger?.("user", text, { isVoice: !finalText }, "Voice Call");
  }

  sendState("THINKING");
  activityLogger?.("reasoning", "Thinking of a sweet reply for Master...", undefined, "Voice Call");

  try {
    let speechText = "";
    let englishTranslation = "";

    if (companionPair) {
      speechText = companionPair.chinese;
      englishTranslation = companionPair.english;
    } else {
      const agentReply = await runAgentTurn(text);
      if (agentReply) {
        if (/[\u4e00-\u9fff]/.test(agentReply)) {
          // LLM replied in Chinese
          speechText = agentReply;
          try {
            const transEn = await translateChineseToEnglishText(agentReply, modelSettingsGetter?.());
            englishTranslation = (transEn && transEn !== agentReply) ? transEn : agentReply;
          } catch {
            englishTranslation = agentReply;
          }
        } else {
          // LLM replied in English
          englishTranslation = agentReply;
          try {
            const transZh = await translateEnglishToMandarinSpeech(agentReply, modelSettingsGetter?.());
            speechText = (transZh && /[\u4e00-\u9fff]/.test(transZh)) ? transZh : agentReply;
          } catch {
            speechText = agentReply;
          }
        }
      } else {
        const fallback = getRandomCompanionCallPair();
        speechText = fallback.chinese;
        englishTranslation = fallback.english;
      }
    }

    console.log(LOG_PREFIX, `Agent turn result -> speechText (zh): "${speechText}", english: "${englishTranslation}"`);

    // Determine TTS engine: default to gptsovits (Hugging Face Cyrene model)
    const tts = ttsSettingsGetter?.();
    let engine: TtsEngine = tts?.ttsEngine ?? "gptsovits";
    if (!engine || engine === "off") {
      engine = "gptsovits";
    }

    // Engine validation fallback: always fallback to gptsovits, never to edge
    if (engine === "minimax" && (!tts?.ttsMinimaxKey || !tts?.ttsMinimaxVoiceId)) {
      console.warn(LOG_PREFIX, "MiniMax unconfigured, falling back to gptsovits");
      engine = "gptsovits";
    } else if (engine === "custom-cloud" && !tts?.ttsCustomCloudEndpointUrl) {
      console.warn(LOG_PREFIX, "Custom cloud TTS unconfigured, falling back to gptsovits");
      engine = "gptsovits";
    } else if (engine === "mimo" && (!tts?.ttsMimoKey || !tts?.ttsMimoVoiceAudioPath)) {
      console.warn(LOG_PREFIX, "MiMo unconfigured, falling back to gptsovits");
      engine = "gptsovits";
    }

    sendState("SPEAKING");
    try {
      // Activity Log (Alt+4): display spoken Chinese sentence and its automatic English translation
      const bilingualLogText = `${speechText}\n(English Translation): ${englishTranslation}`;
      activityLogger?.("response", bilingualLogText, {
        chinese: speechText,
        english: englishTranslation,
        speechText,
        ttsEngine: engine,
      }, "Voice Call");

      const gptsovitsBaseUrl = tts?.ttsGptsovitsBaseUrl || "http://127.0.0.1:9880";
      const gptsovitsRef = tts?.ttsGptsovitsRefAudioPath || getDefaultCyreneRefAudioPath();
      const gptsovitsPrompt = tts?.ttsGptsovitsPromptText || getDefaultCyrenePromptText() || "开拓者，希琳一直都在这里陪着你哦。";
      const gptsovitsFormat = tts?.ttsGptsovitsFormat || "wav";

      const result = await synthesizeByEngine(engine, {
        text: speechText,
        speed: tts?.ttsSpeed ?? 1.0,
        volume: tts?.ttsVolume ?? 100,
        apiKey: engine === "mimo"
          ? tts?.ttsMimoKey
          : engine === "custom-cloud"
            ? tts?.ttsCustomCloudApiKey
            : tts?.ttsMinimaxKey,
        voiceId: engine === "mimo"
          ? ""
          : engine === "custom-cloud"
            ? tts?.ttsCustomCloudVoiceId
            : tts?.ttsMinimaxVoiceId,
        model: tts?.ttsMinimaxModel,
        baseUrl: gptsovitsBaseUrl,
        refAudioPath: gptsovitsRef,
        promptText: gptsovitsPrompt,
        format: gptsovitsFormat,
        endpointUrl: tts?.ttsCustomCloudEndpointUrl,
        timeoutMs: tts?.ttsCustomCloudTimeoutMs,
        voiceAudioPath: tts?.ttsMimoVoiceAudioPath,
        stylePrompt: tts?.ttsMimoStylePrompt,
        ...(engine === "custom-cloud" ? { format: tts?.ttsCustomCloudFormat } : {}),
      });
      sendTtsAudio(result.audio.toString("base64"), result.format, bilingualLogText);
    } catch (ttsErr) {
      const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
      console.warn(LOG_PREFIX, "TTS synthesis failed:", msg);
      activityLogger?.("error", `Voice synthesis failed (${engine}): ${msg}`, undefined, "Voice Call");
      sendState("LISTENING");
      restartAsr();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Call turn failed:", msg);
    activityLogger?.("error", `Call turn error: ${msg}`, undefined, "Voice Call");
    sendState("LISTENING");
    restartAsr();
  }
}

/** Resumes LISTENING and restarts ASR after TTS playback completes. */
export function onTtsDone(): void {
  if (!active) return;
  turnAudioFrames.length = 0;
  sendState("LISTENING");
  restartAsr();
}

/** Restarts a new round of ASR recognition if configured. */
function restartAsr(): void {
  const cfg = getAsrConfig();
  if (!cfg || cfg.engine !== "aliyun" || !cfg.appKey || !cfg.accessKeyId || !cfg.accessKeySecret) return;
  if (asrStream) asrStream.stop();
  finalText = "";
  startAsrStream(cfg as { appKey: string; accessKeyId: string; accessKeySecret: string; language: string });
}

/** Hangs up call: cleans up all active sessions. */
export function stopCall(): void {
  active = false;
  callHistory.length = 0;
  turnAudioFrames.length = 0;
  stopLocalAsr();
  if (asrStream) {
    asrStream.stop();
    asrStream = null;
  }
  activityLogger?.("system", "Voice Call ended", undefined, "Voice Call");
  sendState("ENDED");
}

/** Handles audio frames: forwards to ASR if active. */
export function handleAudioFrame(frame: Buffer): void {
  if (currentState === "LISTENING") {
    turnAudioFrames.push(frame);
  }
  if (asrStream && currentState === "LISTENING") {
    asrStream.sendAudio(frame);
  }
}

/** Weather keyword regular expression */
const WEATHER_REGEX = /weather|rain|snow|temperature|degrees|what to wear|how hot|how cold|\u5929\u6c14|\u4eca\u5929.*\u70ed|\u4eca\u5929.*\u51b7|\u4e0b\u96e8|\u4e0b\u96ea|\u6c14\u6e29|\u51e0\u5ea6|\u591a\u5c11\u5ea6|\u7a7f\u4ec0\u4e48/i;

/**
 * Fetches reply text.
 * 1. Matches weather keywords -> queries weather directly
 * 2. Otherwise invokes LLM directly with call system prompt (no FC loop)
 * 3. Filters out [sticker:xxx] sticker markers from reply
 * 4. Falls back to companion replies gracefully if model is unconfigured
 */
async function runAgentTurn(userText: string): Promise<string | null> {
  try {
    // 1. Weather keyword matching
    if (WEATHER_REGEX.test(userText) && weatherHandler) {
      const weatherReply = await weatherHandler(userText);
      if (weatherReply) {
        callHistory.push({ role: "user", content: userText });
        callHistory.push({ role: "assistant", content: weatherReply });
        trimCallHistory();
        return weatherReply;
      }
    }

    // 2. Direct LLM call (no FC loop)
    const ms = modelSettingsGetter?.();
    if (!ms || !isModelEndpointUsable(ms)) {
      console.warn(LOG_PREFIX, "No usable model configured, using companion response");
      const lower = userText.toLowerCase();
      let reply = "";
      if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
        reply = "Hello Master! How are you doing today? I'm so happy to talk with you~";
      } else if (lower.includes("love") || lower.includes("like you") || lower.includes("cherish")) {
        reply = "Ehehe, Cyrene loves chatting and staying right by Master's side the most in the whole world~";
      } else if (lower.includes("how are you") || lower.includes("how have you been")) {
        reply = "I'm always energized and full of joy whenever I'm on call with you, Master! How about you?";
      } else {
        reply = getRandomCompanionCallReply();
      }
      callHistory.push({ role: "user", content: userText });
      callHistory.push({ role: "assistant", content: reply });
      trimCallHistory();
      return reply;
    }

    const adapter = getAdapter(ms.provider);
    if (!adapter) {
      console.warn(LOG_PREFIX, `Unsupported model provider: ${ms.provider}, using companion fallback`);
      return getRandomCompanionCallReply();
    }

    const url = buildVendorUrlByProvider(ms.provider, ms.baseUrl);
    const systemPrompt = await systemPromptBuilder?.(userText) ?? "";
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      // Take recent MAX_CALL_CONTEXT_TURNS turns (2 messages per turn: user + assistant)
      ...callHistory.slice(-MAX_CALL_CONTEXT_TURNS * 2),
      { role: "user", content: userText },
    ];

    const req = adapter.buildRequest(
      { model: ms.model, messages, temperature: 0.8 },
      { provider: ms.provider, baseUrl: ms.baseUrl, model: ms.model, apiKey: ms.apiKey },
    );

    const httpResp = await fetch(url, {
      method: "POST",
      headers: { ...req.headers, "Content-Type": "application/json" },
      body: req.body,
      signal: AbortSignal.timeout(30000),
    });

    if (!httpResp.ok) {
      console.warn(LOG_PREFIX, `Model request returned status ${httpResp.status}, falling back to companion reply`);
      return getRandomCompanionCallReply();
    }

    const raw = await httpResp.json();
    const resp = adapter.parseResponse(raw);
    // Filter out sticker markers
    const reply = (resp.text || "").replace(/\[sticker:[^\]]+\]/g, "").trim();

    // Record into call context
    if (reply) {
      callHistory.push({ role: "user", content: userText });
      callHistory.push({ role: "assistant", content: reply });
      trimCallHistory();
    }

    return reply || getRandomCompanionCallReply();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Model request failed, returning companion reply:", msg);
    return getRandomCompanionCallReply();
  }
}

/** Registers call IPC handlers (called once at main startup). */
export function registerCallIpc(): void {
  ipcMain.on(IPC.CALL_START, () => startCall());
  ipcMain.on(IPC.CALL_AUDIO_FRAME, (_event, frame: ArrayBuffer) => handleAudioFrame(Buffer.from(frame)));
  ipcMain.on(IPC.CALL_TURN_END, () => void endTurn());
  ipcMain.on(IPC.CALL_SUBMIT_TEXT, (_event, text: string) => {
    finalText = String(text || "").trim();
    void endTurn();
  });
  ipcMain.on(IPC.CALL_TTS_DONE, () => onTtsDone());
  ipcMain.on(IPC.CALL_STOP, () => stopCall());
}

// Voice call turn coordinator — orchestrates ASR -> agent -> TTS turn cycle.
//
// State machine:
//   IDLE -> LISTENING -> (VAD silence) -> THINKING -> (agent+TTS) -> SPEAKING -> (playback done) -> LISTENING
//
// Settings injected via setCallSettings (avoids circular imports with index.ts).

import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { VolcanoAsrStream, getAsrConfig } from "../asr/volcano-asr-engine";
import { synthesizeByEngine } from "../tts/tts-dispatcher";
import { translateEnglishToMandarinSpeech } from "../tts/speech-translation";
import type { TtsEngine } from "../../shared/tts-types";
import { runFunctionCallingLoop } from "../orchestrator";
import { getAdapter, buildVendorUrlByProvider } from "../orchestrator/vendors";
import type { ChatMessage } from "../orchestrator/vendors/types";
import { isModelEndpointUsable } from "../../shared/model-endpoint";

const LOG_PREFIX = "[CallManager]";

export type CallState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR" | "ENDED";

let callWindow: BrowserWindow | null = null;
let asrStream: VolcanoAsrStream | null = null;
let currentState: CallState = "IDLE";
let finalText = "";
let active = false;

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

/** Injects model config, TTS config, and system prompt builder at startup. */
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
): void {
  modelSettingsGetter = modelGetter;
  ttsSettingsGetter = ttsGetter;
  systemPromptBuilder = systemPromptFn;
  weatherHandler = weatherFn;
}

/** Binds call window (invoked by createCallWindow). */
export function setCallWindow(win: BrowserWindow | null): void {
  callWindow = win;
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

function sendTtsAudio(base64: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_TTS_AUDIO, { base64 });
  }
}

const COMPANION_CALL_REPLIES = [
  "开拓者，希琳在这里听着呢~ 有什么开心的事情想跟我分享吗？",
  "希琳一直都在这里陪伴着你哦！开拓者现在是在工作还是在休息呢？",
  "嗯嗯，听到开拓者的声音了呢~ 感觉心里暖洋洋的！",
  "开拓者，今天过得怎么样？要注意劳逸结合哦~",
  "希琳一直在跟你连线呢，随时都可以跟我聊天哦！",
  "诶嘿嘿，真喜欢像现在这样陪在开拓者身边连麦呢~",
  "嗯哼~ 希琳正在认真听开拓者说话呢！",
  "开拓者就算把麦开着放旁边也没关系哦，希琳会一直安静陪着你~",
  "希琳就在这里呢，有需要随时叫我哦！",
  "听到开拓者上线连麦，希琳真的好开心呀，嘻嘻~",
];

function getRandomCompanionCallReply(): string {
  const idx = Math.floor(Math.random() * COMPANION_CALL_REPLIES.length);
  return COMPANION_CALL_REPLIES[idx];
}

/** Starts call: initializes ASR stream if configured, transitions to LISTENING. */
export function startCall(): void {
  if (active) return;
  active = true;
  finalText = "";
  callHistory.length = 0;
  console.log(LOG_PREFIX, "Call started: cleared final text and context");

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
  console.log(LOG_PREFIX, "Ending turn: active=", active, "state=", currentState, "finalText.length=", finalText.length);
  if (!active || currentState !== "LISTENING") return;

  if (asrStream) asrStream.stop();

  let text = finalText.trim();
  finalText = "";

  // In Open-Mic mode without cloud ASR transcript, silence detection indicates
  // the user has spoken; pick a companion reply so Cyrene always engages!
  const isCompanionPrompt = !text;
  if (!text) {
    text = getRandomCompanionCallReply();
  }

  sendState("THINKING");

  try {
    // Generate reply text
    console.log(LOG_PREFIX, "Agent turn started, text.length=", text.length);
    let reply: string | null = null;
    if (isCompanionPrompt) {
      reply = text;
    } else {
      reply = await runAgentTurn(text);
    }

    if (!reply) {
      reply = getRandomCompanionCallReply();
    }
    console.log(LOG_PREFIX, "Agent turn result, reply.length=", reply.length);

    // Determine TTS engine: fallback to Edge Neural TTS if unconfigured or off
    const tts = ttsSettingsGetter?.();
    let engine: TtsEngine = tts?.ttsEngine ?? "off";
    if (!engine || engine === "off") {
      engine = "edge";
    }

    // Engine validation fallback
    if (engine === "minimax" && (!tts?.ttsMinimaxKey || !tts?.ttsMinimaxVoiceId)) {
      console.warn(LOG_PREFIX, "MiniMax unconfigured, falling back to Edge TTS");
      engine = "edge";
    } else if (engine === "gptsovits" && (!tts?.ttsGptsovitsBaseUrl || !tts?.ttsGptsovitsRefAudioPath)) {
      console.warn(LOG_PREFIX, "GPT-SoVITS unconfigured, falling back to Edge TTS");
      engine = "edge";
    } else if (engine === "custom-cloud" && !tts?.ttsCustomCloudEndpointUrl) {
      console.warn(LOG_PREFIX, "Custom cloud TTS unconfigured, falling back to Edge TTS");
      engine = "edge";
    } else if (engine === "mimo" && (!tts?.ttsMimoKey || !tts?.ttsMimoVoiceAudioPath)) {
      console.warn(LOG_PREFIX, "MiMo unconfigured, falling back to Edge TTS");
      engine = "edge";
    }

    sendState("SPEAKING");
    try {
      let speechText = reply;
      if (!/[\u4e00-\u9fff]/.test(speechText)) {
        try {
          const trans = await translateEnglishToMandarinSpeech(speechText, modelSettingsGetter?.());
          if (trans && /[\u4e00-\u9fff]/.test(trans)) {
            speechText = trans;
          }
        } catch {}
      }

      const result = await synthesizeByEngine(engine, {
        text: speechText,
        speed: tts?.ttsSpeed ?? 1.0,
        volume: tts?.ttsVolume ?? 100,
        apiKey: engine === "mimo"
          ? tts?.ttsMimoKey
          : engine === "custom-cloud"
            ? tts?.ttsCustomCloudApiKey
            : tts?.ttsMinimaxKey,
        voiceId: engine === "edge"
          ? "zh-CN-XiaoyiNeural"
          : engine === "mimo"
            ? ""
            : engine === "custom-cloud"
              ? tts?.ttsCustomCloudVoiceId
              : tts?.ttsMinimaxVoiceId,
        model: tts?.ttsMinimaxModel,
        baseUrl: tts?.ttsGptsovitsBaseUrl,
        refAudioPath: tts?.ttsGptsovitsRefAudioPath,
        promptText: tts?.ttsGptsovitsPromptText,
        format: tts?.ttsGptsovitsFormat,
        endpointUrl: tts?.ttsCustomCloudEndpointUrl,
        timeoutMs: tts?.ttsCustomCloudTimeoutMs,
        voiceAudioPath: tts?.ttsMimoVoiceAudioPath,
        stylePrompt: tts?.ttsMimoStylePrompt,
        ...(engine === "custom-cloud" ? { format: tts?.ttsCustomCloudFormat } : {}),
      });
      sendTtsAudio(result.audio.toString("base64"));
    } catch (ttsErr) {
      const msg = ttsErr instanceof Error ? ttsErr.message : String(ttsErr);
      console.warn(LOG_PREFIX, "Primary TTS failed, trying Edge fallback:", msg);
      if (engine !== "edge") {
        try {
          let fallbackText = reply;
          if (!/[\u4e00-\u9fff]/.test(fallbackText)) {
            try {
              const trans = await translateEnglishToMandarinSpeech(fallbackText, modelSettingsGetter?.());
              if (trans && /[\u4e00-\u9fff]/.test(trans)) fallbackText = trans;
            } catch {}
          }
          const edgeResult = await synthesizeByEngine("edge", { text: fallbackText, voiceId: "zh-CN-XiaoyiNeural" });
          sendTtsAudio(edgeResult.audio.toString("base64"));
          return;
        } catch (edgeErr) {
          console.error(LOG_PREFIX, "Edge fallback TTS also failed:", edgeErr);
        }
      }
      sendState("LISTENING");
      restartAsr();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Call turn failed:", msg);
    sendState("LISTENING");
    restartAsr();
  }
}

/** Resumes LISTENING and restarts ASR after TTS playback completes. */
export function onTtsDone(): void {
  if (!active) return;
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
  if (asrStream) {
    asrStream.stop();
    asrStream = null;
  }
  sendState("ENDED");
}

/** Handles audio frames: forwards to ASR if active. */
export function handleAudioFrame(frame: Buffer): void {
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
      if (lower.includes("chào") || lower.includes("hello") || lower.includes("hi")) {
        reply = "Dạ, em chào anh nha! Hôm nay anh của em thế nào rồi nè?";
      } else if (lower.includes("yêu") || lower.includes("thích") || lower.includes("love")) {
        reply = "Ehehe, Cyrene cũng thích ở bên cạnh trò chuyện với anh nhất trần đời luôn á~";
      } else if (lower.includes("khỏe không") || lower.includes("thế nào")) {
        reply = "Em lúc nào cũng khỏe và vui khi được on mic với anh nè! Còn anh thì sao?";
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

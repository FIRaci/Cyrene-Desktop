import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../tts/tts-dispatcher", () => ({
  synthesizeByEngine: vi.fn(async () => ({ audio: Buffer.from("RIFFwavdata"), format: "wav" })),
  getDefaultCyreneRefAudioPath: () => "d:/ref.wav",
  getDefaultCyrenePromptText: () => "sample prompt",
}));

vi.mock("../tts/speech-translation", () => ({
  translateEnglishToMandarinSpeech: vi.fn(async () => "开拓者，希琳一直在听着呢~"),
  translateChineseToEnglishText: vi.fn(async () => "Master, Cyrene is listening right here~"),
}));

vi.mock("../asr/local-whisper-engine", () => ({
  transcribePcm: vi.fn(async (_pcm: Buffer) => "Hello Cyrene, good morning!"),
  startLocalAsr: vi.fn(async () => true),
  stopLocalAsr: vi.fn(() => {}),
}));

import {
  setCallSettings,
  setActivityLogger,
  setCallWindow,
  startCall,
  stopCall,
  endTurn,
  handleAudioFrame,
  isCallActive,
  ActivityLoggerFn,
} from "./call-manager";
import { synthesizeByEngine } from "../tts/tts-dispatcher";
import { transcribePcm } from "../asr/local-whisper-engine";

describe("CallManager Voice & Logging Contract", () => {
  const loggedEvents: Array<{ type: string; text: string; meta?: unknown; channel?: string }> = [];
  const fakeLogger: ActivityLoggerFn = (type, text, meta, channel) => {
    loggedEvents.push({ type, text, meta, channel });
  };

  const sentIpcMessages: Array<{ channel: string; payload: unknown }> = [];
  const fakeWebContents = {
    send: (channel: string, payload: unknown) => {
      sentIpcMessages.push({ channel, payload });
    },
  };
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: fakeWebContents,
  } as unknown as import("electron").BrowserWindow;

  beforeEach(() => {
    loggedEvents.length = 0;
    sentIpcMessages.length = 0;
    vi.clearAllMocks();
    stopCall();
    setCallWindow(fakeWindow);
    setActivityLogger(fakeLogger);
  });

  it("logs call start and stop to Activity Log with channel 'Voice Call'", () => {
    startCall();
    expect(isCallActive()).toBe(true);

    const startLog = loggedEvents.find(e => e.text.includes("Voice Call connected"));
    expect(startLog).toBeDefined();
    expect(startLog?.channel).toBe("Voice Call");
    expect(startLog?.type).toBe("system");

    stopCall();
    expect(isCallActive()).toBe(false);

    const endLog = loggedEvents.find(e => e.text.includes("Voice Call ended"));
    expect(endLog).toBeDefined();
    expect(endLog?.channel).toBe("Voice Call");
    expect(endLog?.type).toBe("system");
  });

  it("concludes open-mic speech turn with English companion reply, calls TTS and logs to Activity Log", async () => {
    setCallSettings(
      () => ({ provider: "test", baseUrl: "http://test", model: "test", apiKey: "test" }),
      () => ({
        ttsEngine: "gptsovits",
        ttsMinimaxKey: "",
        ttsMinimaxVoiceId: "",
        ttsMinimaxModel: "speech-2.8-turbo",
        ttsSpeed: 1,
        ttsVolume: 100,
        ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "",
        ttsGptsovitsPromptText: "",
        ttsGptsovitsFormat: "wav",
        ttsCustomCloudEndpointUrl: "",
        ttsCustomCloudApiKey: "",
        ttsCustomCloudVoiceId: "",
        ttsCustomCloudFormat: "wav",
        ttsCustomCloudTimeoutMs: 10000,
        ttsMimoKey: "",
        ttsMimoVoiceAudioPath: "",
        ttsMimoStylePrompt: "",
      }),
      async () => "system prompt",
      async () => null,
      fakeLogger,
    );

    startCall();
    await endTurn();

    // User turn should be logged as speaking on microphone
    const userLog = loggedEvents.find(e => e.type === "user");
    expect(userLog).toBeDefined();
    expect(userLog?.channel).toBe("Voice Call");

    // Reasoning should be logged
    const reasoningLog = loggedEvents.find(e => e.type === "reasoning");
    expect(reasoningLog).toBeDefined();
    expect(reasoningLog?.channel).toBe("Voice Call");

    // Response should be logged with Chinese dialogue and English translation
    const responseLog = loggedEvents.find(e => e.type === "response");
    expect(responseLog).toBeDefined();
    expect(responseLog?.channel).toBe("Voice Call");
    expect(responseLog?.text).toMatch(/Master|Cyrene/);
    expect(responseLog?.text).toContain("(English Translation):");
    expect((responseLog?.meta as Record<string, unknown>)?.chinese).toBeDefined();
    expect((responseLog?.meta as Record<string, unknown>)?.english).toBeDefined();

    // synthesizeByEngine should be invoked with resolved GPT-SoVITS defaults
    expect(synthesizeByEngine).toHaveBeenCalledWith("gptsovits", expect.objectContaining({
      baseUrl: "http://127.0.0.1:9880",
      refAudioPath: "d:/ref.wav",
      format: "wav",
    }));

    // Audio should be sent to renderer with format
    const ttsIpc = sentIpcMessages.find(m => m.channel === "call:tts-audio");
    expect(ttsIpc).toBeDefined();
    expect(ttsIpc?.payload).toEqual(expect.objectContaining({
      format: "wav",
    }));

    stopCall();
  });

  it("accumulates microphone audio frames and transcribes speech into user text", async () => {
    let receivedUserText = "";
    setCallSettings(
      () => ({ provider: "test", baseUrl: "http://test", model: "test", apiKey: "test" }),
      () => ({
        ttsEngine: "gptsovits",
        ttsMinimaxKey: "",
        ttsMinimaxVoiceId: "",
        ttsMinimaxModel: "speech-2.8-turbo",
        ttsSpeed: 1,
        ttsVolume: 100,
        ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "",
        ttsGptsovitsPromptText: "",
        ttsGptsovitsFormat: "wav",
        ttsCustomCloudEndpointUrl: "",
        ttsCustomCloudApiKey: "",
        ttsCustomCloudVoiceId: "",
        ttsCustomCloudFormat: "wav",
        ttsCustomCloudTimeoutMs: 10000,
        ttsMimoKey: "",
        ttsMimoVoiceAudioPath: "",
        ttsMimoStylePrompt: "",
      }),
      async (userText) => {
        receivedUserText = userText;
        return "system prompt";
      },
      async () => null,
      fakeLogger,
    );

    startCall();

    // Send 10,000 bytes of PCM audio frames (exceeds 8000 bytes threshold)
    const frame = Buffer.alloc(1000);
    for (let i = 0; i < 10; i++) {
      handleAudioFrame(frame);
    }

    await endTurn();

    // Should have called transcribePcm
    expect(transcribePcm).toHaveBeenCalled();

    // The recognized user text should be sent via IPC to the call window
    const asrIpc = sentIpcMessages.find(m => m.channel === "call:asr-result");
    expect(asrIpc).toBeDefined();
    expect(asrIpc?.payload).toEqual({ partial: undefined, final: "Hello Cyrene, good morning!" });

    // The system prompt builder received the recognized speech
    expect(receivedUserText).toBe("Hello Cyrene, good morning!");

    // User turn should be logged with the actual spoken text
    const userLog = loggedEvents.find(e => e.type === "user" && e.text === "Hello Cyrene, good morning!");
    expect(userLog).toBeDefined();

    stopCall();
  });

  it("handles inaudible speech frames by asking Master to repeat gently", async () => {
    vi.mocked(transcribePcm).mockResolvedValueOnce("");

    setCallSettings(
      () => ({ provider: "test", baseUrl: "http://test", model: "test", apiKey: "test" }),
      () => ({
        ttsEngine: "gptsovits",
        ttsMinimaxKey: "",
        ttsMinimaxVoiceId: "",
        ttsMinimaxModel: "speech-2.8-turbo",
        ttsSpeed: 1,
        ttsVolume: 100,
        ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "",
        ttsGptsovitsPromptText: "",
        ttsGptsovitsFormat: "wav",
        ttsCustomCloudEndpointUrl: "",
        ttsCustomCloudApiKey: "",
        ttsCustomCloudVoiceId: "",
        ttsCustomCloudFormat: "wav",
        ttsCustomCloudTimeoutMs: 10000,
        ttsMimoKey: "",
        ttsMimoVoiceAudioPath: "",
        ttsMimoStylePrompt: "",
      }),
      async () => "system prompt",
      async () => null,
      fakeLogger,
    );

    startCall();

    const frame = Buffer.alloc(1000);
    for (let i = 0; i < 6; i++) {
      handleAudioFrame(frame);
    }

    await endTurn();

    expect(transcribePcm).toHaveBeenCalled();

    // The ASR IPC should report inaudible voice
    const asrIpc = sentIpcMessages.find(m => m.channel === "call:asr-result");
    expect(asrIpc).toBeDefined();
    expect(asrIpc?.payload).toEqual({ partial: undefined, final: "(Inaudible / soft voice)" });

    // The response text should contain an unheard/repeat prompt
    const responseLog = loggedEvents.find(e => e.type === "response");
    expect(responseLog).toBeDefined();
    expect(responseLog?.text).toMatch(/say that again|say it again|tell me once more/i);

    stopCall();
  });
});


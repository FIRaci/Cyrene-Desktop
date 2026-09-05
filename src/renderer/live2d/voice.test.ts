import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanTextForSpeech, CompanionVoiceService } from "./voice";

describe("cleanTextForSpeech", () => {
  it("removes markdown formatting, headers, links and code blocks", () => {
    const raw = "# Hello\nHere is **bold** text and `code snippet` and [my link](https://example.com).";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toContain("Hello");
    expect(cleaned).toContain("bold text");
    expect(cleaned).toContain("my link");
    expect(cleaned).not.toContain("#");
    expect(cleaned).not.toContain("**");
    expect(cleaned).not.toContain("`code snippet`");
    expect(cleaned).not.toContain("https://example.com");
  });

  it("removes kaomojis inside standard and fullwidth parentheses", () => {
    const raw = "Cyrene is right here~ ✨ (｡♥‿♥｡) (*•̀ᴗ•́*)و ̑̑ （✿◠‿◠） How can I help you today?";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toContain("Cyrene is right here");
    expect(cleaned).toContain("How can I help you today?");
    expect(cleaned).not.toContain("｡♥‿♥｡");
    expect(cleaned).not.toContain("•̀ᴗ•́");
    expect(cleaned).not.toContain("✿◠‿◠");
    expect(cleaned).not.toContain("✨");
  });

  it("removes decorative standalone symbols and emojis", () => {
    const raw = "Ehehe~ 🌸 ⭐ That feels wonderful! 🥺❤️";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toContain("Ehehe");
    expect(cleaned).toContain("That feels wonderful!");
    expect(cleaned).not.toContain("🌸");
    expect(cleaned).not.toContain("⭐");
    expect(cleaned).not.toContain("🥺");
  });

  it("cleans Vietnamese text removing kaomojis and symbols while preserving accented Vietnamese characters", () => {
    const raw = "Xoa đầu nè~ Hehe, thích quá đi à... ✨ (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toContain("Xoa đầu nè");
    expect(cleaned).toContain("thích quá đi à");
    expect(cleaned).not.toContain("✨");
    expect(cleaned).not.toContain("⁄");
  });

  it("removes actions in asterisks (*...*) and thoughts in slashes (/.../)", () => {
    const raw = "*gently nuzzles* /Master is so kind.../ Good morning, Master!";
    const cleaned = cleanTextForSpeech(raw);
    expect(cleaned).toBe("Good morning, Master!");
    expect(cleaned).not.toContain("gently nuzzles");
    expect(cleaned).not.toContain("Master is so kind");
  });

  it("handles empty or whitespace strings gracefully", () => {
    expect(cleanTextForSpeech("")).toBe("");
    expect(cleanTextForSpeech("   ")).toBe("");
    expect(cleanTextForSpeech("✨ (｡♥‿♥｡) 🌸")).toBe("");
    expect(cleanTextForSpeech("*nuzzles* /thinking/")).toBe("");
  });
});

describe("CompanionVoiceService", () => {
  let mockSpeechSynthesis: any;
  let fakeLocalStorage: Record<string, string>;

  beforeEach(() => {
    fakeLocalStorage = {};
    mockSpeechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn((utterance: any) => {
        setTimeout(() => {
          utterance.onstart?.();
          setTimeout(() => {
            utterance.onend?.();
          }, 10);
        }, 0);
      }),
      getVoices: vi.fn(() => [
        { name: "Microsoft Huihui - Chinese", lang: "zh-CN" },
        { name: "Microsoft Zira - English", lang: "en-US" },
        { name: "Microsoft Haruka - Japanese", lang: "ja-JP" },
      ]),
    };

    vi.stubGlobal("window", {
      speechSynthesis: mockSpeechSynthesis,
      localStorage: {
        getItem: (k: string) => fakeLocalStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          fakeLocalStorage[k] = v;
        },
      },
    });
    vi.stubGlobal("localStorage", (window as any).localStorage);

    vi.stubGlobal("SpeechSynthesisUtterance", class {
      text: string;
      voice: any;
      pitch: number = 1;
      rate: number = 1;
      volume: number = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes with unmuted state and persists mute toggle", () => {
    const voice = new CompanionVoiceService({ initialMuted: false });
    expect(voice.isMuted()).toBe(false);

    voice.toggleMute();
    expect(voice.isMuted()).toBe(true);
    expect(fakeLocalStorage["cyrene-companion-voice-muted"]).toBe("true");

    voice.toggleMute();
    expect(voice.isMuted()).toBe(false);
    expect(fakeLocalStorage["cyrene-companion-voice-muted"]).toBe("false");

    voice.dispose();
  });

  it("speaks using Web Speech API and notifies callbacks", async () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    const voice = new CompanionVoiceService({
      initialMuted: false,
      onStartSpeaking: onStart,
      onStopSpeaking: onStop,
    });

    const success = await voice.speak("Hello Master! (｡♥‿♥｡)");
    expect(success).toBe(true);
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(mockSpeechSynthesis.speak).toHaveBeenCalled();

    // Verify utterance content was cleaned of kaomoji
    const utteranceArg = mockSpeechSynthesis.speak.mock.calls[0][0];
    expect(utteranceArg.text).toBe("Hello Master!");

    // Wait for async events
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(onStart).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();

    voice.dispose();
  });

  it("does not speak when muted", async () => {
    const voice = new CompanionVoiceService({ initialMuted: true });
    const success = await voice.speak("Hello there!");
    expect(success).toBe(false);
    expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    voice.dispose();
  });

  it("stops speech and cancels synthesis when stop() is called", () => {
    const onStop = vi.fn();
    const voice = new CompanionVoiceService({
      initialMuted: false,
      onStopSpeaking: onStop,
    });

    voice.stop();
    expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
    voice.dispose();
  });

  it("speaks pure English voice without translating to Chinese", async () => {
    const voice = new CompanionVoiceService({ initialMuted: false });
    await voice.speak("Cyrene is always right here by your side~ ✨ (｡♥‿♥｡)");

    const utteranceArg = mockSpeechSynthesis.speak.mock.calls[0][0];
    expect(utteranceArg.text).toBe("Cyrene is always right here by your side");
    expect(utteranceArg.lang).toBe("en-US");

    voice.dispose();
  });

  it("routes speech to GPT-SoVITS when ttsEngine is gptsovits", async () => {
    const synthesizeCachedGptsovits = vi.fn().mockResolvedValue({
      base64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      format: "wav",
    });

    (window as any).settings = {
      getGeneral: vi.fn().mockResolvedValue({
        ttsEngine: "gptsovits",
        ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "D:/models/ref.wav",
        ttsGptsovitsPromptText: "Prompt text",
        ttsGptsovitsFormat: "wav",
        ttsSpeed: 1,
      }),
    };

    (window as any).tts = {
      synthesizeCachedGptsovits,
    };

    const voice = new CompanionVoiceService({ initialMuted: false });
    const success = await voice.speak("Cyrene is always right here by your side~");

    expect(synthesizeCachedGptsovits).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:9880",
        refAudioPath: "D:/models/ref.wav",
        promptText: "Prompt text",
        format: "wav",
      }),
    );
    // Should NOT have called WebSpeech
    expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();

    delete (window as any).settings;
    delete (window as any).tts;
    voice.dispose();
  });

  it("does not fall back to robot WebSpeech when GPT-SoVITS is missing config", async () => {
    (window as any).settings = {
      getGeneral: vi.fn().mockResolvedValue({
        ttsEngine: "gptsovits",
        ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "",
        ttsGptsovitsPromptText: "",
      }),
    };

    (window as any).tts = {
      synthesizeCachedGptsovits: vi.fn(),
    };

    const voice = new CompanionVoiceService({ initialMuted: false });
    const success = await voice.speak("Hello there");

    expect(success).toBe(false);
    expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();

    delete (window as any).settings;
    delete (window as any).tts;
    voice.dispose();
  });
});


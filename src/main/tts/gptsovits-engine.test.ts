import { afterEach, describe, it, expect, vi } from "vitest";
import { synthesize } from "./gptsovits-engine";

vi.mock("fs", () => ({ existsSync: vi.fn(() => true) }));

describe("gptsovits-engine synthesize input validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when baseUrl is missing", async () => {
    await expect(synthesize({
      baseUrl: "",
      refAudioPath: "C:/x.wav",
      promptText: "hi",
      text: "hello",
    })).rejects.toThrow(/API URL/);
  });

  it("throws when refAudioPath is missing", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "",
      promptText: "hi",
      text: "hello",
    })).rejects.toThrow(/Reference audio/);
  });

  it("throws when promptText is missing", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "C:/nonexistent.wav",
      promptText: "",
      text: "hello",
    })).rejects.toThrow(/Reference audio transcript/);
  });

  it("throws when text is missing", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "C:/nonexistent.wav",
      promptText: "hi",
      text: "",
    })).rejects.toThrow(/Synthesis text|text/);
  });

  it("defaults both synthesis and reference languages to English", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("RIFFaudio").buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "D:/voices/cyrene-en.wav",
      promptText: "Hello, I am Cyrene.",
      text: "Welcome back.",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.text_lang).toBe("en");
    expect(body.prompt_lang).toBe("en");
  });

  it("allows an explicit Mandarin reference language without changing the app locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("RIFFaudio").buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "D:/voices/cyrene-zh.wav",
      promptText: "reference transcript",
      text: "translated speech payload",
      textLang: "zh",
      promptLang: "zh",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.text_lang).toBe("zh");
    expect(body.prompt_lang).toBe("zh");
  });
});

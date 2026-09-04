import { afterEach, describe, expect, it, vi } from "vitest";
import { convertVoiceWithRvc, isRvcServerReachable } from "./rvc-engine";

describe("rvc-engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns empty buffer when audio input is empty", async () => {
    const result = await convertVoiceWithRvc({
      audio: Buffer.alloc(0),
      baseUrl: "http://localhost:18888",
      modelName: "Cyrene",
    });
    expect(result.converted).toBe(false);
    expect(result.audio.length).toBe(0);
  });

  it("returns original audio when baseUrl is missing", async () => {
    const raw = Buffer.from("RIFFrawaudio");
    const result = await convertVoiceWithRvc({
      audio: raw,
      baseUrl: "",
      modelName: "Cyrene",
    });
    expect(result.converted).toBe(false);
    expect(result.audio).toBe(raw);
  });

  it("converts audio when RVC server returns JSON base64", async () => {
    const raw = Buffer.from("RIFFrawaudio");
    const convertedRaw = Buffer.from("RIFFconverted");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ audio: convertedRaw.toString("base64") }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await convertVoiceWithRvc({
      audio: raw,
      baseUrl: "http://localhost:18888",
      modelName: "Cyrene (Aiden Dawn)",
      pitch: 0,
      indexRate: 0.75,
    });

    expect(result.converted).toBe(true);
    expect(result.audio.toString()).toBe("RIFFconverted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model_name).toBe("Cyrene (Aiden Dawn)");
  });

  it("gracefully falls back to original audio if fetch errors", async () => {
    const raw = Buffer.from("RIFFrawaudio");
    const fetchMock = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await convertVoiceWithRvc({
      audio: raw,
      baseUrl: "http://localhost:18888",
      modelName: "Cyrene",
    });

    expect(result.converted).toBe(false);
    expect(result.audio).toBe(raw);
  });

  it("checks reachability correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const reachable = await isRvcServerReachable("http://localhost:18888");
    expect(reachable).toBe(true);
  });
});

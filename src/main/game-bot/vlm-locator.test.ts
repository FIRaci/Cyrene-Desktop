import { afterEach, describe, expect, it, vi } from "vitest";
import { check, isVlmConfigUsable, type ImgData, type VlmConfig } from "./vlm-locator";

const screen: ImgData = { base64: "c2NyZWVu", mime: "image/png" };

function response(content: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("game-bot VLM endpoint policy", () => {
  it("accepts a keyless loopback Ollama-compatible endpoint", () => {
    expect(isVlmConfigUsable({
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      model: "qwen2.5vl:latest",
    })).toBe(true);
  });

  it("rejects non-loopback endpoints without an API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = await check({
      baseUrl: "https://models.example.test/v1",
      apiKey: "",
      model: "vision-model",
    }, screen, "Is the dialog visible?");
    expect(answer).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never emits an empty Authorization header for keyless Ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('{"answer":true}'));
    vi.stubGlobal("fetch", fetchMock);
    const config: VlmConfig = {
      baseUrl: "http://localhost:11434/v1",
      apiKey: "   ",
      model: "qwen2.5vl:latest",
    };
    await expect(check(config, screen, "Is the dialog visible?")).resolves.toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(String(init.body)).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("sends a trimmed bearer token for authenticated remote endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('{"answer":false}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(check({
      baseUrl: "https://models.example.test/v1",
      apiKey: "  secret-token  ",
      model: "vision-model",
    }, screen, "Is the dialog visible?")).resolves.toBe(false);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-token",
    });
  });
});

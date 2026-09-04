import { afterEach, describe, expect, it, vi } from "vitest";
import { translateEnglishToMandarinSpeech } from "./speech-translation";

describe("translateEnglishToMandarinSpeech", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns empty string for blank input", async () => {
    const result = await translateEnglishToMandarinSpeech("   ", null);
    expect(result).toBe("");
  });

  it("falls back to original text when model endpoint is not usable", async () => {
    const result = await translateEnglishToMandarinSpeech("Hello Master", null);
    expect(result).toBe("Hello Master");
  });

  it("translates text when endpoint succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "主人，你好呀" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateEnglishToMandarinSpeech(
      "Hello Master",
      {
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "llama3.1:latest",
        apiKey: "",
      },
    );

    expect(result).toBe("主人，你好呀");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content).toBe("Hello Master");
  });

  it("falls back to original text on HTTP error without throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await translateEnglishToMandarinSpeech(
      "Hello Master",
      {
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "llama3.1:latest",
        apiKey: "",
      },
    );

    expect(result).toBe("Hello Master");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { captionImage, isVisionCaptionError } from "./vision-captioner";

describe("captionImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an English instruction while preserving a multilingual user query", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: Array<{ type: string; text?: string }> }>;
      };
      const instruction = body.messages[0].content[0].text ?? "";
      expect(instruction).toContain("You are an image-analysis assistant");
      expect(instruction).toContain("What is in this image?");
      expect(instruction).toContain("Reply in the user's language");
      return new Response(JSON.stringify({ choices: [{ message: { content: "a cat" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(captionImage(
      { base64: "AQID", mime: "image/png" },
      "What is in this image?",
      { baseUrl: "https://example.test/v1", apiKey: "test", model: "vision-test" },
    )).resolves.toBe("a cat");
  });

  it("returns English runtime errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream unavailable", { status: 503 })));

    const result = await captionImage(
      { base64: "AQID", mime: "image/png" },
      "",
      { baseUrl: "https://example.test/v1", apiKey: "test", model: "vision-test" },
    );

    expect(result).toContain("[Runtime error] Vision model request failed: HTTP 503");
    expect(result).not.toMatch(/[\u3400-\u9fff]/u);
    expect(isVisionCaptionError(result)).toBe(true);
  });

  it("recognizes current and legacy failure markers without misclassifying captions", () => {
    expect(isVisionCaptionError("[Runtime error] timeout")).toBe(true);
    expect(isVisionCaptionError("[\u9519\u8bef\u00b7\u8d85\u65f6]")).toBe(true);
    expect(isVisionCaptionError("A normal image caption")).toBe(false);
  });
});

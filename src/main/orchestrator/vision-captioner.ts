// vision-captioner - Sole contact point with multimodal protocols.
// Generic vision service: takes image + user query -> invokes vision model -> returns text.
// Agnostic to image source (read_image is just one caller), never touches filesystem.
// Always uses OpenAI-compatible image_url format, regardless of transport.
//
// Decisions are delegated entirely to the vision model: instead of locally discerning "specific vs broad",
// sends the original user utterance together with image, guided by framing instructions.

import { modelAuthorizationHeaders } from "../../shared/model-endpoint";

/** Vision model configuration (OpenAI compatible). */
export interface VisionConfig {
  baseUrl: string;  // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;    // e.g. gpt-4o / glm-5v-turbo / qwen-vl-max
}

/** Image data (raw base64 without data: prefix). */
export interface VisionImage {
  base64: string;
  mime: string;  // e.g. "image/png"
}

const VISION_TIMEOUT_MS = 30_000;
const VISION_ERROR_PREFIX = "[Runtime error]";

/** Recognize current failures and legacy localized failures during migration. */
export function isVisionCaptionError(value: string): boolean {
  return value.startsWith(VISION_ERROR_PREFIX) || value.startsWith("[\u9519\u8bef");
}

/**
 * Construct framing instructions. Judgment is delegated entirely to the vision model.
 * It understands whether "how many cats" means counting, or "are there typos" means OCR.
 * Instructions contain brevity constraints to prevent long text from overwhelming primary model context.
 */
function buildInstruction(userQuery: string): string {
  if (userQuery && userQuery.trim()) {
    return (
      "You are an image-analysis assistant. The user supplied an image and asked:\n" +
      '"' + userQuery + '"\n' +
      "Answer the question directly from the image. Be concise, state the conclusion clearly, and avoid unrelated detail. Reply in the user's language."
    );
  }
  return (
    "You are an image-analysis assistant. The user supplied an image without a specific question.\n" +
    "Objectively describe its main subjects, scene, visible text, and important details. Do not make unsupported guesses. Keep the description under 200 words and reply in the user's language when it can be inferred."
  );
}

/**
 * Invokes vision model to analyze an image.
 * @param image Image data
 * @param userQuery User query; empty string represents generic description
 * @param config Vision model config
 * @returns Textual response; returns error string on failure
 */
export async function captionImage(
  image: VisionImage,
  userQuery: string,
  config: VisionConfig,
): Promise<string> {
  const instruction = buildInstruction(userQuery);
  const dataUrl = "data:" + image.mime + ";base64," + image.base64;

  // Always OpenAI compatible format: image_url content block
  const body = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    // Omit temperature: different models impose different constraints.
    // Let each vendor use defaults for maximum compatibility.
    // Determinism is guaranteed by brevity instructions in buildInstruction.
    // 512 max_tokens suffices to prevent bloating primary context.
    // Only pass max_tokens for broadest compatibility.
    max_tokens: 512,
    stream: false,
  };

  const url = buildChatCompletionsUrl(config.baseUrl);

  // Progress signal: logs duration and endpoint
  console.log("[Vision] Calling vision model:", config.model, "url=" + url, "query.len=" + userQuery.length);
  const startMs = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...modelAuthorizationHeaders(config),
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("[Vision] Request failed HTTP " + resp.status, errText.slice(0, 200));
      return VISION_ERROR_PREFIX + " Vision model request failed: HTTP " + resp.status + " " + errText.slice(0, 200);
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text) {
      console.error("[Vision] Vision model returned no valid content");
      return VISION_ERROR_PREFIX + " The vision model returned no usable content";
    }

    console.log("[Vision] Done, duration=" + (Date.now() - startMs) + "ms, response length=" + text.length);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error("[Vision] Request timed out");
      return VISION_ERROR_PREFIX + " The vision model request timed out";
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Vision] Request error:", msg);
    return VISION_ERROR_PREFIX + " Vision model request failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

/** Join baseUrl + /chat/completions, handling optional trailing slash. */
function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return trimmed + "/chat/completions";
}

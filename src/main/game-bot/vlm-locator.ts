// vlm-locator — visual localization API (OpenAI compatible multi-image protocol).
// Follows multi-modal message structure, requesting coordinate/judgment JSON with multi-image support.
// Dedicated locator module for game-bot.

import { parseClickCoord, parseBoolAnswer, parseMatchIndex } from "./coords";
import { isModelEndpointUsable, modelAuthorizationHeaders } from "../../shared/model-endpoint";

export interface VlmConfig {
  baseUrl: string;  // e.g. https://api.siliconflow.cn/v1
  apiKey: string;
  model: string;    // e.g. Qwen/Qwen3-VL-8B-Instruct
}

export function isVlmConfigUsable(config: VlmConfig): boolean {
  return isModelEndpointUsable(config);
}

/** Image data (raw base64 without data: prefix + mime). */
export interface ImgData {
  base64: string;
  mime: string;
}

const VLM_TIMEOUT_MS = 30_000;

/** Joins baseUrl + /chat/completions, handling trailing slashes cleanly. */
function chatUrl(baseUrl: string): string {
  const t = baseUrl.trim().replace(/\/+$/, "");
  if (t.endsWith("/chat/completions")) return t;
  return t + "/chat/completions";
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Sends multi-image chat request, returns assistant text. Returns empty string on failure. */
async function chat(config: VlmConfig, instruction: string, images: ImgData[]): Promise<string> {
  if (!isVlmConfigUsable(config)) {
    console.error("[GameBot] VLM configuration is incomplete or requires an API key.");
    return "";
  }
  const content: ContentBlock[] = [{ type: "text", text: instruction }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: "data:" + img.mime + ";base64," + img.base64 } });
  }
  const body = {
    model: config.model,
    messages: [{ role: "user", content }],
    max_tokens: 512,
    stream: false,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
  try {
    const resp = await fetch(chatUrl(config.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...modelAuthorizationHeaders(config) },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("[GameBot] VLM request failed with HTTP", resp.status, t.slice(0, 200));
      return "";
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    return data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("[GameBot] VLM request failed:", err instanceof Error ? err.message : err);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Localization click: reference image (target element) + current screenshot -> target screen coordinates.
 * images order: reference image first, current screenshot last. screenW/H converts normalized coordinates to pixels.
 * Returns null if not found or on failure.
 */
export async function locate(
  config: VlmConfig,
  screenImg: ImgData,
  refImgs: ImgData[],
  targetDesc: string,
  screenW: number,
  screenH: number,
): Promise<{ x: number; y: number } | null> {
  const instruction =
    "The images contain reference targets followed by the current game screenshot. " +
    (targetDesc ? "Target description: " + targetDesc + ". " : "") +
    "Find the same or most visually similar target in the current screenshot and return its center. " +
    "Use normalized coordinates from 0 to 1000, with 0,0 at top-left and 1000,1000 at bottom-right. " +
    "Return only JSON: {\"x\":<0-1000>,\"y\":<0-1000>}.";
  // Order: reference image first, current screenshot last
  const text = await chat(config, instruction, [...refImgs, screenImg]);
  if (!text) return null;
  return parseClickCoord(text, screenW, screenH);
}

/** State judgment: current screenshot (optional reference image) + question -> boolean. Returns null if inconclusive. */
export async function check(
  config: VlmConfig,
  screenImg: ImgData,
  ask: string,
  refImg?: ImgData,
): Promise<boolean | null> {
  const instruction =
    ask + "\nReturn only JSON: {\"answer\":true} or {\"answer\":false}.";
  const imgs = refImg ? [refImg, screenImg] : [screenImg];
  const text = await chat(config, instruction, imgs);
  if (!text) return null;
  return parseBoolAnswer(text);
}

/** Multi-image comparison: current screenshot + multiple reference images -> matched index (0-based). Returns null if inconclusive. */
export async function compare(
  config: VlmConfig,
  screenImg: ImgData,
  refImgs: ImgData[],
  ask: string,
): Promise<number | null> {
  const instruction =
    ask + "\nReference images are numbered 0, 1, 2, and so on. Select the reference that matches the current screenshot. " +
    "Return only JSON: {\"match\":<index>}.";
  const text = await chat(config, instruction, [...refImgs, screenImg]);
  if (!text) return null;
  return parseMatchIndex(text, refImgs.length);
}

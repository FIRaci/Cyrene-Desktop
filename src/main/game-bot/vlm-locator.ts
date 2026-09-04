// vlm-locator —— 视觉定位调用（OpenAI 兼容多图协议）。
// 复用 vision-captioner 的协议形态，但 prompt 改为要求返回坐标/判断 JSON，且支持多图。
// 不复用 vision-captioner 模块本身（它写死单图+通用描述），本模块是 game-bot 定位专用。

import { parseClickCoord, parseBoolAnswer, parseMatchIndex } from "./coords";
import { isModelEndpointUsable, modelAuthorizationHeaders } from "../../shared/model-endpoint";

export interface VlmConfig {
  baseUrl: string;  // 如 https://api.siliconflow.cn/v1
  apiKey: string;
  model: string;    // 如 Qwen/Qwen3-VL-8B-Instruct
}

export function isVlmConfigUsable(config: VlmConfig): boolean {
  return isModelEndpointUsable(config);
}

/** 图片数据（不含 data: 前缀的纯 base64 + mime）。 */
export interface ImgData {
  base64: string;
  mime: string;
}

const VLM_TIMEOUT_MS = 30_000;

/** 拼接 baseUrl + /chat/completions，兼容带或不带尾斜杠。 */
function chatUrl(baseUrl: string): string {
  const t = baseUrl.trim().replace(/\/+$/, "");
  if (t.endsWith("/chat/completions")) return t;
  return t + "/chat/completions";
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** 发一次多图 chat 请求，返回助手文本。失败返回空串。 */
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
 * 定位点击：参考小图（目标元素）+ 当前截图 → 返回目标在当前截图的屏幕坐标。
 * images 顺序：先参考图后当前截图。screenW/H 用于归一化转像素。
 * 未找到或失败返回 null。
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
  // 顺序：参考图在前，当前截图最后
  const text = await chat(config, instruction, [...refImgs, screenImg]);
  if (!text) return null;
  return parseClickCoord(text, screenW, screenH);
}

/** 状态判断：当前截图（可选参考图）+ 问题 → 布尔。无法判断返回 null。 */
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

/** 多图比对：当前截图 + 多张参考图 → 匹配的参考图序号（0-based）。无法判断返回 null。 */
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

import { MusicInputError, type PlaybackDispatchResult } from "./types";

export function normalizeMcpPlaybackResult(
  raw: unknown,
  resourceType: "song" | "playlist",
  resourceId: string,
): PlaybackDispatchResult {
  if (typeof raw !== "string") throw new MusicInputError("E_PLAYBACK_RESULT_UNKNOWN");
  const text = raw.trim();
  if (text === `\u5df2\u53d1\u9001\u64ad\u653e\u6307\u4ee4: ${resourceType} ${resourceId}`) {
    return { state: "dispatched", resourceType, resourceId };
  }
  const webUrl = `https://music.163.com/#/${resourceType}?id=${resourceId}`;
  if (text === `\u26a0\ufe0f \u672a\u68c0\u6d4b\u5230\u5ba2\u6237\u7aef\uff0c\u5df2\u5728\u6d4f\u89c8\u5668\u4e2d\u64ad\u653e: ${webUrl}`) {
    return { state: "web_fallback", resourceType, resourceId };
  }
  if (text.startsWith("\u64ad\u653e\u5931\u8d25:")) {
    throw new MusicInputError("E_PLAYBACK_DISPATCH_FAILED", text);
  }
  throw new MusicInputError("E_PLAYBACK_RESULT_UNKNOWN");
}

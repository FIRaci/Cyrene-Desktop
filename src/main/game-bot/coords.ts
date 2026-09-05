// coords — VLM text -> coordinates/boolean/matched index parser.
// Pure function, independent of electron. VLM returns JSON (may contain ```json fencing or embedded in text).
// Standardizes coordinates to 0-1000 normalization, independent of model-private formats.

/** Extract first JSON object from text and parse. Returns null on failure. */
function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/gi, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const v = JSON.parse(cleaned.slice(start, end + 1));
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

/** VLM text -> click coordinates (0-1000 normalized -> screen pixels, clamped to bounds). Returns null if no coordinates. */
export function parseClickCoord(
  text: string,
  screenW: number,
  screenH: number,
): { x: number; y: number } | null {
  const obj = extractJson(text);
  if (!obj) return null;
  const x = Number(obj.x);
  const y = Number(obj.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = Math.max(0, Math.min(screenW, Math.round((x / 1000) * screenW)));
  const py = Math.max(0, Math.min(screenH, Math.round((y / 1000) * screenH)));
  return { x: px, y: py };
}

/** VLM text -> boolean (used for vlm_check). Prefers JSON {answer:bool}; falls back to keywords. Returns null if inconclusive. */
export function parseBoolAnswer(text: string): boolean | null {
  const obj = extractJson(text);
  if (obj && typeof obj.answer === "boolean") return obj.answer;
  // false keywords take precedence
  if (/\u65e0|\u6ca1|\u5426|\u4e0d|\u672a|\u5173|false|no/i.test(text)) return false;
  if (/\u662f|\u6709|\u5f00|true|yes/i.test(text)) return true;
  return null;
}

/** VLM text -> match index (used for vlm_compare). {match:index}; returns null if index outside [0,refCount). */
export function parseMatchIndex(text: string, refCount: number): number | null {
  const obj = extractJson(text);
  if (!obj) return null;
  const idx = Number(obj.match);
  if (!Number.isFinite(idx)) return null;
  const i = Math.round(idx);
  if (i < 0 || i >= refCount) return null;
  return i;
}

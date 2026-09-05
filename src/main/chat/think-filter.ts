/**
 * <think> tag streaming filter.
 *
 * Used in AG-UI event bridge layer to prevent model reasoning chain tags from leaking into user-visible text.
 *
 * Two modes:
 * - "strict": filters all <think>...</think> blocks in entire text (for models known to leak think tags)
 * - "leading-only": enters filtering mode only when message starts with <think> (after whitespace);
 *   otherwise passes through as-is to avoid stripping discussion of <think> tags or code blocks.
 *
 * Lifecycle: isolated per assistant message (TEXT_MESSAGE_START ~ TEXT_MESSAGE_END),
 * does not span entire run. Each LLM call in multi-turn FC loops has an independent message boundary.
 */

export type ThinkFilterMode = "strict" | "leading-only" | "disabled";

export interface ThinkStreamFilter {
  /** Pushes a chunk and returns filtered visible text (may be empty string). */
  push(chunk: string): string;
  /** Flushes remaining visible text at message end (may be empty string). */
  flush(): string;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

/**
 * Creates a full <think> filter (used internally by strict mode).
 * Maintains state across chunks to handle split tags.
 */
function createStrictFilter(onThinkChunk?: (chunk: string) => void): ThinkStreamFilter {
  let pending = "";
  let insideThink = false;

  return {
    push(chunk: string): string {
      pending += chunk;
      let visible = "";

      while (pending) {
        const lower = pending.toLowerCase();

        if (insideThink) {
          const closeIndex = lower.indexOf(CLOSE_TAG);
          if (closeIndex < 0) {
            // Keep trailing part that may span across chunks
            const safeTail = Math.max(0, pending.length - (CLOSE_TAG.length - 1));
            const thinkPart = pending.slice(0, safeTail);
            if (thinkPart) onThinkChunk?.(thinkPart);
            pending = pending.slice(safeTail);
            break;
          }
          const thinkPart = pending.slice(0, closeIndex);
          if (thinkPart) onThinkChunk?.(thinkPart);
          pending = pending.slice(closeIndex + CLOSE_TAG.length);
          insideThink = false;
          continue;
        }

        const openIndex = lower.indexOf(OPEN_TAG);
        if (openIndex < 0) {
          // <think> not found, output most text but keep trailing part that may span chunks
          const safeLength = Math.max(0, pending.length - (OPEN_TAG.length - 1));
          visible += pending.slice(0, safeLength);
          pending = pending.slice(safeLength);
          break;
        }

        // Found <think>, output preceding content
        visible += pending.slice(0, openIndex);
        pending = pending.slice(openIndex + OPEN_TAG.length);
        insideThink = true;
      }

      return visible;
    },

    flush(): string {
      if (insideThink) {
        if (pending) onThinkChunk?.(pending);
        pending = "";
        return "";
      }
      const rest = pending;
      pending = "";
      return rest;
    },
  };
}

/**
 * Creates a leading-only filter.
 *
 * Behavior:
 * 1. Initially "buffering", accumulates characters until it can determine if message starts with <think>
 * 2. If start is <think> -> enters "filtering" state, subsequent chunks follow strict filtering
 * 3. If start is not <think> -> enters "passthrough" state, subsequent chunks pass through directly
 */
function createLeadingOnlyFilter(onThinkChunk?: (chunk: string) => void): ThinkStreamFilter {
  type State = "buffering" | "filtering" | "passthrough";
  let state: State = "buffering";
  let buffer = "";
  let inner: ThinkStreamFilter = createStrictFilter(onThinkChunk);

  return {
    push(chunk: string): string {
      if (state === "passthrough") return chunk;

      if (state === "filtering") return inner.push(chunk);

      // state === "buffering"
      buffer += chunk;
      const trimmed = buffer.trimStart();

      // Confirmed starts with <think>
      if (trimmed.toLowerCase().startsWith(OPEN_TAG)) {
        state = "filtering";
        const result = inner.push(buffer);
        buffer = "";
        return result;
      }

      // First non-whitespace char is not '<', confirmed not <think>
      if (trimmed.length > 0 && !trimmed.startsWith("<")) {
        state = "passthrough";
        const result = buffer;
        buffer = "";
        return result;
      }

      // Starts with '<' but fewer than 7 chars to determine
      if (trimmed.length >= OPEN_TAG.length && !trimmed.toLowerCase().startsWith(OPEN_TAG)) {
        state = "passthrough";
        const result = buffer;
        buffer = "";
        return result;
      }

      // Not enough characters, keep buffering
      return "";
    },

    flush(): string {
      if (state === "passthrough") return "";
      if (state === "buffering") {
        // Message ended without encountering <think>, flush all buffered content
        state = "passthrough";
        const result = buffer;
        buffer = "";
        return result;
      }
      // state === "filtering"
      return inner.flush();
    },
  };
}

/**
 * Creates a <think> stream filter.
 *
 * @param mode "strict" | "leading-only" | "disabled"
 * - "strict": filters all <think> blocks in full text
 * - "leading-only": only filters leading <think> blocks at start of message (default, safest)
 * - "disabled": no filtering, pass through as-is
 * @param onThinkChunk optional callback receiving content extracted from within <think> blocks
 */
export function createThinkFilter(
  mode: ThinkFilterMode = "leading-only",
  onThinkChunk?: (chunk: string) => void,
): ThinkStreamFilter {
  if (mode === "disabled") {
    return { push: (s: string) => s, flush: () => "" };
  }
  if (mode === "strict") {
    return createStrictFilter(onThinkChunk);
  }
  return createLeadingOnlyFilter(onThinkChunk);
}

/**
 * Strips <think> blocks from complete text in one pass (for non-streaming scenarios).
 * Content after an unclosed <think> is discarded.
 */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

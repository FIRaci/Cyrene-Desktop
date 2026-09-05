// Context manager - Prevents conversation unbounded growth in FC loop.
//
// Two defensive tiers:
//   1. Pre-enqueue truncation of tool results (truncateToolResult)
//   2. Window-level compression (compressConversation)
//
// Threshold design (based on 128K context window budget):
//   System prompt ≈ 6K tokens
//   Model output reservation ≈ 4K tokens
//   Safety margin ≈ 4K tokens
//   ────────────────────────────
//   Available space for FC loop tool results ≈ 114K tokens
//
//   Single-entry truncation 12000 chars (≈4K tokens)
//   Window compression 80000 chars (≈27K tokens)

const TOOL_RESULT_MAX_CHARS = 12000;
const WINDOW_COMPRESS_THRESHOLD_TOKENS = 27000;
const WINDOW_COMPRESS_THRESHOLD_CHARS = 80000;
const KEEP_RECENT_ROUNDS = 6; // Keep latest 6 rounds completely during compression (system + recent dialogue + tool results)

/**
 * Truncates single tool return content, appending original length notice if truncated.
 * Applied to execResults (entering conversation); allToolResults retains full original output.
 */
export function truncateToolResult(content: string, maxChars: number = TOOL_RESULT_MAX_CHARS): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) +
    `\n[truncated: original length ${content.length} characters; kept ${maxChars} characters]`;
}

/**
 * Rough token estimation without external dependencies.
 * Approximately chars / 3 for mixed text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Estimates total tokens in conversation array.
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
          return String((block as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "");
}

export function estimateConversationTokens(messages: Array<{ content: unknown }>): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(contentToText(m.content));
  }
  return total;
}

/**
//   2. Window-level compression (compressConversation)
 *
 * Strategy:
 *   - system message (role=system): always preserved
 *   - recent KEEP_RECENT_ROUNDS rounds: preserved completely
 *   - earlier rounds:
 *     - tool/assistant message content > 500 chars -> truncate to 200 chars + "[compressed]"
 *     - short messages preserved as-is
 *   - if still exceeding threshold after compression -> discard starting from earliest non-system message
 *
 * Returns compressed new array (does not modify input).
 */
export function compressConversation<T extends { role?: string; content?: unknown }>(
  messages: T[],
  thresholdChars: number = WINDOW_COMPRESS_THRESHOLD_CHARS,
  keepRecent: number = KEEP_RECENT_ROUNDS,
): T[] {
  const totalChars = messages.reduce((sum, m) => sum + contentToText(m.content).length, 0);
  if (totalChars <= thresholdChars) return messages;

  console.log(`[ContextManager] Compressing: ${totalChars} characters > ${thresholdChars} threshold`);

  const result: T[] = [...messages];
  const nonSystemIndices: number[] = [];

  for (let i = 0; i < result.length; i++) {
    if (result[i].role !== "system") {
      nonSystemIndices.push(i);
    }
  }

  // To compress: non-system messages beyond recent keepRecent items
  const compressFromIndex = nonSystemIndices.length > keepRecent
    ? nonSystemIndices[nonSystemIndices.length - keepRecent]
    : -1;

  if (compressFromIndex > 0) {
    for (let i = 0; i < compressFromIndex; i++) {
      if (result[i].role === "system") continue;
      const msg = result[i];
      const content = contentToText(msg.content);
      if (content.length > 500) {
        result[i] = {
          ...msg,
          content: content.slice(0, 200) + "\n[compressed: original length " + content.length + " characters]",
        } as T;
      }
    }
  }

  // If still exceeding threshold after compression -> discard starting from earliest non-system message
  let compressedChars = result.reduce((sum, m) => sum + contentToText(m.content).length, 0);
  while (compressedChars > thresholdChars) {
    const firstNonSystem = result.findIndex(m => m.role !== "system");
    if (firstNonSystem === -1 || firstNonSystem >= result.length - keepRecent) break;
    compressedChars -= contentToText(result[firstNonSystem].content).length;
    result.splice(firstNonSystem, 1);
    console.log("[ContextManager] Dropped the oldest message; " + compressedChars + " characters remain");
  }

  const finalChars = result.reduce((sum, m) => sum + contentToText(m.content).length, 0);
  console.log(`[ContextManager] Compression complete: ${totalChars} -> ${finalChars} characters`);

  return result;
}

export { WINDOW_COMPRESS_THRESHOLD_TOKENS, WINDOW_COMPRESS_THRESHOLD_CHARS };

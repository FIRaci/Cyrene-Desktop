// ToolContext - Context injected by dispatcher during tool execution.
// Allows tools to receive "current user query" without parsing message history.
// Foundation: currently serves read_image (vision); other tools declare needsContext as needed.

import type { ChatMessage } from "./vendors";
import { ContextRefRegistry } from "./context-ref-registry";

export const contextRefRegistry = new ContextRefRegistry();

/** Tool context. userQuery is currently sole stable field; metadata reserved for extensions (PDF/audio). */
export interface ToolContext {
  /** Current user query (latest user message text). Primary field. */
  userQuery: string;
  /** Current chat session ID; required by tools needing cross-turn isolated state. */
  conversationId?: string;
  /** One Agent execution; resolved-only candidates must not cross this boundary. */
  runId?: string;
  /** Tool Runtime-owned opaque reference registry. */
  contextRefs?: ContextRefRegistry;
  /** Future extension placeholder; empty object currently. */
  metadata?: Record<string, unknown>;
}

/**
 * Extracts latest role:"user" message text from conversation history as tool query context.
 *
 * Boundary rules:
 * - string content -> use directly
 * - array content (multimodal messages) -> concatenate text blocks
 * - neither or missing -> return empty string
 */
export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    // Multimodal array: concatenate text blocks.
    // ChatMessage.content is currently string; unknown bridge avoids TS narrowing to never;
    // assertion can be removed if content becomes string | ContentBlock[].
    const arr = content as unknown;
    if (Array.isArray(arr)) {
      return (arr as Array<{ type?: string; text?: string }>)
        .filter(b => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
        .map(b => b.text as string)
        .join(" ");
    }
    return "";
  }
  return "";
}

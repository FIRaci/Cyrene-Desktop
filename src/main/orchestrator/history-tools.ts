// History conversation recall tool - Allows Cyrene to "recall" conversations scrolled out of context window.
//
// Design (see docs/history-and-skill-architecture.md):
// - No chunking, no compression, no heuristics. Full history losslessly stored in vector store, recalled actively by model.
// - Store: each round user + assistant message saved via addMemory with source="chat_history"
// - Retrieve: recall_history tool semantic search, returned in chronological order
//
// Reuses existing RAG engine (addMemory / searchHistoryEntries), no separate storage layer.

import { addMemory, searchHistoryEntries } from "../rag";
import { toolRegistry } from "./tool-registry";
import { currentUserTimezone } from "./built-in-tools";

const LOG_PREFIX = "[History]";

/**
 * Store turn conversation into vector store. Called in agui-bridge complete callback.
 * Stores one entry each for user and assistant for role-based recall.
 * Failures do not throw (history storage is a side effect, cannot affect main flow).
 */
export async function indexConversationTurn(
  sessionId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  const ts = Date.now();
  try {
    if (userText) {
      await addMemory(userText, "chat_history", { sessionId, role: "user", ts });
    }
    if (assistantText) {
      await addMemory(assistantText, "chat_history", { sessionId, role: "assistant", ts });
    }
  } catch (e) {
    console.warn(LOG_PREFIX, "Failed to index conversation:", e);
  }
}

/** Register recall_history tool. Called once at startup. */
export function registerRecallHistoryTool(): void {
  toolRegistry.register({
    id: "recall_history",
    name: "Recall conversation history",
    description:
      "Semantically search all stored conversations and return up to five relevant excerpts in chronological order, each with a role and timestamp.\n\n" +
      "Use when the user refers to something from an earlier conversation, continues an older topic whose details are outside the current context, or asks about information absent from recent turns.\n\n" +
      "Do not use when the answer is already visible in recent turns, for unrelated small talk, or to invent something the user never mentioned. If no result is found, say so honestly.\n\n" +
      "Parameters: query (required search terms or natural-language question) and days (optional recent-day limit; default 30).",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms or a natural-language question" },
        days: { type: "number", description: "Optional recent-day limit; defaults to 30" },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      if (!query) return "[Error] query is required";

      const days = Number(args.days) || 30;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      let hits;
      try {
        hits = await searchHistoryEntries(query, 5);
      } catch (e) {
        return "[recall_history] Search failed: " + (e instanceof Error ? e.message : String(e));
      }

      const filtered = hits.filter(h => h.createdAt >= cutoff);

      if (filtered.length === 0) {
        return `[recall_history] No conversation history found for "${query}"`;
      }

      // Chronological order (earliest first) for natural conversation flow
      const sorted = [...filtered].sort((a, b) => a.createdAt - b.createdAt);

      const lines = sorted.map(h => {
        const date = new Date(h.createdAt).toLocaleString("en-US", { timeZone: currentUserTimezone() });
        const role = h.metadata?.role === "user" ? "User" : "Cyrene";
        // Truncate excessive content to avoid consuming excessive tokens
        const text = h.text.length > 300 ? h.text.slice(0, 300) + "..." : h.text;
        return `[${date}] ${role}: ${text}`;
      });

      return `[recall_history] Found ${sorted.length} relevant conversation entries:\n\n${lines.join("\n\n")}`;
    },
  });
}

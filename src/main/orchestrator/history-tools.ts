// 历史对话召回工具 —— 让昔涟能"回忆"滚出上下文窗口的对话。
//
// 设计（见 docs/history-and-skill-architecture.md）：
// - 不切分、不压缩、不启发式。全部历史无损存入向量库，模型主动召回。
// - 存：每轮 user + assistant 消息用 addMemory 存入 source="chat_history"
// - 取：recall_history 工具语义检索，按时间排序返回
//
// 复用现有 RAG 引擎（addMemory / searchHistoryEntries），不另建存储层。

import { addMemory, searchHistoryEntries } from "../rag";
import { toolRegistry } from "./tool-registry";
import { currentUserTimezone } from "./built-in-tools";

const LOG_PREFIX = "[History]";

/**
 * 把一轮对话存入向量库。在 agui-bridge 的 complete 回调里调用。
 * user 和 assistant 各存一条，方便按角色召回。
 * 失败不抛错（历史存储是副作用，不能影响主流程）。
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

/** 注册 recall_history 工具。在 startup 调一次。 */
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

      // 按时间正序（最早的在前），让对话脉络自然
      const sorted = [...filtered].sort((a, b) => a.createdAt - b.createdAt);

      const lines = sorted.map(h => {
        const date = new Date(h.createdAt).toLocaleString("en-US", { timeZone: currentUserTimezone() });
        const role = h.metadata?.role === "user" ? "User" : "Cyrene";
        // 截断过长内容，避免吃太多 token
        const text = h.text.length > 300 ? h.text.slice(0, 300) + "..." : h.text;
        return `[${date}] ${role}: ${text}`;
      });

      return `[recall_history] Found ${sorted.length} relevant conversation entries:\n\n${lines.join("\n\n")}`;
    },
  });
}

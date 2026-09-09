import { listSessions, getSession } from "../chats/chats-store";
import type { ChatMessage, ChatSessionMeta } from "../../shared/chat-types";

export interface PastSessionHighlight {
  sessionId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  recentDialogue: Array<{ role: string; content: string }>;
}

export interface ChatHistorySearchResult {
  sessionId: string;
  sessionTitle: string;
  role: string;
  content: string;
  at: number;
}

function compact(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

function timeAgo(ts: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Retrieves summaries of recent past chat sessions (excluding currentSessionId).
 */
export function getPastSessionHighlights(
  currentSessionId?: string,
  maxSessions = 4,
): PastSessionHighlight[] {
  try {
    const metas: ChatSessionMeta[] = listSessions();
    const otherMetas = metas
      .filter((m) => m.id !== currentSessionId && m.messageCount > 0)
      .slice(0, maxSessions);

    const highlights: PastSessionHighlight[] = [];

    for (const meta of otherMetas) {
      const session = getSession(meta.id);
      if (!session || !session.messages || session.messages.length === 0) {
        continue;
      }

      // Pick last 3 non-empty messages
      const recent = session.messages
        .filter((m) => m.content && m.content.trim().length > 0)
        .slice(-3)
        .map((m) => ({
          role: m.role,
          content: compact(m.content, 120),
        }));

      highlights.push({
        sessionId: meta.id,
        title: meta.title || "Untitled Chat",
        updatedAt: meta.updatedAt,
        messageCount: meta.messageCount,
        recentDialogue: recent,
      });
    }

    return highlights;
  } catch (err) {
    console.warn("[CrossSessionHistory] getPastSessionHighlights failed:", err);
    return [];
  }
}

/**
 * Builds a prompt block containing cross-session history highlights.
 */
export function buildCrossSessionSummary(
  currentSessionId?: string,
  maxSessions = 4,
): string {
  const highlights = getPastSessionHighlights(currentSessionId, maxSessions);
  if (highlights.length === 0) return "";

  const lines: string[] = [
    "[Cross-Session Shared Memories & Past Conversations]",
    "Cyrene remembers recent conversations with Master across other sessions:",
  ];

  for (const h of highlights) {
    const age = timeAgo(h.updatedAt);
    const dialogSummary = h.recentDialogue
      .map((d) => `${d.role === "user" ? "Master" : "Cyrene"}: "${d.content}"`)
      .join(" | ");

    lines.push(`- Session "${h.title}" (${age}, ${h.messageCount} msgs): ${dialogSummary}`);
  }

  lines.push(
    "Seamless Continuity: Master may reference past topics (\"như lúc nãy\", \"hôm nọ anh bảo\"). Naturally connect with these shared memories without acting confused or like a stranger.",
  );

  return lines.join("\n");
}

/**
 * Searches across all saved chat sessions for messages matching query.
 */
export function searchChatHistory(
  query: string,
  maxResults = 5,
): ChatHistorySearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: ChatHistorySearchResult[] = [];

  try {
    const metas = listSessions();
    for (const meta of metas) {
      if (results.length >= maxResults) break;
      const session = getSession(meta.id);
      if (!session || !session.messages) continue;

      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.content && msg.content.toLowerCase().includes(q)) {
          results.push({
            sessionId: meta.id,
            sessionTitle: meta.title || "Untitled Chat",
            role: msg.role,
            content: compact(msg.content, 250),
            at: msg.at || session.updatedAt,
          });
          if (results.length >= maxResults) break;
        }
      }
    }
  } catch (err) {
    console.warn("[CrossSessionHistory] searchChatHistory failed:", err);
  }

  return results;
}

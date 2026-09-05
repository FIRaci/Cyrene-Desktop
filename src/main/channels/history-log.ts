// channels/history-log - Conversation history per sender on the channel side (sliding window).
//
// Each sessionId maps to userData/channels/history/<sessionId>.jsonl
// Loaded into memory on demand, appended during conversation. Truncated at MAX_FILE_LINES.
//
// Data flow:
//   dispatcher.handleIncoming inbound/outbound -> appendHistory(senderSessionId, role, content)
//   dispatcher.handleIncoming next turn -> loadRecentHistory(senderSessionId, 16) retrieves recent 16 items
//
// Difference from message-log:
//   message-log is human-readable operational logs for UI display
//   history-log is conversational context for the LLM agent
//
// Difference from RAG indexing (indexConversationTurn):
//   RAG is semantic retrieval (cosine similarity), persistent long-term
//   history-log is an exact sliding window, short-term and explicit
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const LOG = "[ChannelHistory]";

/** History entry: speaker role + content + ISO timestamp */
export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  at: string;
}

const MAX_FILE_LINES = 200; // Keep up to 200 items, ample headroom over sliding window 16

function dir(): string {
  return path.join(app.getPath("userData"), "channels", "history");
}

/** Sanitize sessionId for filename safety. */
function safeName(sessionId: string): string {
  return sessionId.replace(/[:/\\<>:"|?*]/g, "_");
}

function filePath(sessionId: string): string {
  return path.join(dir(), `${safeName(sessionId)}.jsonl`);
}

/** Append an entry. Role must be user or assistant. */
export function appendHistory(sessionId: string, role: "user" | "assistant", content: string): void {
  if (!sessionId || !content) return;
  const entry: HistoryEntry = { role, content, at: new Date().toISOString() };
  const fp = filePath(sessionId);
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(fp, JSON.stringify(entry) + "\n", "utf8");
    const buf = fs.readFileSync(fp, "utf8");
    const lines = buf.split("\n");
    if (lines.length > MAX_FILE_LINES + 1) {
      const trimmed = lines.slice(lines.length - MAX_FILE_LINES).join("\n");
      fs.writeFileSync(fp, trimmed.endsWith("\n") ? trimmed : trimmed + "\n", "utf8");
    }
  } catch (err) {
    console.warn(LOG, "appendHistory failed:", sessionId, err instanceof Error ? err.message : err);
  }
}

/** Read recent N entries in chronological order (old -> new). */
export function loadRecentHistory(sessionId: string, limit: number): HistoryEntry[] {
  if (!sessionId || limit <= 0) return [];
  const fp = filePath(sessionId);
  if (!fs.existsSync(fp)) return [];
  try {
    const buf = fs.readFileSync(fp, "utf8");
    const lines = buf.split("\n").filter((l) => l.length > 0);
    const parsed: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (e && (e.role === "user" || e.role === "assistant") && typeof e.content === "string") {
          parsed.push(e);
        }
      } catch {
        /* skip bad line */
      }
    }
    const sliced = parsed.slice(-limit);
    return sliced;
  } catch (err) {
    console.warn(LOG, "loadRecentHistory failed:", sessionId, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Preload all session files (placeholder for debugging UI). */
export function reloadAllHistory(): Map<string, HistoryEntry[]> {
  const out = new Map<string, HistoryEntry[]>();
  try {
    fs.mkdirSync(dir(), { recursive: true });
    for (const name of fs.readdirSync(dir())) {
      if (!name.endsWith(".jsonl")) continue;
      const sid = name.replace(/\.jsonl$/, "").replace(/_/g, ":");
      out.set(sid, loadRecentHistory(sid, MAX_FILE_LINES));
    }
  } catch {
    /* ignore */
  }
  return out;
}

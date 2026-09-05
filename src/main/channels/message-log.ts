// channels/message-log - JSONL persistence + in-memory recent N entries for UI message logging.
//
// Data flow:
//   After dispatcher completes inbound/outbound -> appendLog(incoming) / appendLog(outgoing)
//   -> written to userData/channels/log.jsonl (one JSON line per entry)
//   -> maintains in-memory lastN array (default 200 entries)
//
// Read:
//   getRecentLog(limit) -> recent N entries in reverse chronological order
//   clearLog() -> cleans disk + memory
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const LOG = "[ChannelLog]";

export interface LogEntry {
  /** ISO timestamp */
  at: string;
  /** "incoming" | "outgoing" */
  dir: "incoming" | "outgoing";
  channel: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  text: string;
  /** Whether there are attachments (boolean only, not serialized in detail) */
  hasAttachments?: boolean;
}

const MAX_FILE_LINES = 1000;
const MAX_INMEM = 200;

const inMemory: LogEntry[] = [];

function filePath(): string {
  return path.join(app.getPath("userData"), "channels", "log.jsonl");
}

function ensureDir(): void {
  const dir = path.dirname(filePath());
  fs.mkdirSync(dir, { recursive: true });
}

let appendsSincePrune = 0;

/** Append a log entry. Failures do not interrupt the main process. */
export function appendLog(entry: Omit<LogEntry, "at">): void {
  const full: LogEntry = { at: new Date().toISOString(), ...entry };
  inMemory.push(full);
  if (inMemory.length > MAX_INMEM) {
    inMemory.splice(0, inMemory.length - MAX_INMEM);
  }
  try {
    ensureDir();
    fs.appendFileSync(filePath(), JSON.stringify(full) + "\n", "utf8");
    appendsSincePrune++;
    // Truncate file every 100 appends to prevent disk reading overhead
    if (appendsSincePrune >= 100) {
      appendsSincePrune = 0;
      if (fs.existsSync(filePath())) {
        const buf = fs.readFileSync(filePath(), "utf8");
        const lines = buf.split("\n");
        if (lines.length > MAX_FILE_LINES) {
          const trimmed = lines.slice(lines.length - MAX_FILE_LINES).join("\n");
          fs.writeFileSync(filePath(), trimmed + "\n", "utf8");
        }
      }
    }
  } catch (err) {
    console.warn(LOG, "Failed to write log:", err instanceof Error ? err.message : err);
  }
}

/** Read recent N entries (newest first). */
export function getRecentLog(limit = 100): LogEntry[] {
  const n = Math.max(1, Math.min(MAX_INMEM, limit));
  if (inMemory.length > 0) {
    return [...inMemory].slice(-n).reverse();
  }
  // If memory empty (fresh startup), read from disk
  try {
    const buf = fs.readFileSync(filePath(), "utf8");
    const lines = buf.split("\n").filter((l) => l.length > 0);
    const parsed: LogEntry[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as LogEntry);
      } catch {
        /* skip */
      }
    }
    return parsed.slice(-n).reverse();
  } catch {
    return [];
  }
}

/** Clear log (disk + memory). */
export function clearLog(): { ok: boolean; error?: string } {
  inMemory.length = 0;
  appendsSincePrune = 0;
  try {
    if (fs.existsSync(filePath())) {
      fs.unlinkSync(filePath());
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(LOG, "Failed to clear log file:", message);
    return { ok: false, error: message };
  }
}

/** Reload from disk to memory at startup. */
export function reloadLogFromDisk(): void {
  try {
    const buf = fs.readFileSync(filePath(), "utf8");
    const lines = buf.split("\n").filter((l) => l.length > 0);
    const parsed: LogEntry[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as LogEntry);
      } catch {
        /* skip corrupted */
      }
    }
    inMemory.length = 0;
    const tail = parsed.slice(-MAX_INMEM);
    inMemory.push(...tail);
  } catch {
    /* normal on first launch when no log file exists */
  }
}

// channels/message-log —— JSONL 落盘 + 内存最近 N 条，给 UI 提供消息日志查看。
//
// 数据流：
//   dispatcher 处理完入站/出站后 → appendLog(incoming) / appendLog(outgoing)
//   → 写入 userData/channels/log.jsonl (一行一 JSON)
//   → 同时维护内存 lastN 数组（默认 200 条）
//
// 读：
//   getRecentLog(limit) → 最近 N 条倒序
//   clearLog() → 清磁盘 + 内存
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const LOG = "[ChannelLog]";

export interface LogEntry {
  /** ISO 时间戳 */
  at: string;
  /** "incoming" | "outgoing" */
  dir: "incoming" | "outgoing";
  channel: string;
  senderId: string;
  senderName?: string;
  chatId: string;
  text: string;
  /** 是否有附件（不进 JSONL，只记布尔） */
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

/** 追加一条日志。失败不影响主流程。 */
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
    // 只有每 100 次写入才做一次文件截断，避免每次消息都全量重读磁盘
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

/** 读最近 N 条（最新在前）。 */
export function getRecentLog(limit = 100): LogEntry[] {
  const n = Math.max(1, Math.min(MAX_INMEM, limit));
  if (inMemory.length > 0) {
    return [...inMemory].slice(-n).reverse();
  }
  // 内存空（刚启动）→ 从磁盘读
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

/** 清空日志（磁盘 + 内存）。 */
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

/** 启动时从磁盘 reload 到内存（避免重启后内存里没有历史）。 */
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
    // 取最后的 MAX_INMEM 条
    const tail = parsed.slice(-MAX_INMEM);
    inMemory.push(...tail);
  } catch {
    /* 首次启动无文件，正常 */
  }
}

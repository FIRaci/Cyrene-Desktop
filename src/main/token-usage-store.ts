// Token usage persistent store
//
// Location: <userData>/token-usage.json
// Data structure: Aggregated by ISO date, facilitating arbitrary range queries.
//
// Write policy: record() updates memory cache immediately with 1s debounced flush.
// Read policy: Loaded on first access from disk, read directly from memory thereafter.

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export interface TokenUsageDay {
  input: number;
  output: number;
  hit: number;   // Cache hit count (placeholder 0)
  miss: number;  // Cache miss count (placeholder 0)
  requests: number;
}

interface TokenUsageStore {
  schemaVersion: 1;
  days: Record<string, TokenUsageDay>; // key = "2026-06-19"
}

const DEFAULT_STORE: TokenUsageStore = { schemaVersion: 1, days: {} };
const DEBOUNCE_MS = 1000;

function getFilePath(): string {
  return path.join(app.getPath("userData"), "token-usage.json");
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let cache: TokenUsageStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadFromDisk(): TokenUsageStore {
  const filePath = getFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TokenUsageStore>;
      return {
        schemaVersion: 1,
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
      };
    }
  } catch (err) {
    console.warn("[token-usage] Load failed, resetting to empty:", err);
  }
  return { ...DEFAULT_STORE, days: {} };
}

function ensureLoaded(): TokenUsageStore {
  if (!cache) cache = loadFromDisk();
  return cache;
}

function scheduleFlush(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushNow();
  }, DEBOUNCE_MS);
}

function flushNow(): void {
  if (!cache) return;
  const filePath = getFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Atomic write: write to .tmp then rename
  const tmpPath = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn("[token-usage] Flush failed:", err);
  }
}

// ── public API ──

/** Records token usage for an API call (accumulates asynchronously to current day). */
export function recordUsage(input: number, output: number, requests = 1): void {
  const store = ensureLoaded();
  const key = todayKey();
  const day = store.days[key] ?? { input: 0, output: 0, hit: 0, miss: 0, requests: 0 };
  day.input += Math.max(0, Math.round(input || 0));
  day.output += Math.max(0, Math.round(output || 0));
  day.requests += Math.max(0, requests);
  store.days[key] = day;
  scheduleFlush();
}

/** Queries usage data for past N days, sorted ascending by date (empty days filled with 0). */
export function getUsage(days: number): Array<{ date: string; weekday: string; input: number; output: number; hit: number; miss: number; requests: number }> {
  const store = ensureLoaded();
  const result: Array<{ date: string; weekday: string; input: number; output: number; hit: number; miss: number; requests: number }> = [];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = store.days[key];
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    result.push({
      date: `${mm}-${dd}`,
      weekday: weekdays[d.getDay()],
      input: day?.input ?? 0,
      output: day?.output ?? 0,
      hit: day?.hit ?? 0,
      miss: day?.miss ?? 0,
      requests: day?.requests ?? 0,
    });
  }
  return result;
}

/** Flushes immediately (called upon application quit). */
export function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushNow();
}

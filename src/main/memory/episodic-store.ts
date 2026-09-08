import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

export type EpisodicCategory = "work" | "life" | "health" | "hobby";
export type EpisodicEmotion = "happy" | "tired" | "anxious" | "excited" | "neutral";
export type EpisodicStatus = "pending" | "resolved";

export interface EpisodicEvent {
  id: string;
  date: string; // YYYY-MM-DD
  summary: string;
  emotion: EpisodicEmotion;
  category: EpisodicCategory;
  status: EpisodicStatus;
  createdAt: number;
  resolvedAt?: number;
  resolutionNote?: string;
}

export interface NewEpisodicEventInput {
  date?: string; // default today YYYY-MM-DD
  summary: string;
  emotion?: EpisodicEmotion;
  category?: EpisodicCategory;
}

export interface EpisodicStoreDeps {
  filePath?: string;
  now?: () => number;
}

interface EpisodicData {
  events: EpisodicEvent[];
}

const MAX_EPISODIC_EVENTS = 200;

function defaultFilePath(): string {
  try {
    return path.join(app.getPath("userData"), "episodic-memory.json");
  } catch {
    return path.join(process.cwd(), ".cache", "episodic-memory.json");
  }
}

function todayLocalDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class EpisodicStore {
  private filePath: string;
  private nowFn: () => number;
  private data: EpisodicData = { events: [] };
  private loaded = false;

  constructor(deps?: EpisodicStoreDeps) {
    this.filePath = deps?.filePath || defaultFilePath();
    this.nowFn = deps?.now || (() => Date.now());
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.events)) {
          this.data = parsed;
        }
      }
    } catch (err) {
      console.warn("[EpisodicStore] Failed to load data, using empty:", err);
      this.data = { events: [] };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.warn("[EpisodicStore] Failed to save data:", err);
    }
  }

  public addEvent(input: NewEpisodicEventInput): EpisodicEvent {
    this.ensureLoaded();
    const now = this.nowFn();
    const event: EpisodicEvent = {
      id: `epi-${now}-${Math.random().toString(36).slice(2, 7)}`,
      date: input.date || todayLocalDate(now),
      summary: input.summary.trim(),
      emotion: input.emotion || "neutral",
      category: input.category || "life",
      status: "pending",
      createdAt: now,
    };

    this.data.events.unshift(event);
    if (this.data.events.length > MAX_EPISODIC_EVENTS) {
      this.data.events = this.data.events.slice(0, MAX_EPISODIC_EVENTS);
    }
    this.save();
    return event;
  }

  public listEvents(): EpisodicEvent[] {
    this.ensureLoaded();
    return [...this.data.events];
  }

  public listPendingEvents(): EpisodicEvent[] {
    this.ensureLoaded();
    return this.data.events.filter((e) => e.status === "pending");
  }

  public resolveEvent(id: string, note?: string): boolean {
    this.ensureLoaded();
    const ev = this.data.events.find((e) => e.id === id);
    if (!ev) return false;
    ev.status = "resolved";
    ev.resolvedAt = this.nowFn();
    if (note) ev.resolutionNote = note.trim();
    this.save();
    return true;
  }

  public deleteEvent(id: string): boolean {
    this.ensureLoaded();
    const initialLen = this.data.events.length;
    this.data.events = this.data.events.filter((e) => e.id !== id);
    if (this.data.events.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public clearAll(): void {
    this.data = { events: [] };
    this.save();
  }

  /**
   * Generates prompt section for recent pending episodic events within the last 4 days.
   */
  public buildPendingEventsPrompt(): string {
    const pending = this.listPendingEvents();
    if (pending.length === 0) return "";

    const now = this.nowFn();
    const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
    const recent = pending.filter((e) => now - e.createdAt <= fourDaysMs).slice(0, 3);
    if (recent.length === 0) return "";

    const lines = recent.map((e) => `- [${e.date}] (${e.category}/${e.emotion}): "${e.summary}" (ID: ${e.id})`);
    return `[EPISODIC MEMORY CUES]
Master shared these recent upcoming or pending events with you. If appropriate and natural, you may warmly ask how it went or follow up on how they are feeling:
${lines.join("\n")}`;
  }
}

/**
 * Heuristic detector for episodic life/work moments mentioned by the user in conversation.
 */
export function detectEpisodicEventFromText(text: string): NewEpisodicEventInput | null {
  if (!text || text.length < 10) return null;
  const lower = text.toLowerCase();

  // Explicit planning / upcoming milestones
  const workMatch = /(?:tomorrow|next week|today)\s+(?:i have|i've got|there's|i have to do|i need to)\s+([^.!?,\n]{8,80})/i.exec(text);
  if (workMatch) {
    const summary = workMatch[0].trim();
    const emotion: EpisodicEmotion = /(?:stress|nervous|worry|hard|tough|scared|anxious)/i.test(text) ? "anxious" : "neutral";
    const category: EpisodicCategory = /(?:presentation|meeting|interview|project|deploy|client|boss|exam|test)/i.test(text) ? "work" : "life";
    return { summary, emotion, category };
  }

  // Doctor / health appointments
  if (/(?:hospital|doctor|dentist|clinic|health check|surgery|medicine)\b/i.test(lower)) {
    const healthMatch = /(?:have to go to|going to|seeing a|appointment with|visiting)\s+(?:the\s+)?([a-z\s]{4,40})/i.exec(text);
    if (healthMatch) {
      return {
        summary: `Medical visit: ${healthMatch[0].trim()}`,
        emotion: "anxious",
        category: "health",
      };
    }
  }

  // Celebrations / milestones
  if (/(?:my birthday|celebrating|anniversary|passed the exam|got the job|got an offer)\b/i.test(lower)) {
    return {
      summary: text.slice(0, 80).trim(),
      emotion: "happy",
      category: "life",
    };
  }

  return null;
}

let episodicStoreInstance: EpisodicStore | null = null;

export function getEpisodicStore(deps?: EpisodicStoreDeps): EpisodicStore {
  if (deps) return new EpisodicStore(deps);
  if (!episodicStoreInstance) {
    episodicStoreInstance = new EpisodicStore();
  }
  return episodicStoreInstance;
}

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { getBondEngine } from "./bond-engine";
import {
  getEpisodicStore,
  detectEpisodicEventFromText,
} from "../memory/episodic-store";
import { buildCrossSessionSummary } from "../memory/cross-session-history";
import {
  RelationshipChannel,
  RelationshipTurnInput,
  RelationshipLogEntry,
  RelationshipDailySummary,
  RelationshipLogData,
} from "./relationship-log-types";
import {
  compactText,
  detectUserMood,
  deriveSignal,
  summarizeDate,
} from "./relationship-signal-detector";

export {
  RelationshipChannel,
  RelationshipTurnInput,
  RelationshipLogEntry,
  RelationshipDailySummary,
};

const EMPTY_DATA: RelationshipLogData = {
  entries: [],
  dailySummaries: [],
};

const MAX_ENTRIES = 500;
const MAX_DAILY_SUMMARIES = 90;

function defaultFilePath(): string {
  return path.join(app.getPath("userData"), "relationship-log.json");
}

function localDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function readData(filePath: string): RelationshipLogData {
  try {
    if (!fs.existsSync(filePath))
      return { ...EMPTY_DATA, entries: [], dailySummaries: [] };
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    ) as Partial<RelationshipLogData>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      dailySummaries: Array.isArray(parsed.dailySummaries)
        ? parsed.dailySummaries
        : [],
    };
  } catch {
    return { ...EMPTY_DATA, entries: [], dailySummaries: [] };
  }
}

function writeData(filePath: string, data: RelationshipLogData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export class RelationshipLogStore {
  constructor(private readonly filePath = defaultFilePath()) {}

  async recordTurn(
    input: RelationshipTurnInput
  ): Promise<RelationshipLogEntry | null> {
    const userText = input.userText.trim();
    const assistantText = input.assistantText.trim();
    if (!userText && !assistantText) return null;

    const now = Date.now();
    const userMood = detectUserMood(userText);
    const cue = deriveSignal(userText, userMood);
    const entry: RelationshipLogEntry = {
      ...input,
      userText: compactText(userText, 500),
      assistantText: compactText(assistantText, 500),
      id: `rel-${now}-${Math.random().toString(36).slice(2, 8)}`,
      date: localDate(now),
      createdAt: now,
      userMood,
      relationshipSignal: cue.relationshipSignal,
      importantMoment: cue.importantMoment,
      nextCareCue: cue.nextCareCue,
    };

    const data = readData(this.filePath);
    data.entries.push(entry);
    data.entries = data.entries.slice(-MAX_ENTRIES);

    const entriesForDate = data.entries.filter((item) => item.date === entry.date);
    const summary = summarizeDate(entry.date, entriesForDate);
    data.dailySummaries = [
      ...data.dailySummaries.filter((item) => item.date !== entry.date),
      summary,
    ].slice(-MAX_DAILY_SUMMARIES);

    writeData(this.filePath, data);
    return entry;
  }

  async buildContext(currentSessionId?: string): Promise<string> {
    const sections: string[] = [];

    try {
      const bondPrompt = getBondEngine().buildBondPersonaPrompt();
      if (bondPrompt) sections.push(bondPrompt);
    } catch {}

    try {
      const episodicPrompt = getEpisodicStore().buildPendingEventsPrompt();
      if (episodicPrompt) sections.push(episodicPrompt);
    } catch {}

    try {
      const crossSessionPrompt = buildCrossSessionSummary(currentSessionId);
      if (crossSessionPrompt) sections.push(crossSessionPrompt);
    } catch {}

    const data = readData(this.filePath);
    const recent = data.entries.slice(-8);
    if (recent.length > 0) {
      const lastMood =
        [...recent].reverse().find((e) => e.userMood !== "unknown")?.userMood ??
        "stable";
      const latestSummary = data.dailySummaries.at(-1)?.summary;
      const preference = [...recent]
        .reverse()
        .find((e) => e.importantMoment)?.importantMoment;
      const cues = [
        ...new Set(recent.map((e) => e.nextCareCue).filter(Boolean)),
      ].slice(-3);

      const lines = [
        "[Recent Relationship Cues]",
        `- User recent state: ${lastMood}`,
      ];
      if (latestSummary) lines.push(`- Recent diary summary: ${latestSummary}`);
      if (preference)
        lines.push(`- Important interaction preference: ${preference}`);
      if (cues.length > 0) lines.push(`- Next response cue: ${cues.join("; ")}`);
      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }
}

let defaultStore: RelationshipLogStore | null = null;

function getDefaultStore(): RelationshipLogStore {
  if (!defaultStore) defaultStore = new RelationshipLogStore();
  return defaultStore;
}

export function recordRelationshipTurn(
  input: RelationshipTurnInput
): Promise<RelationshipLogEntry | null> {
  try {
    const detected = detectEpisodicEventFromText(input.userText);
    if (detected) {
      getEpisodicStore().addEvent(detected);
    }
  } catch {}

  try {
    getBondEngine().recordInteraction("chat_message");
  } catch {}

  return getDefaultStore().recordTurn(input);
}

export function buildRelationshipContext(currentSessionId?: string): Promise<string> {
  return getDefaultStore().buildContext(currentSessionId);
}

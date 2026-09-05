import * as fs from "fs"
import * as path from "path"
import { app } from "electron"

export type RelationshipChannel = "desktop" | "wechat" | "feishu"

export interface RelationshipTurnInput {
  userText: string
  assistantText: string
  cyreneFeeling: string
  channel: RelationshipChannel
}

export interface RelationshipLogEntry extends RelationshipTurnInput {
  id: string
  date: string
  createdAt: number
  userMood: string
  relationshipSignal: string
  importantMoment?: string
  nextCareCue: string
}

export interface RelationshipDailySummary {
  date: string
  updatedAt: number
  summary: string
  nextCareCue: string
}

interface RelationshipLogData {
  entries: RelationshipLogEntry[]
  dailySummaries: RelationshipDailySummary[]
}

const EMPTY_DATA: RelationshipLogData = {
  entries: [],
  dailySummaries: [],
}

const MAX_ENTRIES = 500
const MAX_DAILY_SUMMARIES = 90

function defaultFilePath(): string {
  return path.join(app.getPath("userData"), "relationship-log.json")
}

function localDate(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function compact(text: string, max = 120): string {
  const s = text.replace(/\s+/g, " ").trim()
  return s.length > max ? s.slice(0, max) + "..." : s
}

function detectUserMood(text: string): string {
  if (/\b(?:tired|exhausted|sleepy|drained|fatigued|can't hold on|burned out)\b/i.test(text)) return "tired"
  if (/\b(?:don't|do not|stop|no need|dislike|hate|annoying|intrusive|too much|too many|no cards?|no confirm|boundary)\b/i.test(text)) return "clear boundary"
  if (/\b(?:anxious|anxiety|stress|stressed|overwhelmed|nervous|worried|worry|panicking|panic)\b/i.test(text)) return "anxious"
  if (/\b(?:sad|down|upset|depressed|heartbroken|crying|cry|hurt|unhappy)\b/i.test(text)) return "down"
  if (/\b(?:happy|glad|great|yay|awesome|comfortable|enjoy|love it|wonderful)\b/i.test(text)) return "happy"
  return "unknown"
}

function deriveSignal(userText: string, userMood: string): {
  relationshipSignal: string
  importantMoment?: string
  nextCareCue: string
} {
  if (userMood === "clear boundary") {
    return {
      relationshipSignal: "The user expressed a preference for low disturbance or experience boundaries; prioritize respecting this, and avoid turning care into interruptions.",
      importantMoment: "The user clearly stated that they dislike intrusive confirmation cards or excessive questioning.",
      nextCareCue: "Do not pop confirmation dialogs or repeatedly ask questions; execute quietly according to user preferences first, and confirm with a single sentence if necessary.",
    }
  }

  if (userMood === "tired") {
    return {
      relationshipSignal: "The user is showing signs of fatigue and needs low-pressure companionship and concise responses.",
      nextCareCue: "Next response cue: Keep tasks and questions minimal, slow down the tone, and acknowledge their state first.",
    }
  }

  if (userMood === "anxious") {
    return {
      relationshipSignal: "The user may be under stress or feeling anxious, requiring a sense of stability and clear, bite-sized suggestions.",
      nextCareCue: "Next response cue: Reassure first, then provide one or two actionable small steps without overwhelming them.",
    }
  }

  if (userMood === "down") {
    return {
      relationshipSignal: "The user's mood is low; they need understanding and gentle presence rather than immediate correction.",
      nextCareCue: "Next response cue: Acknowledge feelings first, then gently accompany; do not rush into moralizing or reasoning.",
    }
  }

  if (userMood === "happy") {
    return {
      relationshipSignal: "The user's feedback is positive; maintain a lighthearted interaction and note what sparked their joy.",
      nextCareCue: "Next response cue: Feel free to be more relaxed and maintain the user's positive state.",
    }
  }

  return {
    relationshipSignal: "This round of interaction had no obvious emotional peaks; maintaining natural companionship is sufficient.",
    nextCareCue: `Next response cue: Continue the recent topic "${compact(userText, 40)}", without over-interpreting.`,
  }
}

function readData(filePath: string): RelationshipLogData {
  try {
    if (!fs.existsSync(filePath)) return { ...EMPTY_DATA, entries: [], dailySummaries: [] }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<RelationshipLogData>
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      dailySummaries: Array.isArray(parsed.dailySummaries) ? parsed.dailySummaries : [],
    }
  } catch {
    return { ...EMPTY_DATA, entries: [], dailySummaries: [] }
  }
}

function writeData(filePath: string, data: RelationshipLogData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
}

function summarizeDate(date: string, entries: RelationshipLogEntry[]): RelationshipDailySummary {
  const moods = entries.map((e) => e.userMood).filter((m) => m !== "unknown")
  const dominantMood = moods.at(-1) ?? "stable"
  const important = [...entries].reverse().find((e) => e.importantMoment)?.importantMoment
  const cue = entries.at(-1)?.nextCareCue ?? "Maintain natural companionship."
  const signal = entries.at(-1)?.relationshipSignal ?? "Interaction today was stable."
  const parts = [
    `${date}: The user's recent state leaned toward "${dominantMood}".`,
    important ? `Important preference: ${important}` : signal,
    cue,
  ]
  return {
    date,
    updatedAt: Date.now(),
    summary: parts.join(" "),
    nextCareCue: cue,
  }
}

export class RelationshipLogStore {
  constructor(private readonly filePath = defaultFilePath()) {}

  async recordTurn(input: RelationshipTurnInput): Promise<RelationshipLogEntry | null> {
    const userText = input.userText.trim()
    const assistantText = input.assistantText.trim()
    if (!userText && !assistantText) return null

    const now = Date.now()
    const userMood = detectUserMood(userText)
    const cue = deriveSignal(userText, userMood)
    const entry: RelationshipLogEntry = {
      ...input,
      userText: compact(userText, 500),
      assistantText: compact(assistantText, 500),
      id: `rel-${now}-${Math.random().toString(36).slice(2, 8)}`,
      date: localDate(now),
      createdAt: now,
      userMood,
      relationshipSignal: cue.relationshipSignal,
      importantMoment: cue.importantMoment,
      nextCareCue: cue.nextCareCue,
    }

    const data = readData(this.filePath)
    data.entries.push(entry)
    data.entries = data.entries.slice(-MAX_ENTRIES)

    const entriesForDate = data.entries.filter((item) => item.date === entry.date)
    const summary = summarizeDate(entry.date, entriesForDate)
    data.dailySummaries = [
      ...data.dailySummaries.filter((item) => item.date !== entry.date),
      summary,
    ].slice(-MAX_DAILY_SUMMARIES)

    writeData(this.filePath, data)
    return entry
  }

  async buildContext(): Promise<string> {
    const data = readData(this.filePath)
    const recent = data.entries.slice(-8)
    if (recent.length === 0) return ""

    const lastMood = [...recent].reverse().find((e) => e.userMood !== "unknown")?.userMood ?? "stable"
    const latestSummary = data.dailySummaries.at(-1)?.summary
    const preference = [...recent].reverse().find((e) => e.importantMoment)?.importantMoment
    const cues = [...new Set(recent.map((e) => e.nextCareCue).filter(Boolean))].slice(-3)

    const lines = [
      "[Recent Relationship Cues]",
      `- User recent state: ${lastMood}`,
    ]
    if (latestSummary) lines.push(`- Recent diary summary: ${latestSummary}`)
    if (preference) lines.push(`- Important interaction preference: ${preference}`)
    if (cues.length > 0) lines.push(`- Next response cue: ${cues.join("; ")}`)
    return lines.join("\n")
  }
}

let defaultStore: RelationshipLogStore | null = null

function getDefaultStore(): RelationshipLogStore {
  if (!defaultStore) defaultStore = new RelationshipLogStore()
  return defaultStore
}

export function recordRelationshipTurn(input: RelationshipTurnInput): Promise<RelationshipLogEntry | null> {
  return getDefaultStore().recordTurn(input)
}

export function buildRelationshipContext(): Promise<string> {
  return getDefaultStore().buildContext()
}

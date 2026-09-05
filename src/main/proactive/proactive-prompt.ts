import type { ChatMessage } from "../orchestrator/vendors/types";

export interface ProactiveHistoryTurn {
  role: "user" | "model";
  content: string;
  at: number;
}

export interface BuildProactiveMessagesInput {
  basePersona: string;
  userProfile?: string;
  relevantMemory?: string;
  ordinaryHistory: ProactiveHistoryTurn[];
  proactiveHistory: ProactiveHistoryTurn[];
  sceneId: string;
  localNow: Date;
  idleSec: number;
  unansweredCount: 0 | 1 | 2;
  /**
   * Resolved effective user timezone (valid IANA string).
   * All local time interpretations (morning/evening checks, history lines, computer local time) are based on this timezone.
   * Requires validated timezone via resolveChatContextTimezone.
   */
  timezone: string;
}

export type ProactiveModelDecision =
  | { kind: "send"; text: string }
  | { kind: "silent" }
  | { kind: "invalid"; reason: string };

const MAX_HISTORY_MESSAGES = 16;
const MAX_PROACTIVE_TEXT_LENGTH = 500;

const PROACTIVE_SYSTEM = `[proactive_system]
Decide whether to start a conversation proactively; you are not answering a new user message.
Do not treat the last historical message as newly received. History only helps you understand recent state and topics.
Return silent when there is nothing natural and worthwhile to say. Never force small talk merely to complete the task.
Do not mention system detection, trigger rules, scoring, context, user profiles, or internal state.
Keep the message brief and natural. You may show care, share something, follow up, or ask one gentle question.
Never claim that you used a tool, read the screen, or performed an external action.`;

const NIGHT_SYSTEM = `[night_system]
It is late at night and the user is still using the computer.
You may gently care about their rest and suggest not staying up too late, without lecturing, rushing, or pressuring them.
Do not mention sleep every time. If context offers a more natural or important topic, address it first and only then gently mention rest.
Never reveal detection of keyboard, mouse, screen, or system activity.
Remain silent if there is nothing worthwhile to say.`;

const FOLLOWUP_SYSTEM = `[followup_system]
This is the final permitted proactive attempt while the user has not replied.
The local system found a new scene reason, distinct from the previous one, but you must still decide whether it justifies interrupting the user.
Do not blame, pressure, seek sympathy, act neglected, or mechanically ask whether they are there.
Return silent unless there is a strong reason to speak.`;

/**
 * Splits date into {year, month, day, hour, minute} via Intl using timezone.
 * Independent of locale formatting punctuation and order.
 * Falls back to system-local if resolution fails.
 */
function getZonedDateParts(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** Morning/evening check: based on user timezone hour. Retains 22:00-08:00 + idle<60 semantics. */
function isActiveNight(date: Date, timezone: string, idleSec: number): boolean {
  const { hour } = getZonedDateParts(date, timezone);
  return (hour >= 22 || hour < 8) && idleSec < 60;
}

/** Formats local time in user timezone: `YYYY-MM-DD HH:MM`. */
function formatLocalTime(date: Date, timezone: string): string {
  const p = getZonedDateParts(date, timezone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const min = String(p.minute).padStart(2, "0");
  return `${p.year}-${mm}-${dd} ${hh}:${min}`;
}

function formatHistory(label: string, history: ProactiveHistoryTurn[], timezone: string): string {
  const recent = history
    .filter((turn) => turn && (turn.role === "user" || turn.role === "model") && turn.content.trim())
    .slice(-MAX_HISTORY_MESSAGES);
  const lines = recent.map((turn) => {
    const role = turn.role === "model" ? "assistant" : "user";
    return `[${formatLocalTime(new Date(turn.at), timezone)}] ${role}: ${turn.content.trim()}`;
  });
  return `[${label}]\n${lines.length > 0 ? lines.join("\n") : "(none)"}`;
}

export function buildProactiveMessages(input: BuildProactiveMessagesInput): ChatMessage[] {
  const systemParts = [input.basePersona.trim(), PROACTIVE_SYSTEM];
  if (input.userProfile?.trim()) systemParts.push(`[USER PROFILE]\n${input.userProfile.trim()}`);
  if (input.relevantMemory?.trim()) systemParts.push(`[RELEVANT LONG-TERM MEMORY]\n${input.relevantMemory.trim()}`);
  systemParts.push(formatHistory("RECENT ORDINARY CHAT", input.ordinaryHistory, input.timezone));
  systemParts.push(formatHistory("PROACTIVE CHAT HISTORY", input.proactiveHistory, input.timezone));
  if (isActiveNight(input.localNow, input.timezone, input.idleSec)) systemParts.push(NIGHT_SYSTEM);
  if (input.unansweredCount === 1) systemParts.push(FOLLOWUP_SYSTEM);

  const trigger = `[PROACTIVE CHAT CANDIDATE]
Local computer time: ${formatLocalTime(input.localNow, input.timezone)}
Candidate scene: ${input.sceneId}
Consecutive unanswered attempts: ${input.unansweredCount}

[CRITICAL DIRECTIVE]: Your generated "text" MUST be 100% in English (including any emotes like *sighs* or *smiles*). No Vietnamese or Chinese is allowed.

Return exactly one of these JSON objects, without a Markdown fence or explanation:
{"decision":"send","text":"An English message to send"}
or
{"decision":"silent","text":""}`;

  return [
    { role: "system", content: systemParts.filter(Boolean).join("\n\n---\n\n") },
    { role: "user", content: trigger },
  ];
}

export function parseProactiveDecision(text: string): ProactiveModelDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { kind: "invalid", reason: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "invalid_shape" };
  }
  const value = parsed as { decision?: unknown; text?: unknown };
  if (value.decision === "silent") return { kind: "silent" };
  if (value.decision !== "send") return { kind: "invalid", reason: "invalid_decision" };
  if (typeof value.text !== "string" || !value.text.trim()) return { kind: "invalid", reason: "empty_text" };
  const cleaned = value.text.trim();
  if (cleaned.length > MAX_PROACTIVE_TEXT_LENGTH) return { kind: "invalid", reason: "text_too_long" };
  return { kind: "send", text: cleaned };
}

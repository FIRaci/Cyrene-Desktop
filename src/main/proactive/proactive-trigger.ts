// Proactive chat trigger
//
// Design goals:
// - 60s periodic scan, calling `proactiveChatService.evaluateCandidate({sceneId, score, sceneCooldownMs})`
// - Candidate generation uses user timezone (avoid machine system timezone interference)
// - Scenario list: Initial version only implements morning_greeting / evening_checkin / back_from_away / work_break
// - Weather scenario only keeps sceneId placeholder + optional getWeatherContext injection; weather candidate generation not implemented
//
// Boundaries (per §2.2 doc):
// - Do not modify proactive-service.ts / proactive-policy.ts / proactive-state-store.ts / ProactiveCandidate
// - Do not implement fallback / Function Calling / MCP / proactive external refresh
// - Do not add desire-engine / probability gates
// - Do not implement weather cache, TTL, expiresAt, cross-date checks
//
// When integrating weather cache in the future: only need deps.getWeatherContext to return non-null WeatherContext,
// and add checks inside generateWeatherCandidates. Other structures in this file (periodic loop, candidate ranking,
// evaluateCandidate wiring) require no changes.

import type {
  ProactiveCandidate,
  ProactiveRuntimeSnapshot,
  ProactiveState,
} from "./proactive-types";

/** Weather context. Current implementation is a placeholder; defined by future cache module. */
export interface WeatherContext {
  // Shape determined by future cache module; current implementation reads no fields.
  readonly _placeholder?: never;
}

/** Snapshot + user timezone information required for candidate generation (packaged for pure functions). */
export interface ProactiveTriggerContext {
  now: number;
  timezone: string;
  /** "Current date" in user timezone. */
  localDate: string;
  /** Current hour (0-23) in user timezone. */
  localHour: number;
  /** Current minute (0-59) in user timezone. */
  localMinute: number;

  snapshot: ProactiveRuntimeSnapshot;
  state: ProactiveState;

  /** idleSec during previous tick; null on initial round (used for detecting back_from_away). */
  previousIdleSec: number | null;
  /** User active session start timestamp; reset when idle > 60. */
  activeSessionStartedAt: number | null;

  weather: WeatherContext | null;
}

/** Internal candidate type (with extra reason field for logging). */
interface ProactiveOpportunity {
  sceneId: string;
  score: number;
  sceneCooldownMs: number;
  reason: string;
}

export interface ProactiveTriggerDependencies {
  evaluateCandidate: (candidate: ProactiveCandidate) => Promise<unknown>;
  getRuntimeSnapshot: () => ProactiveRuntimeSnapshot;
  getProactiveState: () => ProactiveState;
  /** Resolved valid user timezone (guaranteed valid IANA). */
  getTimezone: () => string;
  /**
   * Optional: populated when future cache module integrates. Current: omitted / null / empty object generates no candidates.
   */
  getWeatherContext?: () => WeatherContext | null;
  /** Trigger internal backoff Map (held by controller), used for test state assertions. */
  getLastEvaluatedAtByScene: () => Map<string, number>;
  setLastEvaluatedAtByScene: (next: Map<string, number>) => void;
}

export interface ProactiveTriggerController {
  start(): void;
  stop(): void;
  /** Immediately run one round (bypassing timer). */
  evaluateNow(reason?: string): Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────
const TRIGGER_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 90_000;
const INTERVAL_JITTER_MS = 10_000;

const EVALUATION_RETRY_MS = 30 * 60 * 1000;
const MIN_EVALUATION_SCORE = 60;

const AWAY_THRESHOLD_SEC = 30 * 60;
const ACTIVE_THRESHOLD_SEC = 60;
const WORK_BREAK_MIN_MS = 90 * 60 * 1000;

const HALF_HOUR_MS = 30 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const LOG_PREFIX = "[ProactiveTrigger]";

/** Score clamp helper. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Split date into {year, month, day, hour, minute} using Intl (by timezone).
 * Independent of toLocaleString localized punctuation and ordering.
 */
export function getZonedDateParts(
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
    // Fallback to system-local on invalid timezone (only in debug; resolver guarantees valid timezone)
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

/** Date string YYYY-MM-DD in user timezone (for cross-day checks). */
function formatLocalDate(date: Date, timezone: string): string {
  const p = getZonedDateParts(date, timezone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

// ── Scoring components ──────────────────────────────────────────────────
/**
 * Time window fit score (0-15): closer to middle yields higher score, decreases linearly towards edges, 0 outside.
 * Window uses closed interval [startMin, endMin] (minutes 0-1439); endMin < startMin indicates cross-midnight.
 */
function timeWindowFit(
  hour: number,
  minute: number,
  startMin: number,
  endMin: number,
): number {
  const current = hour * 60 + minute;
  let dist: number;
  if (startMin <= endMin) {
    if (current < startMin || current > endMin) return 0;
    const center = (startMin + endMin) / 2;
    const half = (endMin - startMin) / 2;
    dist = Math.abs(current - center);
  } else {
    // Cross-midnight: e.g. 22:00(1320) -> 02:00(120) -> spans midnight window
    if (current >= startMin || current <= endMin) {
      // Inside window: endMin + 1440 for convenient distance calculation
      const center = startMin <= 720
        ? (startMin + (endMin + 1440)) / 2
        : ((startMin + (endMin + 1440)) / 2) - 1440;
      const ref = current >= startMin ? current : current + 1440;
      dist = Math.abs(ref - center);
    } else {
      return 0;
    }
  }
  // Distance 0 -> 15; distance = half -> 0
  const half = (endMin >= startMin ? endMin - startMin : (1440 - startMin) + endMin) / 2;
  if (half <= 0) return current >= startMin && current <= (endMin >= startMin ? endMin : endMin + 1440 - 1440) ? 15 : 0;
  return clamp(Math.round((1 - dist / half) * 15), 0, 15);
}

/** Event urgency (0-20). Regular time greetings score 0. */
function eventUrgency(sceneId: string, ctx: ProactiveTriggerContext): number {
  switch (sceneId) {
    case "back_from_away":
      // Higher score the longer away, capped at 20
      return clamp(Math.round(ctx.snapshot.idleSec / 60), 0, 20);
    case "work_break":
      // Starting from 90min active, +4 every 30min, capped at 20
      const activeMs = ctx.activeSessionStartedAt !== null ? ctx.now - ctx.activeSessionStartedAt : 0;
      if (activeMs < WORK_BREAK_MIN_MS) return 0;
      return clamp(Math.round((activeMs - WORK_BREAK_MIN_MS) / (30 * 60 * 1000)) * 4, 0, 20);
    default:
      return 0;
  }
}

/** Freshness bonus (0-10). Currently returns 0. */
function freshnessBonus(sceneId: string): number {
  // Placeholder: calculate from cache.expiresAt - now when weather candidates enabled
  void sceneId;
  return 0;
}

/** Silence bonus (0-12): higher score the longer since last user activity.
 * Boundary: new users without prior activity receive maximum 12 to ensure trigger on first launch. */
function silenceBonus(ctx: ProactiveTriggerContext): number {
  const lastActivity =
    ctx.state.lastNormalConversationEndedAt !== null
      ? ctx.state.lastNormalConversationEndedAt
      : ctx.state.lastProactiveAt;
  if (lastActivity === null) return 12;
  const elapsed = ctx.now - lastActivity;
  if (elapsed < HALF_HOUR_MS) return 0;
  if (elapsed >= TWO_HOURS_MS) return 12;
  const ratio = (elapsed - HALF_HOUR_MS) / (TWO_HOURS_MS - HALF_HOUR_MS);
  return clamp(Math.round(ratio * 12), 0, 12);
}

/** Unanswered penalty. */
function unansweredPenalty(unansweredCount: 0 | 1 | 2): number {
  if (unansweredCount === 0) return 0;
  if (unansweredCount === 1) return -18;
  return -100;
}

/** Score aggregation: baseScore + fit + urgency + freshness + silence - unanswered. */
function scoreOpportunity(
  baseScore: number,
  fit: number,
  urgency: number,
  sceneId: string,
  ctx: ProactiveTriggerContext,
): number {
  const total =
    baseScore
    + fit
    + urgency
    + freshnessBonus(sceneId)
    + silenceBonus(ctx)
    + unansweredPenalty(ctx.state.unansweredCount);
  return clamp(total, 0, 100);
}

// ── Scenario Definitions ──────────────────────────────────────────────────────────
interface SceneDefinition {
  sceneId: string;
  baseScore: number;
  sceneCooldownMs: number;
  /** Scenario category (determines tie-break priority; lower number = higher priority). */
  priority: number;
  /** Scenario window evaluation + time window match score. Returns score increment. */
  compute(ctx: ProactiveTriggerContext): { fit: number; urgency: number; applicable: boolean };
}

/**
 * Weather scenario ID placeholder.
 * Current: no candidate generated when deps.getWeatherContext is null/empty.
 * When weather cache is connected, return non-empty from getWeatherContext
 * and add logic in generateWeatherCandidates.
 */
const WEATHER_SCENE_IDS = ["weather_rain", "weather_temperature_drop", "weather_sunny"] as const;
type WeatherSceneId = (typeof WEATHER_SCENE_IDS)[number];

const SCENES: readonly SceneDefinition[] = [
  {
    sceneId: "morning_greeting",
    baseScore: 52,
    sceneCooldownMs: 23 * 60 * 60 * 1000,
    priority: 4,
    compute(ctx) {
      // 07:00 - 10:30
      const fit = timeWindowFit(ctx.localHour, ctx.localMinute, 7 * 60, 10 * 60 + 30);
      return { fit, urgency: 0, applicable: fit > 0 };
    },
  },
  {
    sceneId: "evening_checkin",
    baseScore: 44,
    sceneCooldownMs: 8 * 60 * 60 * 1000,
    priority: 4,
    compute(ctx) {
      // 18:00 - 22:00
      const fit = timeWindowFit(ctx.localHour, ctx.localMinute, 18 * 60, 22 * 60);
      return { fit, urgency: 0, applicable: fit > 0 };
    },
  },
  {
    sceneId: "back_from_away",
    baseScore: 68,
    sceneCooldownMs: 4 * 60 * 60 * 1000,
    priority: 1, // highest priority in tie-break
    compute(ctx) {
      if (ctx.previousIdleSec === null) return { fit: 0, urgency: 0, applicable: false };
      const applicable =
        ctx.previousIdleSec >= AWAY_THRESHOLD_SEC &&
        ctx.snapshot.idleSec < ACTIVE_THRESHOLD_SEC;
      return { fit: 0, urgency: eventUrgency("back_from_away", ctx), applicable };
    },
  },
  {
    sceneId: "work_break",
    baseScore: 56,
    sceneCooldownMs: 3 * 60 * 60 * 1000,
    priority: 2,
    compute(ctx) {
      if (ctx.activeSessionStartedAt === null) return { fit: 0, urgency: 0, applicable: false };
      const activeMs = ctx.now - ctx.activeSessionStartedAt;
      const applicable = activeMs >= WORK_BREAK_MIN_MS;
      return { fit: 0, urgency: eventUrgency("work_break", ctx), applicable };
    },
  },
];

// ── Candidate Generation ──────────────────────────────────────────────────────────
function generateTimeOpportunities(ctx: ProactiveTriggerContext): ProactiveOpportunity[] {
  const out: ProactiveOpportunity[] = [];
  for (const scene of SCENES) {
    const { applicable, fit, urgency } = scene.compute(ctx);
    if (!applicable) continue;
    const score = scoreOpportunity(scene.baseScore, fit, urgency, scene.sceneId, ctx);
    if (score < MIN_EVALUATION_SCORE) continue;
    out.push({
      sceneId: scene.sceneId,
      score,
      sceneCooldownMs: scene.sceneCooldownMs,
      reason: `base=${scene.baseScore} fit=${fit} urgency=${urgency}`,
    });
  }
  return out;
}

/**
 * Weather candidate generation (placeholder).
 * Current: returns [] when weather is null/empty.
 * When weather cache connected: return non-empty WeatherContext,
 * and determine whether to generate weather candidates.
 *
 * Note: function signature is fixed.
 */
function generateWeatherOpportunities(
  ctx: ProactiveTriggerContext,
  weather: WeatherContext | null,
): ProactiveOpportunity[] {
  // Explicit filter: no candidate when weather is null / undefined / empty
  if (!weather || typeof weather !== "object") return [];
  if (Object.keys(weather).length === 0) return [];
  // Placeholder: implement weather candidate generation here when cache connected.
  // e.g.:
  //   if (weather.isRaining) opportunities.push({ sceneId: "weather_rain", ... });
  //   if (weather.tempDrop) opportunities.push({ sceneId: "weather_temperature_drop", ... });
  return [];
}

/** Main candidate generation entry point. */
function generateProactiveCandidates(ctx: ProactiveTriggerContext): ProactiveOpportunity[] {
  const timeOpps = generateTimeOpportunities(ctx);
  const weatherOpps = generateWeatherOpportunities(ctx, ctx.weather);
  return [...timeOpps, ...weatherOpps];
}

/** Tie-break: lower priority number first; stable sort for identical priority. */
function sortCandidates(opps: ProactiveOpportunity[]): ProactiveOpportunity[] {
  const priorityByScene = new Map<string, number>();
  for (const s of SCENES) priorityByScene.set(s.sceneId, s.priority);
  // Weather scenarios default priority 3 (before time greetings, after back_from_away/work_break)
  for (const id of WEATHER_SCENE_IDS) {
    if (!priorityByScene.has(id)) priorityByScene.set(id, 3);
  }
  return [...opps].sort((a, b) => {
    const pa = priorityByScene.get(a.sceneId) ?? 99;
    const pb = priorityByScene.get(b.sceneId) ?? 99;
    if (pa !== pb) return pa - pb;
    // Identical priority: maintain stable generation order
    return opps.indexOf(a) - opps.indexOf(b);
  });
}

// ── Fast Pre-filter Before Trigger (does not replace policy) ──────────────────────────────────
function shouldSkipFast(snapshot: ProactiveRuntimeSnapshot): boolean {
  if (!snapshot.enabled) return true;
  if (snapshot.screenLocked) return true;
  if (snapshot.conversationBusy) return true;
  if (snapshot.generationBusy) return true;
  return false;
}

// ── Controller ────────────────────────────────────────────────────────────
export function createProactiveTrigger(deps: ProactiveTriggerDependencies): ProactiveTriggerController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = true;

  // Closure state
  let previousIdleSec: number | null = null;
  let activeSessionStartedAt: number | null = null;

  const log = (event: string, detail?: unknown): void => {
    console.log(`${LOG_PREFIX} ${event}`, detail ?? "");
  };

  function jitter(): number {
    return Math.floor(Math.random() * INTERVAL_JITTER_MS);
  }

  function scheduleNext(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void tick(); }, TRIGGER_INTERVAL_MS + jitter());
  }

  async function evaluateNow(reason: string): Promise<void> {
    const snapshot = deps.getRuntimeSnapshot();
    if (shouldSkipFast(snapshot)) return;

    const state = deps.getProactiveState();
    const timezone = deps.getTimezone();
    const localDate = formatLocalDate(new Date(snapshot.now), timezone);
    const localParts = getZonedDateParts(new Date(snapshot.now), timezone);
    const weather = deps.getWeatherContext?.() ?? null;

    // Update activeSessionStartedAt: reset when user is currently idle
    if (snapshot.idleSec >= ACTIVE_THRESHOLD_SEC) {
      activeSessionStartedAt = null;
    } else if (activeSessionStartedAt === null) {
      activeSessionStartedAt = snapshot.now;
    }

    const ctx: ProactiveTriggerContext = {
      now: snapshot.now,
      timezone,
      localDate,
      localHour: localParts.hour,
      localMinute: localParts.minute,
      snapshot,
      state,
      previousIdleSec,
      activeSessionStartedAt,
      weather,
    };

    const allOpps = generateProactiveCandidates(ctx);
    const filtered = allOpps.filter((o) => o.score >= MIN_EVALUATION_SCORE);
    const sorted = sortCandidates(filtered);

    if (sorted.length === 0) {
      // log("skipped reason=no_candidate_above_threshold", { reason });
      previousIdleSec = snapshot.idleSec;
      return;
    }

    // Backoff check: skip scenarios evaluated in last 30 minutes
    const backoffMap = deps.getLastEvaluatedAtByScene();
    const candidates = sorted.filter((o) => {
      const last = backoffMap.get(o.sceneId);
      if (typeof last === "number" && snapshot.now - last < EVALUATION_RETRY_MS) {
        log("skipped scene=" + o.sceneId + " reason=evaluation_backoff", { reason });
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      previousIdleSec = snapshot.idleSec;
      return;
    }

    const selected = candidates[0];
    log("selected", { sceneId: selected.sceneId, score: selected.score, reason });

    // Record evaluation timestamp
    backoffMap.set(selected.sceneId, snapshot.now);
    deps.setLastEvaluatedAtByScene(backoffMap);

    try {
      await deps.evaluateCandidate({
        sceneId: selected.sceneId,
        score: selected.score,
        sceneCooldownMs: selected.sceneCooldownMs,
      });
    } catch (err) {
      log("evaluation_failed", { sceneId: selected.sceneId, error: err instanceof Error ? err.message : String(err) });
    } finally {
      previousIdleSec = snapshot.idleSec;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    if (running) {
      // Skip if previous round has not finished (guard against re-entrancy)
      scheduleNext();
      return;
    }
    running = true;
    try {
      await evaluateNow("timer");
    } catch (err) {
      log("tick_failed", err instanceof Error ? err.message : String(err));
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function start(): void {
    if (!stopped) return; // Idempotent
    stopped = false;
    if (timer) { clearTimeout(timer); timer = null; }
    timer = setTimeout(() => { void tick(); }, INITIAL_DELAY_MS);
  }

  function stop(): void {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  return { start, stop, evaluateNow };
}

// ── Pure functions / constants exported for testing ───────────────────────────────────
export const TRIGGER_CONSTANTS = {
  TRIGGER_INTERVAL_MS,
  INITIAL_DELAY_MS,
  INTERVAL_JITTER_MS,
  EVALUATION_RETRY_MS,
  MIN_EVALUATION_SCORE,
  AWAY_THRESHOLD_SEC,
  ACTIVE_THRESHOLD_SEC,
  WORK_BREAK_MIN_MS,
  WEATHER_SCENE_IDS,
} as const;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProactiveTrigger,
  getZonedDateParts,
  type ProactiveTriggerDependencies,
  TRIGGER_CONSTANTS,
} from "./proactive-trigger";
import { createDefaultProactiveState } from "./proactive-policy";
import type {
  ProactiveCandidate,
  ProactiveRuntimeSnapshot,
  ProactiveState,
} from "./proactive-types";

const TIMEZONE = "Asia/Shanghai";
const FIXED_NOW = Date.UTC(2026, 6, 21, 12, 0, 0); // 2026-07-21 12:00 UTC = 20:00 Asia/Shanghai

function makeSnapshot(overrides: Partial<ProactiveRuntimeSnapshot> = {}): ProactiveRuntimeSnapshot {
  return {
    now: FIXED_NOW,
    localHour: 20,
    idleSec: 30,
    enabled: true,
    conversationBusy: false,
    generationBusy: false,
    screenLocked: false,
    ...overrides,
  };
}

interface SetupResult {
  trigger: ReturnType<typeof createProactiveTrigger>;
  evaluateCandidate: ReturnType<typeof vi.fn>;
  snapshot: ProactiveRuntimeSnapshot;
  state: ProactiveState;
  backoffMap: Map<string, number>;
  setSnapshot: (next: Partial<ProactiveRuntimeSnapshot>) => void;
  setState: (next: Partial<ProactiveState>) => void;
}

function setup(overrides: Partial<ProactiveTriggerDependencies> = {}): SetupResult {
  const snapshot: ProactiveRuntimeSnapshot = makeSnapshot();
  const state: ProactiveRuntimeState extends never ? ProactiveState : ProactiveState = createDefaultProactiveState();
  const backoffMap = new Map<string, number>();
  const evaluateCandidate = vi.fn(async (_c: ProactiveCandidate) => undefined);

  // current state is guaranteed to be ProactiveState
  const typedState = state as ProactiveState;
  const trigger = createProactiveTrigger({
    evaluateCandidate,
    getRuntimeSnapshot: () => ({ ...snapshot }),
    getProactiveState: () => ({ ...typedState }),
    getTimezone: () => TIMEZONE,
    getLastEvaluatedAtByScene: () => new Map(backoffMap),
    setLastEvaluatedAtByScene: (next) => {
      backoffMap.clear();
      for (const [k, v] of next) backoffMap.set(k, v);
    },
    ...overrides,
  });

  return {
    trigger,
    evaluateCandidate,
    snapshot,
    state: typedState,
    backoffMap,
    setSnapshot: (next) => {
      Object.assign(snapshot, next);
    },
    setState: (next) => {
      Object.assign(typedState, next);
    },
  };
}

// ts placeholder
type ProactiveRuntimeState = never;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createProactiveTrigger lifecycle", () => {
  it("start() is idempotent: calling twice creates only one loop", () => {
    const ctx = setup();
    ctx.trigger.start();
    ctx.trigger.start();
    expect(vi.getTimerCount()).toBe(1);
    ctx.trigger.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not trigger after stop()", async () => {
    const ctx = setup();
    ctx.trigger.start();
    // Advance INITIAL_DELAY -> first tick runs
    await vi.advanceTimersByTimeAsync(
      TRIGGER_CONSTANTS.INITIAL_DELAY_MS + TRIGGER_CONSTANTS.INTERVAL_JITTER_MS + 10,
    );
    expect(ctx.evaluateCandidate.mock.calls.length).toBeGreaterThanOrEqual(1);
    const callsAfterFirst = ctx.evaluateCandidate.mock.calls.length;
    // Stop immediately
    ctx.trigger.stop();
    expect(vi.getTimerCount()).toBe(0);
    // Subsequent time advances produce no further calls
    await vi.advanceTimersByTimeAsync(TRIGGER_CONSTANTS.TRIGGER_INTERVAL_MS * 5);
    expect(ctx.evaluateCandidate.mock.calls.length).toBe(callsAfterFirst);
  });

  it("loop continues after evaluateCandidate throws", async () => {
    const ctx = setup();
    ctx.evaluateCandidate.mockRejectedValueOnce(new Error("boom"));
    ctx.trigger.start();
    // Run two rounds
    for (let i = 0; i < 2; i++) {
      await vi.advanceTimersByTimeAsync(
        TRIGGER_CONSTANTS.INITIAL_DELAY_MS + TRIGGER_CONSTANTS.TRIGGER_INTERVAL_MS * i + TRIGGER_CONSTANTS.INTERVAL_JITTER_MS + 100,
      );
    }
    // Called at least once, loop did not crash permanently
    expect(ctx.evaluateCandidate.mock.calls.length).toBeGreaterThanOrEqual(1);
    // Key assertion: next timer is scheduled
    expect(vi.getTimerCount()).toBe(1);
    ctx.trigger.stop();
  });

  it("does not concurrently re-enter when previous round is running", async () => {
    let resolveEvaluation: ((v: unknown) => void) | null = null;
    const ctx = setup();
    ctx.evaluateCandidate.mockImplementationOnce(() => new Promise((resolve) => { resolveEvaluation = resolve; }));
    ctx.trigger.start();
    // First tick triggers evaluateCandidate without resolving
    await vi.advanceTimersByTimeAsync(TRIGGER_CONSTANTS.INITIAL_DELAY_MS + TRIGGER_CONSTANTS.INTERVAL_JITTER_MS + 10);
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);

    // Advance a full tick interval while first round is still running
    await vi.advanceTimersByTimeAsync(TRIGGER_CONSTANTS.TRIGGER_INTERVAL_MS);
    // No concurrent re-entrancy
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);

    // Resolve first round
    resolveEvaluation!(undefined);
    // Wait for microtasks to clear
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe("candidate selection and evaluation", () => {
  it("does not call service when no candidate reaches 60 points", async () => {
    const ctx = setup();
    // 2026-07-21 06:00 UTC = 14:00 Asia/Shanghai (outside morning/evening window)
    // idleSec=0 sets activeSessionStartedAt, but 14:00 is not evening window
    // work_break requires activeMs >= 90min; first evaluateNow activeMs=0 -> does not trigger
    // No idle edge (previousIdleSec=null)
    const noonNow = Date.UTC(2026, 6, 21, 6, 0, 0);
    ctx.setSnapshot({ now: noonNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).not.toHaveBeenCalled();
  });

  it("generates morning_greeting candidate in morning window and calls evaluateCandidate", async () => {
    const ctx = setup();
    // 2026-07-22 00:30 UTC = 08:30 Asia/Shanghai (mid morning window 07:00-10:30)
    const morningNow = Date.UTC(2026, 6, 22, 0, 30, 0);
    ctx.setSnapshot({ now: morningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    const arg = ctx.evaluateCandidate.mock.calls[0][0] as ProactiveCandidate;
    expect(arg.sceneId).toBe("morning_greeting");
    expect(arg.sceneCooldownMs).toBe(23 * 60 * 60 * 1000);
  });

  it("picks only the highest score among multiple candidates", async () => {
    const ctx = setup();
    // 2026-07-21 12:00 UTC = 20:00 Asia/Shanghai (mid evening window 18:00-22:00)
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({
      now: eveningNow,
      idleSec: 30,
    });
    ctx.setState({
      lastNormalConversationEndedAt: eveningNow - 3 * 60 * 60 * 1000,
    });
    // Round 1: previousIdleSec=null -> back_from_away does not trigger; triggers evening
    await ctx.trigger.evaluateNow("round1");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(ctx.evaluateCandidate.mock.calls[0][0].sceneId).toBe("evening_checkin");

    // Round 2: previousIdleSec=0, simulates previous idle=30min and now <60s
    ctx.setSnapshot({ now: eveningNow + 60_000, idleSec: 30 * 60 }); // now idle=30min
    await ctx.trigger.evaluateNow("round2");
    // previousIdleSec now = 30*60, current=30*60 -> does not trigger back_from_away
    // Round 2 skipped, calls remains 1
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);

    ctx.setSnapshot({ now: eveningNow + 120_000, idleSec: 10 });
    ctx.backoffMap.clear();
    await ctx.trigger.evaluateNow("round3");
    // previousIdleSec=1800, current=10 -> triggers back_from_away
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(2);
    expect(ctx.evaluateCandidate.mock.calls[1][0].sceneId).toBe("back_from_away");
  });

  it("does not repeatedly call within 30min evaluation backoff for same scenario", async () => {
    const ctx = setup();
    // 2026-07-21 12:00 UTC = 20:00 Asia/Shanghai (mid evening)
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("first");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    // Immediate follow-up: still in 30min backoff, should skip
    ctx.setSnapshot({ now: eveningNow + 60_000, idleSec: 0 });
    await ctx.trigger.evaluateNow("second");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    // Advance to 31 min later: backoff cleared
    ctx.setSnapshot({ now: eveningNow + 31 * 60 * 1000, idleSec: 0 });
    await ctx.trigger.evaluateNow("third");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(2);
  });
});

describe("back_from_away edge detection", () => {
  it("previousIdleSec=null (first time) does not generate back_from_away", async () => {
    const ctx = setup();
    // 2026-07-21 12:00 UTC = 20:00 Asia/Shanghai (mid evening)
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("first");
    // evening_checkin triggers, back_from_away should not
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(ctx.evaluateCandidate.mock.calls[0][0].sceneId).toBe("evening_checkin");
  });

  it("generates back_from_away when previousIdleSec >= 30min and current < 60s", async () => {
    const ctx = setup();
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    // Round 1: previousIdleSec=null -> does not generate back_from_away; generates evening
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("first");
    // previousIdleSec now = 0 (idle<60)
    // Round 2: previousIdleSec=0, simulates previous idle=30min and now <60s -> manually set snapshot now and idleSec then run
    // Verify evaluateNow updates previousIdleSec internally
    ctx.setSnapshot({ now: eveningNow + 60_000, idleSec: 30 * 60 }); // now idle=30min
    await ctx.trigger.evaluateNow("second"); // does not trigger back_from_away
    // previousIdleSec now = 30*60
    ctx.setSnapshot({ now: eveningNow + 120_000, idleSec: 10 }); // now idle<60
    ctx.backoffMap.clear(); // clear backoff
    await ctx.trigger.evaluateNow("third"); // previousIdleSec=1800, current=10 -> triggers back_from_away
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(2); // skipped second round
    expect(ctx.evaluateCandidate.mock.calls[1][0].sceneId).toBe("back_from_away");
  });
});

describe("weather context gating (placeholder)", () => {
  it("4 core scenarios work normally when getWeatherContext is omitted", async () => {
    const ctx = setup(); // no getWeatherContext
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(ctx.evaluateCandidate.mock.calls[0][0].sceneId).toBe("evening_checkin");
  });

  it("getWeatherContext returning null does not affect 4 core scenarios", async () => {
    const ctx = setup({ getWeatherContext: () => null });
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(ctx.evaluateCandidate.mock.calls[0][0].sceneId).toBe("evening_checkin");
  });

  it("does not generate weather candidates when getWeatherContext returns empty object", async () => {
    const ctx = setup({ getWeatherContext: () => ({}) });
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    // Only evening is inside window among 4 core scenarios
    expect(ctx.evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(ctx.evaluateCandidate.mock.calls[0][0].sceneId).toBe("evening_checkin");
    // No weather_* scenario called
    for (const call of ctx.evaluateCandidate.mock.calls) {
      const id = (call[0] as ProactiveCandidate).sceneId;
      expect(id).not.toMatch(/^weather_/);
    }
  });
});

describe("fast filters (not a substitute for policy)", () => {
  it("does not evaluate when proactiveChatMode=off", async () => {
    const ctx = setup();
    ctx.setSnapshot({ enabled: false });
    const eveningNow = Date.UTC(2026, 6, 21, 12, 0, 0);
    ctx.setSnapshot({ now: eveningNow, idleSec: 0 });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).not.toHaveBeenCalled();
  });

  it("does not evaluate when conversationBusy", async () => {
    const ctx = setup();
    ctx.setSnapshot({ conversationBusy: true });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).not.toHaveBeenCalled();
  });

  it("does not evaluate when generationBusy", async () => {
    const ctx = setup();
    ctx.setSnapshot({ generationBusy: true });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).not.toHaveBeenCalled();
  });

  it("does not evaluate when screenLocked", async () => {
    const ctx = setup();
    ctx.setSnapshot({ screenLocked: true });
    await ctx.trigger.evaluateNow("test");
    expect(ctx.evaluateCandidate).not.toHaveBeenCalled();
  });
});

describe("getZonedDateParts", () => {
  // 2026-07-21T15:30:00.000Z
  const FIXED_UTC = Date.UTC(2026, 6, 21, 15, 30, 0);

  it("Asia/Taipei (UTC+8) -> 23:30 same day", () => {
    const p = getZonedDateParts(new Date(FIXED_UTC), "Asia/Taipei");
    expect(p).toEqual({ year: 2026, month: 7, day: 21, hour: 23, minute: 30 });
  });

  it("UTC -> 15:30 same day", () => {
    const p = getZonedDateParts(new Date(FIXED_UTC), "UTC");
    expect(p).toEqual({ year: 2026, month: 7, day: 21, hour: 15, minute: 30 });
  });

  it("America/Los_Angeles (PDT, UTC-7) -> 08:30 same day", () => {
    const p = getZonedDateParts(new Date(FIXED_UTC), "America/Los_Angeles");
    expect(p).toEqual({ year: 2026, month: 7, day: 21, hour: 8, minute: 30 });
  });

  it("falls back to system-local on invalid timezone", () => {
    const p = getZonedDateParts(new Date(FIXED_UTC), "Foo/Bar");
    // Does not throw, returns number object
    expect(typeof p.year).toBe("number");
    expect(typeof p.hour).toBe("number");
  });
});
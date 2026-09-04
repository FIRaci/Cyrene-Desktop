import { describe, expect, it } from "vitest";
import { buildProactiveMessages, parseProactiveDecision } from "./proactive-prompt";

// Explicit timezone passed for all tests, independent of runner environment.
const TIMEZONE = "Asia/Shanghai";

const turn = (role: "user" | "model", index: number) => ({ role, content: `${role}-${index}`, at: index });

describe("proactive prompt", () => {
  it("labels and limits ordinary and proactive histories independently", () => {
    const messages = buildProactiveMessages({
      basePersona: "PERSONA",
      userProfile: "PROFILE",
      relevantMemory: "MEMORY",
      ordinaryHistory: Array.from({ length: 20 }, (_, index) => turn(index % 2 ? "model" : "user", index)),
      proactiveHistory: Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 ? "model" as const : "user" as const,
        content: `proactive-${index}`,
        at: index,
      })),
      sceneId: "work_break",
      localNow: new Date(Date.UTC(2026, 6, 13, 6, 0)), // 14:00 Asia/Shanghai
      idleSec: 0,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });

    const system = String(messages[0].content);
    expect(system).toContain("PERSONA");
    expect(system).toContain("[RECENT ORDINARY CHAT]");
    expect(system).toContain("[PROACTIVE CHAT HISTORY]");
    expect(system).toContain("user-4");
    expect(system).not.toContain("user-2");
    expect(system).toContain("proactive-2");
    expect(system).toContain("Do not treat the last historical message as newly received");
  });

  it("adds night system only during an active local night", () => {
    // 23:00 Asia/Shanghai (UTC+8) -> 15:00 UTC
    const nightUtc = Date.UTC(2026, 6, 13, 15, 0);
    const night = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "late_night",
      localNow: new Date(nightUtc),
      idleSec: 20,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    // 14:00 Asia/Shanghai -> 06:00 UTC
    const dayUtc = Date.UTC(2026, 6, 13, 6, 0);
    const day = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "work_break",
      localNow: new Date(dayUtc),
      idleSec: 0,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });

    expect(String(night[0].content)).toContain("[night_system]");
    expect(String(night[0].content)).toContain("Never reveal detection of keyboard");
    expect(String(day[0].content)).not.toContain("[night_system]");
  });

  it("adds strict final-followup rules after one unanswered message", () => {
    const dayUtc = Date.UTC(2026, 6, 13, 6, 0); // 14:00 Asia/Shanghai
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "rainy_day",
      localNow: new Date(dayUtc),
      idleSec: 0,
      unansweredCount: 1,
      timezone: TIMEZONE,
    });
    expect(String(messages[0].content)).toContain("[followup_system]");
    expect(String(messages[0].content)).toContain("This is the final permitted proactive attempt");
    expect(String(messages[0].content)).toContain("Do not blame, pressure, seek sympathy");
  });

  it("asks for strict JSON without tool instructions", () => {
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "morning",
      localNow: new Date(2026, 6, 13, 1, 0), // 09:00 Asia/Shanghai
      idleSec: 0,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    const combined = messages.map((message) => String(message.content)).join("\n");
    expect(combined).toContain('{"decision":"silent","text":""}');
    expect(combined).not.toContain("tools");
    expect(combined).not.toContain("Tool Calling");
  });
});

describe("proactive prompt timezone", () => {
  const FIXED_UTC = Date.UTC(2026, 6, 21, 15, 30, 0);
  const FIXED_DATE = new Date(FIXED_UTC);

  it("formatLocalTime uses specified timezone", () => {
    // Asia/Taipei (UTC+8) -> 23:30 same day
    const taipeiMessages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "evening_checkin",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "Asia/Taipei",
    });
    const taipeiCombined = taipeiMessages.map((m) => String(m.content)).join("\n");
    expect(taipeiCombined).toContain("Local computer time: 2026-07-21 23:30");

    // UTC -> 15:30 same day
    const utcMessages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "work_break",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "UTC",
    });
    const utcCombined = utcMessages.map((m) => String(m.content)).join("\n");
    expect(utcCombined).toContain("Local computer time: 2026-07-21 15:30");

    // America/Los_Angeles (PDT, UTC-7) -> 08:30 same day
    const laMessages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "morning_greeting",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "America/Los_Angeles",
    });
    const laCombined = laMessages.map((m) => String(m.content)).join("\n");
    expect(laCombined).toContain("Local computer time: 2026-07-21 08:30");
  });

  it("history row timestamps use specified timezone", () => {
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [{ role: "user", content: "hi", at: FIXED_UTC }],
      proactiveHistory: [],
      sceneId: "evening_checkin",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "Asia/Taipei",
    });
    const system = String(messages[0].content);
    expect(system).toContain("[2026-07-21 23:30] user: hi");
  });

  it("Asia/Taipei 23:30 is recognized as active night", () => {
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "late_night",
      localNow: FIXED_DATE,
      idleSec: 30,
      unansweredCount: 0,
      timezone: "Asia/Taipei",
    });
    expect(String(messages[0].content)).toContain("[night_system]");
  });

  it("America/Los_Angeles at same instant 08:30 is not recognized as active night", () => {
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "morning_greeting",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "America/Los_Angeles",
    });
    expect(String(messages[0].content)).not.toContain("[night_system]");
  });

  it("22:00 and 08:00 boundary preserves active night semantics", () => {
    // 2026-07-21T14:00:00.000Z = Asia/Shanghai 22:00 -> Night
    const t22 = new Date(Date.UTC(2026, 6, 21, 14, 0, 0));
    const night22 = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "evening_checkin",
      localNow: t22,
      idleSec: 30,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    expect(String(night22[0].content)).toContain("[night_system]");

    // 2026-07-21T23:00:00.000Z = Asia/Shanghai 07:00 -> Night (< 8)
    const t07 = new Date(Date.UTC(2026, 6, 21, 23, 0, 0));
    const night07 = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "evening_checkin",
      localNow: t07,
      idleSec: 30,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    expect(String(night07[0].content)).toContain("[night_system]");

    // 08:00 Asia/Shanghai -> Day
    const t08 = new Date(Date.UTC(2026, 6, 22, 0, 0, 0));
    const day08 = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "morning_greeting",
      localNow: t08,
      idleSec: 0,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    expect(String(day08[0].content)).not.toContain("[night_system]");

    // 09:00 Asia/Shanghai -> Day
    const t09 = new Date(Date.UTC(2026, 6, 22, 1, 0, 0));
    const day09 = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "morning_greeting",
      localNow: t09,
      idleSec: 0,
      unansweredCount: 0,
      timezone: TIMEZONE,
    });
    expect(String(day09[0].content)).not.toContain("[night_system]");
  });

  it("illegal timezone fallback to system-local defense", () => {
    const messages = buildProactiveMessages({
      basePersona: "P",
      ordinaryHistory: [],
      proactiveHistory: [],
      sceneId: "evening_checkin",
      localNow: FIXED_DATE,
      idleSec: 0,
      unansweredCount: 0,
      timezone: "Foo/Bar",
    });
    const combined = messages.map((m) => String(m.content)).join("\n");
    expect(combined).toContain("Local computer time:");
    expect(combined).toContain("Candidate scene: evening_checkin");
  });
});

describe("parseProactiveDecision", () => {
  it("parses send and silent decisions", () => {
    expect(parseProactiveDecision('{"decision":"send","text":"Rest early tonight♪"}')).toEqual({
      kind: "send",
      text: "Rest early tonight♪",
    });
    expect(parseProactiveDecision('{"decision":"silent","text":"ignored"}')).toEqual({ kind: "silent" });
  });

  it("rejects prose wrappers, empty send text, and oversized output", () => {
    expect(parseProactiveDecision('Sure: {"decision":"silent","text":""}').kind).toBe("invalid");
    expect(parseProactiveDecision('{"decision":"send","text":"   "}').kind).toBe("invalid");
    expect(parseProactiveDecision(JSON.stringify({ decision: "send", text: "x".repeat(501) })).kind).toBe("invalid");
  });
});
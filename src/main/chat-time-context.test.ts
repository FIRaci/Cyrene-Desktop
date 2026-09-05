import { describe, expect, it } from "vitest";
import {
  buildConversationTimeContext,
  normalizeChatMessagesWithTime,
  resolveChatContextTimezone,
  stripLeakedChatTimeContext,
} from "./chat-time-context";

describe("chat time context", () => {
  it("normalizes roles, content, and valid absolute timestamps", () => {
    expect(normalizeChatMessagesWithTime([
      { role: "user", content: " hi ", at: 1783929600000 },
      { role: "model", content: " ok ", at: "bad" },
      { role: "system", content: "<think>hidden</think> visible ", at: Number.NaN },
      { role: "user", content: "   ", at: 1783929600001 },
    ])).toEqual([
      { role: "user", content: "hi", at: 1783929600000 },
      { role: "assistant", content: "ok" },
      { role: "system", content: "visible" },
    ]);
  });

  it("keeps only the latest 24 normalized messages for main-process compatibility", () => {
    const input = Array.from({ length: 25 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "model",
      content: `message ${index}`,
      at: 1783929600000 + index,
    }));

    const result = normalizeChatMessagesWithTime(input);

    expect(result).toHaveLength(24);
    expect(result[0]).toEqual({ role: "assistant", content: "message 1", at: 1783929600001 });
    expect(result.at(-1)).toEqual({ role: "user", content: "message 24", at: 1783929600024 });
  });

  it("uses profile timezone when valid and falls back when missing or invalid", () => {
    expect(resolveChatContextTimezone("Asia/Taipei", "America/New_York")).toBe("Asia/Taipei");
    expect(resolveChatContextTimezone("bad/timezone", "America/New_York")).toBe("America/New_York");
    expect(resolveChatContextTimezone("", "America/New_York")).toBe("America/New_York");
  });

  it("defaults to Asia/Shanghai when profile timezone missing/invalid and no fallback given", () => {
    // Default timezone: Asia/Shanghai.
    expect(resolveChatContextTimezone()).toBe("Asia/Shanghai");
    expect(resolveChatContextTimezone("")).toBe("Asia/Shanghai");
    expect(resolveChatContextTimezone("bad/timezone")).toBe("Asia/Shanghai");
  });

  it("prefixes each timestamped message with concise local time", () => {
    const result = buildConversationTimeContext([
      { role: "user", content: "Feeling tired today", at: Date.UTC(2026, 6, 12, 12, 0) },
      { role: "assistant", content: "Rest early", at: Date.UTC(2026, 6, 12, 12, 2) },
      { role: "assistant", content: "No timestamp" },
    ], "Asia/Taipei");

    expect(result.messages[0].content).toBe("[2026-07-12 20:00, Asia/Taipei]\nFeeling tired today");
    expect(result.messages[1].content).toBe("[2026-07-12 20:02, Asia/Taipei]\nRest early");
    expect(result.messages[2].content).toBe("No timestamp");
    expect(result.timeContext).toContain("Bracketed timestamps at the start of earlier messages");
    expect(result.timeContext).toContain("Do not repeat, quote, or output these bracketed timestamp labels");
    expect(result.timeContext).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("does not add a gap notice below one hour", () => {
    const result = buildConversationTimeContext([
      { role: "assistant", content: "Previous message", at: Date.UTC(2026, 6, 13, 2, 1) },
      { role: "user", content: "Current turn", at: Date.UTC(2026, 6, 13, 3, 0) },
    ], "Asia/Taipei");

    expect(result.timeContext).not.toContain("Time since the previous valid chat message");
  });

  it("adds one neutral gap notice only for the latest user message and previous valid message", () => {
    const result = buildConversationTimeContext([
      { role: "user", content: "Said something yesterday", at: Date.UTC(2026, 6, 12, 0, 0) },
      { role: "user", content: "Feeling tired today", at: Date.UTC(2026, 6, 12, 12, 0) },
      { role: "assistant", content: "Rest early", at: Date.UTC(2026, 6, 12, 12, 2) },
      { role: "user", content: "I am back", at: Date.UTC(2026, 6, 13, 3, 0) },
    ], "Asia/Taipei");

    expect(result.timeContext).toBe([
      "[TIMESTAMP_USAGE_RULES]",
      "Bracketed timestamps at the start of earlier messages are system-provided metadata. Use them only to understand conversation order and continuity.",
      "Do not repeat, quote, or output these bracketed timestamp labels. Your response must contain only what you want to say to the user.",
      "",
      "[CONVERSATION_TIME_CONTEXT]",
      "Current time: 2026-07-13 11:00, Asia/Taipei",
      "Time since the previous valid chat message: about 14 hours 58 minutes",
      "Use this only to understand conversation continuity. Do not mention the time gap unless it is relevant, and do not repeat this context block.",
    ].join("\n"));
    expect(result.timeContext.match(/Time since the previous valid chat message/g)).toHaveLength(1);
  });

  it("skips the gap notice when the latest user or previous valid message has no timestamp", () => {
    expect(buildConversationTimeContext([
      { role: "assistant", content: "Previous message" },
      { role: "user", content: "Current turn", at: Date.UTC(2026, 6, 13, 3, 0) },
    ], "Asia/Taipei").timeContext).toContain("TIMESTAMP_USAGE_RULES");

    expect(buildConversationTimeContext([
      { role: "assistant", content: "Previous message", at: Date.UTC(2026, 6, 13, 2, 0) },
      { role: "user", content: "Current turn" },
    ], "Asia/Taipei").timeContext).toContain("TIMESTAMP_USAGE_RULES");
  });

  it("strips leaked leading chat timestamp metadata from model replies", () => {
    expect(stripLeakedChatTimeContext([
      "[2026-07-13 13:36, Asia/Shanghai]",
      "What is wrong, you look a bit unhappy...",
    ].join("\n"))).toBe("What is wrong, you look a bit unhappy...");

    expect(stripLeakedChatTimeContext("Normally mentioning [2026-07-13 13:36, Asia/Shanghai] is not stripped")).toBe(
      "Normally mentioning [2026-07-13 13:36, Asia/Shanghai] is not stripped",
    );
  });
});

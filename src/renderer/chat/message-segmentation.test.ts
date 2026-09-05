import { describe, expect, it } from "vitest";
import {
  getAssistantReplyBubbleTexts,
  segmentAssistantReply,
  shouldBreakStreamingBubbleAfterChar,
  shouldSkipStreamingBubbleLeadingChar,
  shouldSegmentAssistantReply,
} from "./message-segmentation";

describe("message segmentation", () => {
  it("keeps short natural chat bubbles intact", () => {
    const text = "Haha okay, so handsome! But cute is better♪";
    expect(segmentAssistantReply(text)).toEqual([text]);
  });

  it("splits compact multi-sentence casual replies", () => {
    const parts = [
      "Weather is cool today!",
      "Did it rain over there?",
      "Great work on coding!",
      "Take a break now!",
    ];
    const text = parts.join("");

    const result = segmentAssistantReply(text);

    expect(result).toEqual(parts);
    expect(result.join("")).toBe(text);
  });

  it("uses sentence-ending punctuation as streaming bubble boundaries", () => {
    expect(shouldBreakStreamingBubbleAfterChar("。")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("？")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("?")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("！")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("!")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("；")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar(";")).toBe(true);
    expect(shouldBreakStreamingBubbleAfterChar("，")).toBe(false);
  });

  it("skips whitespace at the start of a streaming bubble", () => {
    expect(shouldSkipStreamingBubbleLeadingChar("\n", true)).toBe(true);
    expect(shouldSkipStreamingBubbleLeadingChar("\r", true)).toBe(true);
    expect(shouldSkipStreamingBubbleLeadingChar(" ", true)).toBe(true);
    expect(shouldSkipStreamingBubbleLeadingChar("A", true)).toBe(false);
    expect(shouldSkipStreamingBubbleLeadingChar("\n", false)).toBe(false);
  });

  it("splits medium natural chat into two readable bubbles", () => {
    const text = [
      "I know you have tried your very best today and pushed through everything!",
      "Take your time to wrap up the most critical part and get some rest tonight!"
    ].join("");

    const parts = segmentAssistantReply(text);

    expect(parts).toHaveLength(2);
    expect(parts.join("")).toBe(text);
    expect(parts.every((part) => part.length >= 35)).toBe(true);
  });

  it("caps long chat replies at ten bubbles", () => {
    const text = "Do not push yourself too hard today, we can start with small steps!".repeat(12);
    const parts = segmentAssistantReply(text);

    expect(parts.length).toBeLessThanOrEqual(10);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.join("")).toBe(text);
  });

  it("does not split structured content", () => {
    expect(segmentAssistantReply("```ts\nconst a = 1;\n```\nDo not split this part.")).toHaveLength(1);
    expect(segmentAssistantReply("- Item one\n- Item two\n- Item three\nDo not split this part either.")).toHaveLength(1);
    expect(segmentAssistantReply("| A | B |\n|---|---|\n| 1 | 2 |")).toHaveLength(1);
  });

  it("applies preference by current chat mode", () => {
    expect(shouldSegmentAssistantReply("chat", "chat")).toBe(true);
    expect(shouldSegmentAssistantReply("work", "chat")).toBe(false);
    expect(shouldSegmentAssistantReply("work", "all")).toBe(true);
    expect(shouldSegmentAssistantReply("chat", "off")).toBe(false);
  });

  it("keeps one empty assistant bubble only while streaming", () => {
    expect(getAssistantReplyBubbleTexts("", "chat", "all")).toEqual([]);
    expect(getAssistantReplyBubbleTexts("", "chat", "all", { preserveEmpty: true })).toEqual([""]);
  });
});

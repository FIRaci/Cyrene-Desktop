/**
 * think-filter unit tests
 *
 * Core test scenarios covering streaming think filter.
 */

import { describe, expect, test } from "vitest";
import { createThinkFilter, stripThinkBlocks, type ThinkFilterMode } from "./think-filter";

/** Helper: feeds string char-by-char to simulate streaming */
function feedByChar(filter: ReturnType<typeof createThinkFilter>, text: string): string {
  let result = "";
  for (const char of text) {
    result += filter.push(char);
  }
  result += filter.flush();
  return result;
}

/** Helper: feeds string in chunks of specified size */
function feedByChunks(filter: ReturnType<typeof createThinkFilter>, text: string, chunkSize: number): string {
  let result = "";
  for (let i = 0; i < text.length; i += chunkSize) {
    result += filter.push(text.slice(i, i + chunkSize));
  }
  result += filter.flush();
  return result;
}

describe("think-filter - leading-only mode (default)", () => {
  const mode: ThinkFilterMode = "leading-only";

  test("message starts with <think>: filters think block, keeps subsequent body", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<think>thinking process</think>this is the answer");
    expect(result).toBe("this is the answer");
  });

  test("message does not start with <think>: passes through as-is", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "this is a normal answer");
    expect(result).toBe("this is a normal answer");
  });

  test("does not accidentally strip <think> tag mentioned in text", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "This model outputs `<think>...</think>` tags.");
    expect(result).toBe("This model outputs `<think>...</think>` tags.");
  });

  test("message starts with whitespace + <think>: still filters (preserves leading whitespace)", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "\n\n<think>thinking</think>answer");
    expect(result).toBe("\n\nanswer");
  });

  test("multiple <think> blocks (all filtered once leading mode triggers)", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<think>thought 1</think>answer 1<think>thought 2</think>answer 2");
    expect(result).toBe("answer 1answer 2");
  });

  test("<think> tag split across chunks", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChunks(filter, "<think>thinking</think>answer", 3);
    expect(result).toBe("answer");
  });

  test("<think> tag split char by char", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<think>abc</think>def");
    expect(result).toBe("def");
  });

  test("single chunk containing both thinking and answer", () => {
    const filter = createThinkFilter(mode);
    const pushed = filter.push("<think>thinking</think>answer");
    const flushed = filter.flush();
    expect(pushed + flushed).toBe("answer");
  });

  test("unclosed <think>: discard subsequent content", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<think>unclosed thinking");
    expect(result).toBe("");
  });

  test("empty message", () => {
    const filter = createThinkFilter(mode);
    expect(filter.push("")).toBe("");
    expect(filter.flush()).toBe("");
  });

  test("whitespace-only message", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "   \n\n  ");
    expect(result).toBe("   \n\n  ");
  });

  test("starts with < but not <think>: passes through as-is", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<div>hello</div>");
    expect(result).toBe("<div>hello</div>");
  });
});

describe("think-filter - strict mode", () => {
  const mode: ThinkFilterMode = "strict";

  test("filters all <think> blocks in full text", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "prefix<think>thought</think>mid<think>more</think>suffix");
    expect(result).toBe("prefixmidsuffix");
  });

  test("filters even when not starting with <think>", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "answer<think>thought</think>");
    expect(result).toBe("answer");
  });

  test("strips <think> tag mentioned in body (strict feature)", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "this model outputs <think>xxx</think> tags");
    expect(result).toBe("this model outputs  tags");
  });
});

describe("think-filter - disabled mode", () => {
  const mode: ThinkFilterMode = "disabled";

  test("passes through as-is", () => {
    const filter = createThinkFilter(mode);
    const result = feedByChar(filter, "<think>thinking</think>answer");
    expect(result).toBe("<think>thinking</think>answer");
  });
});

describe("think-filter - FC loop scenarios", () => {
  test("two LLM calls: unclosed think in first call does not affect second", () => {
    // First message (unclosed think)
    const filter1 = createThinkFilter("leading-only");
    const result1 = feedByChar(filter1, "<think>I want to call a tool");
    expect(result1).toBe(""); // think content filtered

    // Second message (new filter, independent state)
    const filter2 = createThinkFilter("leading-only");
    const result2 = feedByChar(filter2, "Playback request dispatched.");
    expect(result2).toBe("Playback request dispatched.");
  });

  test("second output displays normally after tool call", () => {
    const filter = createThinkFilter("leading-only");
    // First LLM output
    const r1 = filter.push("<think>call tool</think>");
    filter.flush();
    // Simulate new filter for TEXT_MESSAGE_START
    const filter2 = createThinkFilter("leading-only");
    const r2 = feedByChar(filter2, "Tool execution completed, here is final answer.");
    expect(r2).toBe("Tool execution completed, here is final answer.");
  });
});

describe("think-filter - edge cases", () => {
  test("empty delta produces no output", () => {
    const filter = createThinkFilter("leading-only");
    expect(filter.push("")).toBe("");
    expect(filter.push("")).toBe("");
  });

  test("flush in passthrough state returns empty", () => {
    const filter = createThinkFilter("leading-only");
    filter.push("normal text");
    expect(filter.flush()).toBe("");
  });

  test("flush in buffering state returns full buffer", () => {
    const filter = createThinkFilter("leading-only");
    filter.push("<thi"); // under 7 chars, still buffering
    const result = filter.flush();
    expect(result).toBe("<thi");
  });

  test("case insensitive", () => {
    const filter = createThinkFilter("leading-only");
    const result = feedByChar(filter, "<THINK>thinking</THINK>answer");
    expect(result).toBe("answer");
  });

  test("onThinkChunk receives thinking delta chunks while streaming", () => {
    let capturedThinking = "";
    const filter = createThinkFilter("leading-only", (chunk) => {
      capturedThinking += chunk;
    });
    const result = feedByChunks(filter, "<think>pondering the secrets of the universe</think>here is the truth", 5);
    expect(result).toBe("here is the truth");
    expect(capturedThinking).toBe("pondering the secrets of the universe");
  });
});

describe("stripThinkBlocks (non-streaming)", () => {
  test("strip closed think block", () => {
    expect(stripThinkBlocks("<think>thinking</think>answer")).toBe("answer");
  });

  test("strip unclosed think block", () => {
    expect(stripThinkBlocks("<think>unclosed")).toBe("");
  });

  test("multiple think blocks", () => {
    expect(stripThinkBlocks("a<think>x</think>b<think>y</think>c")).toBe("abc");
  });

  test("no think blocks", () => {
    expect(stripThinkBlocks("normal text")).toBe("normal text");
  });

  test("case insensitive", () => {
    expect(stripThinkBlocks("<Think>x</Think>y")).toBe("y");
  });
});

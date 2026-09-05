import { describe, expect, it } from "vitest";
import type { ModelVisibleContext, TurnUnderstanding, TurnUnderstandingInput } from "./contracts";
import { validateUnderstanding } from "./understanding-validator";

const now = 1_000;

function context(overrides: Partial<ModelVisibleContext> = {}): ModelVisibleContext {
  return {
    contextRef: "music-candidate-1",
    conversationId: "conversation-a",
    domain: "music",
    kind: "candidate",
    label: "Coward - Gigi Leung",
    position: 1,
    presented: true,
    lifecycle: "active",
    expiresAt: now + 500,
    source: "tool_result",
    ...overrides,
  };
}

function input(availableContexts = [context()]): TurnUnderstandingInput {
  return {
    conversationId: "conversation-a",
    turnId: "turn-2",
    stateRevision: 2,
    originalQuery: "the first one please",
    availableContexts,
    recentDialogue: [],
    recentEvents: [],
  };
}

function candidate(overrides: Partial<TurnUnderstanding> = {}): TurnUnderstanding {
  return {
    resolvedReferences: [{
      surface: "the first one",
      targetRef: "music-candidate-1",
      relation: "candidate_position",
    }],
    focusedEntityRefs: ["music-candidate-1"],
    contextualizedQuery: "User selects the first track 'Coward' among current candidates.",
    rewriteStatus: "rewritten",
    ...overrides,
  };
}

describe("validateUnderstanding", () => {
  it("accepts a known active reference from the same conversation", () => {
    expect(validateUnderstanding(input(), candidate(), now)).toEqual({
      status: "accepted",
      understanding: candidate(),
    });
  });

  it("removes a cross-conversation reference and falls back to the original query", () => {
    const result = validateUnderstanding(
      input([context({ conversationId: "conversation-b" })]),
      candidate(),
      now,
    );

    expect(result.status).toBe("degraded");
    if (result.status !== "degraded") throw new Error("expected degraded result");
    expect(result.understanding.resolvedReferences).toEqual([]);
    expect(result.understanding.focusedEntityRefs).toEqual([]);
    expect(result.understanding.contextualizedQuery).toBe("the first one please");
    expect(result.understanding.rewriteStatus).toBe("insufficient_context");
    expect(result.reasons).toContain("cross_conversation_ref:music-candidate-1");
  });

  it("rejects expired references", () => {
    const result = validateUnderstanding(
      input([context({ expiresAt: now, lifecycle: "active" })]),
      candidate(),
      now,
    );

    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.reasons).toContain("expired_ref:music-candidate-1");
      expect(result.understanding.contextualizedQuery).toBe("the first one please");
    }
  });

  it("rejects candidate references that were never presented to the user", () => {
    const result = validateUnderstanding(
      input([context({ presented: false })]),
      candidate(),
      now,
    );

    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.reasons).toContain("unpresented_ref:music-candidate-1");
      expect(result.understanding.contextualizedQuery).toBe("the first one please");
    }
  });

  it("removes invented references and unsupported rewritten facts", () => {
    const invented = candidate({
      resolvedReferences: [{ surface: "that track", targetRef: "invented-ref", relation: "focused" }],
      focusedEntityRefs: ["invented-ref"],
      contextualizedQuery: "Play song hallucinated by model.",
    });
    const result = validateUnderstanding(input(), invented, now);

    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.understanding.resolvedReferences).toEqual([]);
      expect(result.understanding.contextualizedQuery).toBe("the first one please");
      expect(result.reasons).toContain("unknown_ref:invented-ref");
    }
  });

  it("falls back to the original query during rewrite fallback when refs are empty", () => {
    const result = validateUnderstanding(input([]), candidate({
      resolvedReferences: [],
      focusedEntityRefs: [],
    }), now);

    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.understanding.contextualizedQuery).toBe("the first one please");
    }
  });
});

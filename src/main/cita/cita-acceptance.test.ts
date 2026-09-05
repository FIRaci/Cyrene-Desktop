import { describe, expect, it, vi } from "vitest";
import { CitaService } from "./cita-service";
import { ContextStore } from "./context-store";
import type { ModelVisibleContext, TurnUnderstanding } from "./contracts";
import type { CitaSemanticEngine } from "./semantic-engine";

const candidateContext: ModelVisibleContext = {
  contextRef: "ctx_music_first",
  conversationId: "c1",
  domain: "music",
  kind: "candidate",
  label: "Coward",
  attributes: { artists: ["Gigi Leung"], source: ["daily_recommendation"] },
  position: 1,
  presented: true,
  lifecycle: "active",
  expiresAt: 9_000,
  source: "tool_result",
};

function cognition(input: {
  query: string;
  rewriteStatus: TurnUnderstanding["rewriteStatus"];
  contextualizedQuery?: string;
  withRef?: boolean;
}): TurnUnderstanding {
  return {
    resolvedReferences: input.withRef ? [{
      surface: input.query,
      targetRef: candidateContext.contextRef,
      relation: "focused",
    }] : [],
    focusedEntityRefs: input.withRef ? [candidateContext.contextRef] : [],
    contextualizedQuery: input.contextualizedQuery ?? input.query,
    rewriteStatus: input.rewriteStatus,
  };
}

const cases = [
  {
    name: "self-contained query remains unchanged",
    query: "How is the weather in Shanghai today?",
    result: cognition({ query: "How is the weather in Shanghai today?", rewriteStatus: "unchanged" }),
  },
  {
    name: "ordinal selection uses existing ref",
    query: "the first one please",
    result: cognition({
      query: "the first one please",
      rewriteStatus: "rewritten",
      contextualizedQuery: "User selects the first track 'Coward' among current daily recommendations.",
      withRef: true,
    }),
  },
  {
    name: "ambiguous reference stays ambiguous",
    query: "just that one",
    result: cognition({ query: "just that one", rewriteStatus: "insufficient_context" }),
  },
  {
    name: "comment does not become playback",
    query: "the fourth one has a weird title",
    result: cognition({ query: "the fourth one has a weird title", rewriteStatus: "unchanged" }),
  },
  {
    name: "correction returns to prior topic",
    query: "not Left Turn Light, the one from earlier daily recommendations",
    result: cognition({
      query: "not Left Turn Light, the one from earlier daily recommendations",
      rewriteStatus: "rewritten",
      contextualizedQuery: "User corrects target to 'Coward' from earlier daily recommendations.",
      withRef: true,
    }),
  },
] as const;

describe("CITA advisory acceptance", () => {
  it.each(cases)("$name", async ({ query, result }) => {
    const store = new ContextStore({ now: () => 1_000 });
    store.append({
      type: "context_upserted", eventId: "event-1", conversationId: "c1",
      occurredAt: 1_000, source: "test", context: candidateContext,
    });
    const engine: CitaSemanticEngine = { understandTurn: vi.fn(async () => result) };
    const service = new CitaService({
      store,
      engine,
      getSettings: () => ({ enabled: true, semanticEngine: "remote" }),
      now: () => 1_000,
    });

    const prepared = await service.prepareTurn({
      conversationId: "c1", turnId: "turn-1", originalQuery: query, recentDialogue: [],
    });

    expect(prepared.contextPackage?.originalQuery).toBe(query);
    expect(prepared.contextPackage?.rewriteStatus).toBe(result.rewriteStatus);
    expect(prepared.contextBlock).toContain("[CITA_CONTEXT]");
    expect(prepared.contextBlock).not.toMatch(/\bmusic_play_track\b|\brequiredTool|\bexecute\b|netease-cloud-music|"trackId"|"setId"|"provider"|\b255667\b/);
  });

  it("makes zero semantic calls and injects no marker when disabled", async () => {
    const understandTurn = vi.fn();
    const service = new CitaService({
      store: new ContextStore(),
      engine: { understandTurn },
      getSettings: () => ({ enabled: false, semanticEngine: "remote" }),
    });

    const prepared = await service.prepareTurn({
      conversationId: "c1", turnId: "turn-1", originalQuery: "the first one please", recentDialogue: [],
    });

    expect(understandTurn).not.toHaveBeenCalled();
    expect(prepared.contextBlock).toBe("");
  });

  it("preserves the original query when semantic understanding is unavailable", async () => {
    const service = new CitaService({
      store: new ContextStore(),
      engine: { understandTurn: vi.fn(async () => { throw new Error("invalid schema"); }) },
      getSettings: () => ({ enabled: true, semanticEngine: "remote" }),
    });

    const prepared = await service.prepareTurn({
      conversationId: "c1", turnId: "turn-1", originalQuery: "just that one", recentDialogue: [],
    });

    expect(prepared.contextPackage).toMatchObject({
      originalQuery: "just that one",
      contextualizedQuery: "just that one",
      semanticStatus: "unavailable",
    });
  });
});

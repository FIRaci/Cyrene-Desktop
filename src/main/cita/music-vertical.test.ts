import { describe, expect, it, vi } from "vitest";
import { ContextRefRegistry } from "../orchestrator/context-ref-registry";
import { buildMusicTools } from "../orchestrator/tools/music-tools";
import { CitaService } from "./cita-service";
import { ContextStore } from "./context-store";
import type { CitaSemanticEngine } from "./semantic-engine";
import type { TurnUnderstanding, TurnUnderstandingInput } from "./contracts";

function serviceDouble() {
  return {
    getDailyRecommendations: vi.fn(),
    getLatestSelectionSet: vi.fn(),
    searchTracks: vi.fn(),
    presentTracks: vi.fn(async () => ({ cardRef: "internal-card" })),
    markTracksPresented: vi.fn(),
    getSelectionSet: vi.fn(),
    playTrack: vi.fn(),
    playPlaylist: vi.fn(),
  };
}

function understanding(input: TurnUnderstandingInput): TurnUnderstanding {
  const candidate = input.availableContexts.find((context) => context.kind === "candidate" && context.position === 1);
  if (input.originalQuery === "the first one please" && candidate) {
    return {
      resolvedReferences: [{ surface: "the first one", targetRef: candidate.contextRef, relation: "candidate_position" }],
      focusedEntityRefs: [candidate.contextRef],
      contextualizedQuery: `User selects the first track "${candidate.label}" among current song candidates.`,
      rewriteStatus: "rewritten",
    };
  }
  if (input.originalQuery === "the fourth one has a weird title") {
    return {
      resolvedReferences: [],
      focusedEntityRefs: [],
      contextualizedQuery: input.originalQuery,
      rewriteStatus: "unchanged",
    };
  }
  return {
    resolvedReferences: [],
    focusedEntityRefs: [],
    contextualizedQuery: input.originalQuery,
    rewriteStatus: "unchanged",
  };
}

function setup() {
  let sequence = 0;
  const refs = new ContextRefRegistry({ now: () => 1_000, createId: () => `ctx_${++sequence}` });
  const store = new ContextStore({ now: () => 1_000 });
  const engine: CitaSemanticEngine = { understandTurn: vi.fn(async (input) => understanding(input)) };
  const cita = new CitaService({
    store,
    engine,
    getSettings: () => ({ enabled: true, semanticEngine: "remote" }),
    now: () => 1_000,
  });
  const service = serviceDouble();
  const hooks = {
    contextRefs: refs,
    ingestContextEvent: (event: Parameters<CitaService["ingest"]>[0]) => cita.ingest(event),
    sendCard: vi.fn(() => true),
  };
  return { refs, store, engine, cita, service, hooks };
}

describe("CITA music vertical", () => {
  it("projects the exact displayed order and resolves the first opaque candidate", async () => {
    const env = setup();
    const set = {
      setId: "raw-set", provider: "netease-cloud-music", source: "daily_recommendation",
      createdAt: 900, expiresAt: 9_000, conversationId: "c1",
      tracks: [
        { id: "11", name: "Coward", artists: ["Gigi Leung"] },
        { id: "22", name: "Chasing Tonight", artists: ["zoolor"] },
      ],
    };
    env.service.getDailyRecommendations.mockResolvedValue(set);
    env.service.getSelectionSet.mockReturnValue(set);
    const tool = buildMusicTools(env.service as never, env.hooks)
      .find((candidate) => candidate.id === "music_get_daily_recommendations")!;

    await tool.execute({}, { userQuery: "daily recommendations", conversationId: "c1", contextRefs: env.refs });
    const candidates = env.store.snapshot("c1").contexts.filter((context) => context.kind === "candidate");
    expect(candidates.map((context) => [context.position, context.label, context.presented])).toEqual([
      [1, "Coward", true],
      [2, "Chasing Tonight", true],
    ]);

    const prepared = await env.cita.prepareTurn({
      conversationId: "c1", turnId: "turn-2", originalQuery: "the first one please", recentDialogue: [],
    });
    expect(prepared.contextPackage).toMatchObject({
      resolvedReferences: [{ targetRef: candidates[0].contextRef }],
      semanticStatus: "ready",
    });
    expect(prepared.contextBlock).not.toContain("music_play_track");
    expect(prepared.contextBlock).not.toContain("trackId");
  });

  it("keeps comments and affirmations as cognition rather than execution directives", async () => {
    const env = setup();
    const comment = await env.cita.prepareTurn({
      conversationId: "c1", turnId: "turn-comment", originalQuery: "the fourth one has a weird title", recentDialogue: [],
    });
    expect(comment.contextBlock).not.toContain("toolName");

    const withoutQuestion = await env.cita.prepareTurn({
      conversationId: "c1", turnId: "turn-no-question", originalQuery: "sure", recentDialogue: [],
    });

    env.cita.ingest({
      type: "context_upserted", eventId: "awaiting-1", conversationId: "c1", occurredAt: 1_000, source: "test",
      context: {
        contextRef: "ctx_awaiting", conversationId: "c1", domain: "dialogue", kind: "awaiting_question",
        label: "whether to play current track", lifecycle: "active", source: "runtime_event",
      },
    });
    const withQuestion = await env.cita.prepareTurn({
      conversationId: "c1", turnId: "turn-question", originalQuery: "sure", recentDialogue: [],
    });
    expect(env.service.playTrack).not.toHaveBeenCalled();
  });

  it("keeps daily and search candidate sources distinguishable", async () => {
    const env = setup();
    const daily = {
      setId: "daily", provider: "netease-cloud-music", source: "daily_recommendation",
      createdAt: 900, expiresAt: 9_000, conversationId: "c1",
      tracks: [{ id: "11", name: "Daily Song", artists: ["A"] }],
    };
    const search = {
      ...daily, setId: "search", source: "search", query: "Left Turn Light",
      tracks: [{ id: "22", name: "Left Turn Light", artists: ["Patrick Brasca"] }],
    };
    env.service.getDailyRecommendations.mockResolvedValue(daily);
    env.service.searchTracks.mockResolvedValue(search);
    env.service.getSelectionSet.mockImplementation((setId: string) => setId === "daily" ? daily : search);
    const tools = buildMusicTools(env.service as never, env.hooks);

    await tools.find((tool) => tool.id === "music_get_daily_recommendations")!
      .execute({}, { userQuery: "daily recommendations", conversationId: "c1", contextRefs: env.refs });
    await tools.find((tool) => tool.id === "music_search")!
      .execute({ keyword: "Left Turn Light", purpose: "discover" }, { userQuery: "search Left Turn Light", conversationId: "c1", contextRefs: env.refs });

    const sources = env.store.snapshot("c1").contexts
      .filter((context) => context.kind === "candidate")
      .map((context) => context.attributes?.source?.[0]);
    expect(sources).toEqual(["daily_recommendation", "search"]);
  });
});

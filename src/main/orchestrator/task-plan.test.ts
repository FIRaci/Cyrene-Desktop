import { describe, expect, it } from "vitest";
import {
  verifyStep,
  computeMaxIterations,
  findNextPendingStep,
  isPlanComplete,
  applyReplan,
  generateStepId,
  type TaskPlan,
  type PlanStep,
  type StepCompletionPolicy,
} from "./task-plan";
import type { ToolCallResult } from "./types";
import type { ToolDefinition } from "./tool-registry";

// ── Test helpers ──────────────────────────────

function makeStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: generateStepId(),
    objective: "Test step",
    status: "running",
    completionPolicy: {},
    toolCallCount: 0,
    retryCount: 0,
    executionId: "exec_test_1",
    ...overrides,
  };
}

function makePlan(steps: PlanStep[]): TaskPlan {
  return {
    id: "plan_test",
    conversationId: "c1",
    goal: "Test goal",
    steps,
    status: "running",
    skillIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function succeededResult(
  toolId: string,
  capabilityId: string,
  stepExecutionId = "exec_test_1",
): ToolCallResult {
  return {
    toolId,
    args: {},
    output: '{"kind":"search","context":{"candidates":[]}}',
    status: "succeeded",
    terminal: true,
    capabilityId,
    stepExecutionId,
  };
}

function failedResult(
  toolId: string,
  capabilityId: string,
  stepExecutionId = "exec_test_1",
): ToolCallResult {
  return {
    toolId,
    args: {},
    output: "error",
    status: "failed",
    terminal: true,
    errorCode: "E_FAIL",
    capabilityId,
    stepExecutionId,
  };
}

function playbackDispatchedResult(stepExecutionId = "exec_test_1"): ToolCallResult {
  return {
    toolId: "music_play_track",
    args: {},
    output: '{"kind":"playback","dispatch":{"state":"dispatched","resourceType":"song","resourceId":"123"}}',
    status: "succeeded",
    terminal: true,
    capabilityId: "music.play_track",
    stepExecutionId,
  };
}

const musicTools: ToolDefinition[] = [
  {
    id: "music_search",
    capability: "music.search",
    name: "Search",
    description: "Search songs",
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "",
    soulProjection: {
      projector: "entity_list",
      source: "trusted_internal",
      itemsPath: "context.candidates",
      fields: { title: "name", artists: "artists" },
    },
  },
  {
    id: "music_play_track",
    capability: "music.play_track",
    name: "Play",
    description: "Play song",
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "",
    soulProjection: {
      projector: "action_dispatch",
      source: "trusted_internal",
      statePath: "dispatch.state",
      stateClaims: {
        dispatched: { kind: "request_dispatched" },
        web_fallback: { kind: "browser_opened" },
      },
    },
  },
];

// ── verifyStep tests ───────────────────────

describe("verifyStep", () => {
  it("returns completed when allOf tool_succeeded is met", () => {
    const step = makeStep({
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
      },
    });
    const results = [succeededResult("music_search", "music.search")];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "completed" });
  });

  it("returns running when allOf not yet met", () => {
    const step = makeStep({
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
      },
    });
    expect(verifyStep(step, [], musicTools)).toEqual({ status: "running" });
  });

  it("returns completed when anyOf group has one match (dispatched OR web_fallback)", () => {
    const step = makeStep({
      completionPolicy: {
        anyOf: [[
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "request_dispatched" },
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "browser_opened" },
        ]],
      },
    });
    const results = [playbackDispatchedResult()];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "completed" });
  });

  it("returns running when anyOf group has no match", () => {
    const step = makeStep({
      completionPolicy: {
        anyOf: [[
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "request_dispatched" },
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "browser_opened" },
        ]],
      },
    });
    const results = [succeededResult("music_search", "music.search")];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "running" });
  });

  it("returns completed when allOf AND anyOf both satisfied", () => {
    const step = makeStep({
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
        anyOf: [[
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "request_dispatched" },
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "browser_opened" },
        ]],
      },
    });
    const results = [
      succeededResult("music_search", "music.search"),
      playbackDispatchedResult(),
    ];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "completed" });
  });

  it("returns running when allOf met but anyOf not met", () => {
    const step = makeStep({
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
        anyOf: [[
          { kind: "projection_claim", capabilityId: "music.play_track", claimKind: "request_dispatched" },
        ]],
      },
    });
    const results = [succeededResult("music_search", "music.search")];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "running" });
  });

  it("returns failed when non-retryable failure exists", () => {
    const step = makeStep({
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
      },
    });
    const results = [failedResult("music_search", "music.search")];
    const result = verifyStep(step, results, musicTools);
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("E_FAIL");
  });

  it("returns completed with no completionPolicy when tool succeeded terminal", () => {
    const step = makeStep({ completionPolicy: {} });
    const results = [succeededResult("music_search", "music.search")];
    expect(verifyStep(step, results, musicTools)).toEqual({ status: "completed" });
  });

  it("only checks results provided by caller (filtering is caller's responsibility)", () => {
    const step = makeStep({
      executionId: "exec_current",
      completionPolicy: {
        allOf: [{ kind: "tool_succeeded", capabilityId: "music.search" }],
      },
    });
    // Caller filtered out results from previous steps -> empty list -> running
    expect(verifyStep(step, [], musicTools)).toEqual({ status: "running" });

    // Caller passed results from current step -> completed
    const currentResults = [succeededResult("music_search", "music.search", "exec_current")];
    expect(verifyStep(step, currentResults, musicTools)).toEqual({ status: "completed" });
  });
});

// ── computeMaxIterations tests ─────────────

describe("computeMaxIterations", () => {
  it("returns base iterations when no plan", () => {
    expect(computeMaxIterations(undefined)).toBe(12);
  });

  it("increases with plan steps", () => {
    const plan = makePlan([
      makeStep({ status: "pending" }),
      makeStep({ status: "pending" }),
      makeStep({ status: "pending" }),
      makeStep({ status: "pending" }),
    ]);
    const result = computeMaxIterations(plan);
    expect(result).toBe(12 + 4 * 3); // 24
  });

  it("caps at hard max", () => {
    const plan = makePlan(
      Array.from({ length: 20 }, () => makeStep({ status: "pending" })),
    );
    expect(computeMaxIterations(plan)).toBe(30); // HARD_MAX_ITERATIONS
  });
});

// ── findNextPendingStep tests ──────────────

describe("findNextPendingStep", () => {
  it("finds first pending step", () => {
    const plan = makePlan([
      makeStep({ id: "s1", status: "completed" }),
      makeStep({ id: "s2", status: "pending" }),
      makeStep({ id: "s3", status: "pending" }),
    ]);
    expect(findNextPendingStep(plan)?.id).toBe("s2");
  });

  it("finds pending step after specified step", () => {
    const plan = makePlan([
      makeStep({ id: "s1", status: "completed" }),
      makeStep({ id: "s2", status: "completed" }),
      makeStep({ id: "s3", status: "pending" }),
    ]);
    expect(findNextPendingStep(plan, "s2")?.id).toBe("s3");
  });

  it("returns undefined when no pending steps", () => {
    const plan = makePlan([
      makeStep({ id: "s1", status: "completed" }),
    ]);
    expect(findNextPendingStep(plan)).toBeUndefined();
  });
});

// ── isPlanComplete tests ───────────────────

describe("isPlanComplete", () => {
  it("returns true when all steps completed", () => {
    const plan = makePlan([
      makeStep({ status: "completed" }),
      makeStep({ status: "completed" }),
    ]);
    expect(isPlanComplete(plan)).toBe(true);
  });

  it("returns true when steps are completed or skipped", () => {
    const plan = makePlan([
      makeStep({ status: "completed" }),
      makeStep({ status: "skipped" }),
    ]);
    expect(isPlanComplete(plan)).toBe(true);
  });

  it("returns false when a step is still running", () => {
    const plan = makePlan([
      makeStep({ status: "completed" }),
      makeStep({ status: "running" }),
    ]);
    expect(isPlanComplete(plan)).toBe(false);
  });

  it("returns true when failed steps are superseded", () => {
    const plan = makePlan([
      makeStep({ status: "completed" }),
      makeStep({ status: "superseded" }),
      makeStep({ status: "completed" }),
    ]);
    expect(isPlanComplete(plan)).toBe(true);
  });
});

// ── applyReplan tests ──────────────────────

describe("applyReplan", () => {
  it("marks failed step as superseded and inserts replacements", () => {
    const s1 = makeStep({ id: "s1", status: "completed" });
    const s2 = makeStep({ id: "s2", status: "failed", failure: { message: "Creation failed", failedAt: Date.now() } });
    const s3 = makeStep({ id: "s3", status: "pending" });
    const s4 = makeStep({ id: "s4", status: "pending" });
    const plan = makePlan([s1, s2, s3, s4]);

    const r1 = makeStep({ id: "r1", status: "pending", objective: "Replacement step 1" });
    const r2 = makeStep({ id: "r2", status: "pending", objective: "Replacement step 2" });

    applyReplan(plan, s2, [r1, r2]);

    // s2 should be marked as superseded
    expect(s2.status).toBe("superseded");
    expect(s2.supersededBy).toEqual(["r1", "r2"]);

    // s3, s4 should also be marked as superseded (after failed)
    expect(s3.status).toBe("superseded");
    expect(s4.status).toBe("superseded");

    // s1 should not be modified
    expect(s1.status).toBe("completed");

    // Replacement steps should be inserted after s2
    const stepIds = plan.steps.map((s) => s.id);
    expect(stepIds).toEqual(["s1", "s2", "r1", "r2", "s3", "s4"]);
  });

  it("preserves failure info on superseded step", () => {
    const s1 = makeStep({ id: "s1", status: "failed", failure: { message: "Test failure", failedAt: 12345 } });
    const plan = makePlan([s1]);

    const r1 = makeStep({ id: "r1", status: "pending" });
    applyReplan(plan, s1, [r1]);

    expect(s1.status).toBe("superseded");
    expect(s1.failure?.message).toBe("Test failure");
    expect(s1.failure?.failedAt).toBe(12345);
  });
});

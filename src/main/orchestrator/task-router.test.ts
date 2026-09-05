import { describe, expect, it, vi } from "vitest";
import {
  matchSkillByName,
  runTaskRouter,
  buildRouterCapabilities,
  ENABLE_TASK_ROUTER,
  type TaskRoute,
  type SkillRouteInfo,
  type RunTaskRouterInput,
} from "./task-router";
import { resolveStructuredOutputProfile } from "./structured-output/profiles";
import type { ToolDefinition } from "./tool-registry";
import type { ChatResponse } from "./vendors/types";

// -- Test helpers --

const skills: SkillRouteInfo[] = [
  { id: "xlsx", description: "Excel document generation" },
  { id: "cyrene-music-companion", description: "Music search and playback", defaultExecutionMode: "direct" },
  { id: "docx", description: "Word document generation", defaultExecutionMode: "plan" },
];

const profile = resolveStructuredOutputProfile({
  provider: "chatgpt",
  model: "gpt-5.2",
  transport: "openai",
  endpointKind: "official",
});

function response(value: unknown): ChatResponse {
  const text = JSON.stringify(value);
  return {
    assistantMessage: { role: "assistant", content: text },
    text,
    toolCalls: [],
    finishReason: "stop",
    raw: {},
  };
}

function makeInput(overrides: Partial<RunTaskRouterInput> = {}): RunTaskRouterInput {
  return {
    model: "gpt-5.2",
    originalQuery: "check Hangzhou weather",
    contextualizedQuery: "check current Hangzhou weather",
    messages: [{ role: "user", content: "check Hangzhou weather" }],
    availableSkills: skills,
    availableCapabilities: [
      { capabilityId: "weather.lookup", description: "check weather", hasCompletionEvidence: false },
      { capabilityId: "music.search", description: "search songs", hasCompletionEvidence: true },
    ],
    profile,
    generate: async () => response({ executionMode: "direct", skillIds: [], reason: "single query" }),
    ...overrides,
  };
}

// -- matchSkillByName tests --

describe("matchSkillByName", () => {
  it("matches 'use xlsx skill'", () => {
    expect(matchSkillByName("use xlsx skill to generate report", skills)).toBe("xlsx");
  });

  it("matches 'call docx skill'", () => {
    expect(matchSkillByName("call docx skill", skills)).toBe("docx");
  });

  it("matches 'cyrene-music-companion skill'", () => {
    expect(matchSkillByName("use cyrene-music-companion skill", skills)).toBe("cyrene-music-companion");
  });

  it("does not match natural language mentioning Excel", () => {
    expect(matchSkillByName("help me make an Excel report", skills)).toBeUndefined();
  });

  it("does not match unrelated text", () => {
    expect(matchSkillByName("check Hangzhou weather", skills)).toBeUndefined();
  });
});

// -- buildRouterCapabilities tests --

describe("buildRouterCapabilities", () => {
  it("builds capability list with completionEvidence flag", () => {
    const tools: ToolDefinition[] = [
      {
        id: "music_search",
        capability: "music.search",
        name: "Search",
        description: "Search songs",
        enabled: true,
        inputSchema: { type: "object", properties: {} },
        execute: async () => "",
        completionEvidence: [{ kind: "tool_succeeded" }],
      },
      {
        id: "weather",
        capability: "weather.lookup",
        name: "Weather",
        description: "Check weather",
        enabled: true,
        inputSchema: { type: "object", properties: {} },
        execute: async () => "",
      },
    ];
    const caps = buildRouterCapabilities(tools);
    expect(caps).toHaveLength(2);
    expect(caps[0].hasCompletionEvidence).toBe(true);
    expect(caps[1].hasCompletionEvidence).toBe(false);
  });

  it("filters out disabled tools", () => {
    const tools: ToolDefinition[] = [
      { id: "t1", name: "t1", description: "t1", enabled: true, inputSchema: { type: "object", properties: {} }, execute: async () => "" },
      { id: "t2", name: "t2", description: "t2", enabled: false, inputSchema: { type: "object", properties: {} }, execute: async () => "" },
    ];
    expect(buildRouterCapabilities(tools)).toHaveLength(1);
  });
});

// -- runTaskRouter tests --

describe("runTaskRouter", () => {
  it("has feature flag enabled", () => {
    expect(ENABLE_TASK_ROUTER).toBe(true);
  });

  it("uses shortcut path with defaultExecutionMode from metadata", async () => {
    // cyrene-music-companion has defaultExecutionMode: "direct"
    const result = await runTaskRouter(makeInput({
      originalQuery: "use cyrene-music-companion skill to play music",
    }));
    expect(result.executionMode).toBe("direct");
    expect(result.skillIds).toContain("cyrene-music-companion");
    expect(result.reason).toContain("metadata");
  });

  it("uses shortcut path with plan mode from metadata", async () => {
    // docx has defaultExecutionMode: "plan"
    const result = await runTaskRouter(makeInput({
      originalQuery: "use docx skill to generate document",
    }));
    expect(result.executionMode).toBe("plan");
    expect(result.skillIds).toContain("docx");
  });

  it("calls Router LLM when skill matched but no defaultExecutionMode", async () => {
    // xlsx has no defaultExecutionMode
    const generate = vi.fn(async () => response({
      executionMode: "plan",
      skillIds: [],
      reason: "multi-step document generation",
    }));
    const result = await runTaskRouter(makeInput({
      originalQuery: "use xlsx skill to generate report",
      generate,
    }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.executionMode).toBe("plan");
    // preselectedSkillIds should be merged in
    expect(result.skillIds).toContain("xlsx");
  });

  it("calls Router LLM when no skill match", async () => {
    const generate = vi.fn(async () => response({
      executionMode: "direct",
      skillIds: [],
      reason: "single query",
    }));
    const result = await runTaskRouter(makeInput({
      originalQuery: "check Hangzhou weather",
      generate,
    }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.executionMode).toBe("direct");
  });

  it("filters out invalid skillIds from LLM output", async () => {
    const generate = vi.fn(async () => response({
      executionMode: "direct",
      skillIds: ["xlsx", "nonexistent_skill"],
      reason: "test",
    }));
    const result = await runTaskRouter(makeInput({
      originalQuery: "check weather",
      generate,
    }));
    expect(result.skillIds).toContain("xlsx");
    expect(result.skillIds).not.toContain("nonexistent_skill");
  });

  it("falls back to direct on Router LLM failure", async () => {
    const generate = vi.fn(async () => {
      throw new Error("network error");
    });
    const result = await runTaskRouter(makeInput({
      originalQuery: "check weather",
      generate,
    }));
    expect(result.executionMode).toBe("direct");
    expect(result.reason).toContain("fallback");
  });

  it("falls back to direct on invalid LLM output", async () => {
    const generate = vi.fn(async () => response("not an object"));
    const result = await runTaskRouter(makeInput({
      originalQuery: "check weather",
      generate,
    }));
    expect(result.executionMode).toBe("direct");
    expect(result.reason).toContain("fallback");
  });
});

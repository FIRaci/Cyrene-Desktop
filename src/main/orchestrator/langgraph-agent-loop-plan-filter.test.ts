/**
 * hideInPlanMode tool filtering tests in Plan mode.
 *
 * Separate file: requires ENABLE_TASK_ROUTER=true, whereas main test file fixes it to false.
 * Test scenarios:
 *   1. delegate_task hidden after Plan creation fails and degrades (Action Gate + Native FC)
 *   2. Next round normal direct request restores delegate_task visibility
 *   3. Tool filtering uses local array without mutating shared enabledTools in-place
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Router enabled
vi.mock("./task-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-router")>();
  return { ...actual, ENABLE_TASK_ROUTER: true };
});

import { runLangGraphAgentLoop } from "./langgraph-agent-loop";
import { contextRefRegistry } from "./tool-context";
import type { ToolDefinition } from "./tool-registry";
import type {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter, HttpRequest,
  ProviderCapability, ToolCall, ToolExecutionResult,
} from "./vendors/types";

const capability: ProviderCapability = {
  id: "test", displayName: "test", transport: "openai", baseUrl: "https://test/",
  authStyle: "bearer", defaultModel: "m", supportsTools: true, supportsThinking: false,
  thinkingField: null, cacheStrategy: "none", testStrategy: "text", supportsVision: false,
};

class FakeAdapter implements ChatVendorAdapter {
  readonly id = "chatgpt";
  readonly transport = "openai" as const;
  capability = capability;
  readonly requests: ChatRequest[] = [];
  private scripts: Array<{ text: string; toolCalls?: never } | { text?: never; toolCalls: ToolCall[] }> = [];
  private index = 0;

  enqueueText(text: string) { this.scripts.push({ text }); }
  enqueueJson(value: unknown) { this.enqueueText(JSON.stringify(value)); }
  enqueueToolCall(name: string, args: Record<string, unknown>, id = `call-${this.scripts.length + 1}`) {
    this.scripts.push({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
  }
  buildRequest(req: ChatRequest): HttpRequest {
    this.requests.push(req);
    return { url: "https://fake/", method: "POST", headers: {}, body: "{}" };
  }
  parseResponse(): ChatResponse {
    const script = this.scripts[this.index++];
    if (script === undefined) throw new Error("missing fake response");
    const text = script.text ?? "";
    const toolCalls = script.toolCalls ?? [];
    return {
      assistantMessage: { role: "assistant", content: text, ...(toolCalls.length ? { toolCalls } : {}) },
      text, toolCalls, finishReason: toolCalls.length ? "tool_calls" : "stop", raw: {},
    };
  }
  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    return [...messages, ...results.map((result): ChatMessage => ({
      role: "tool", name: result.toolCall.name, toolCallId: result.toolCall.id, content: result.output,
    }))];
  }
  buildStreamRequest(req: ChatRequest) { return this.buildRequest(req); }
  parseStreamEvent(): null { return null; }
  async testConnection() { return { ok: true, latency: 0 }; }
}

// -- Tool definitions --

function delegateTaskTool(): ToolDefinition {
  return {
    id: "delegate_task", capability: "delegate_task", name: "Delegate subtask",
    description: "Delegate subtask to subagent", enabled: true,
    inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
    hideInPlanMode: true,
    execute: async () => "unused",
  };
}

function webSearchTool(): ToolDefinition {
  return {
    id: "web_search", capability: "web.search", name: "Search",
    description: "Search web", enabled: true,
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    execute: async () => "unused",
  };
}

function writeWordTool(): ToolDefinition {
  return {
    id: "write_word", capability: "write_word", name: "Write Word",
    description: "Generate Word document", enabled: true,
    inputSchema: {
      type: "object",
      properties: { filename: { type: "string" }, title: { type: "string" }, paragraphs: { type: "array" } },
      required: ["filename", "title", "paragraphs"],
    },
    execute: async () => "unused",
  };
}

const allTools = [delegateTaskTool(), webSearchTool(), writeWordTool()];

// -- Test helpers --

function defaultOptions(adapter: FakeAdapter, tools = allTools) {
  return {
    settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
    adapter,
    messages: [{ role: "user" as const, content: "Search AI news" }],
    tools,
    toolSystemContent: "TOOL_SYSTEM",
    soulSystemBaseContent: "SOUL_SYSTEM",
    originalQuery: "Search AI news",
    contextualizedQuery: "Search AI news",
    citaContextBlock: "",
    trustedRefs: [],
    timeoutMs: 30_000,
    executeTool: vi.fn(async () => ({
      status: "succeeded" as const,
      output: JSON.stringify({ ok: true }),
    })),
  };
}

/** Extract Action Gate availableCapabilities from adapter request */
function extractCapabilities(adapter: FakeAdapter): string[] {
  for (const req of adapter.requests) {
    const lastMsg = req.messages.at(-1);
    if (!lastMsg || typeof lastMsg.content !== "string") continue;
    try {
      const parsed = JSON.parse(lastMsg.content);
      if (parsed?.machineInput?.availableCapabilities) {
        return parsed.machineInput.availableCapabilities.map(
          (c: { capability: string }) => c.capability,
        );
      }
    } catch { /* not JSON, skip */ }
  }
  return [];
}

/** Extract Native FC tools list from adapter request */
function extractNativeFcTools(adapter: FakeAdapter): string[] {
  // Native FC request: request whose messages contain tools field
  for (const req of adapter.requests) {
    if (req.tools && req.tools.length > 0) {
      return req.tools.map((t) => t.name);
    }
  }
  return [];
}

beforeEach(() => {
  process.env.CYRENE_LEGACY_STRUCTURED_OUTPUT = "1";
  vi.spyOn(contextRefRegistry, "resolve").mockImplementation((() => ({})) as never);
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => {
  delete process.env.CYRENE_LEGACY_STRUCTURED_OUTPUT;
  vi.restoreAllMocks();
});

// -- Tests --

describe("Plan mode delegate_task filter", () => {
  it("after Plan creation fails and degrades: delegate_task is hidden from Action Gate capabilities", async () => {
    const adapter = new FakeAdapter();
    // Router returns plan
    adapter.enqueueJson({ executionMode: "plan", skillIds: [], reason: "multi-step task" });
    // createPlan first failure (HTTP 529)
    adapter.enqueueText("ERROR_SIMULATE_529");
    // createPlan second failure (retry also fails) -> fallback to direct
    adapter.enqueueText("ERROR_SIMULATE_529");
    // Action Gate decision after fallback -> respond
    adapter.enqueueJson({ decision: "respond", reason: "done" });
    // Soul reply
    adapter.enqueueText("Search completed.");

    // fetch call sequence:
    // 1. Router LLM (should succeed, returns 200, consumes enqueueJson)
    // 2. createPlan first LLM (529)
    // 3. createPlan second LLM (529, retry)
    // 4. Action Gate LLM (should succeed, returns 200, consumes enqueueJson)
    // 5. Soul LLM (should succeed, returns 200, consumes enqueueText)
    let fetchCallCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCallCount++;
      if (fetchCallCount === 2 || fetchCallCount === 3) {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), {
          status: 529,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await runLangGraphAgentLoop(defaultOptions(adapter));

    // Extract capabilities from Action Gate request
    const caps = extractCapabilities(adapter);
    // delegate_task should not be in capabilities
    expect(caps).not.toContain("delegate_task");
    // but web_search and write_word should be
    expect(caps).toContain("web.search");
    expect(caps).toContain("write_word");
  });

  it("after Plan creation fails and degrades: delegate_task is hidden from Native FC tools", async () => {
    const adapter = new FakeAdapter();
    // Router returns plan
    adapter.enqueueJson({ executionMode: "plan", skillIds: [], reason: "multi-step task" });
    // createPlan fails twice
    adapter.enqueueText("FAIL_1");
    adapter.enqueueText("FAIL_2");
    // Action Gate decision after fallback -> act (triggers Native FC)
    adapter.enqueueJson({
      decision: "act", capability: "web.search", objective: "search",
      targetRefs: [], afterSuccess: "respond",
    });
    // Native FC generates tool call
    adapter.enqueueToolCall("web_search", { query: "AI news" });
    // Soul reply
    adapter.enqueueText("Search completed.");

    // fetch call sequence:
    // 1. Router LLM (200)
    // 2. createPlan first (529)
    // 3. createPlan second (529)
    // 4. Action Gate LLM (200)
    // 5. Native FC LLM (200)
    // 6. Soul LLM (200)
    let fetchCallCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCallCount++;
      if (fetchCallCount === 2 || fetchCallCount === 3) {
        return new Response("overloaded", { status: 529 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await runLangGraphAgentLoop(defaultOptions(adapter));

    // Extract tools from Native FC request
    const nativeTools = extractNativeFcTools(adapter);
    // delegate_task should not be in Native FC tools
    expect(nativeTools).not.toContain("delegate_task");
    // web_search should be
    expect(nativeTools).toContain("web_search");
  });

  it("normal direct request: delegate_task visible (restoration test)", async () => {
    const adapter = new FakeAdapter();
    // Router returns direct
    adapter.enqueueJson({ executionMode: "direct", skillIds: [], reason: "simple query" });
    // Action Gate decision -> respond
    adapter.enqueueJson({ decision: "respond", reason: "done" });
    // Soul reply
    adapter.enqueueText("Weather is nice today.");

    await runLangGraphAgentLoop({
      ...defaultOptions(adapter),
      originalQuery: "Check weather",
      contextualizedQuery: "Check weather",
      messages: [{ role: "user", content: "Check weather" }],
    });

    const caps = extractCapabilities(adapter);
    // delegate_task should be in capabilities (not hidden in direct mode)
    expect(caps).toContain("delegate_task");
    expect(caps).toContain("web.search");
    expect(caps).toContain("write_word");
  });

  it("second round direct after Plan degrades: delegate_task restored visible (no cross-turn pollution)", async () => {
    // -- Round 1: Plan fails and degrades --
    const adapter1 = new FakeAdapter();
    adapter1.enqueueJson({ executionMode: "plan", skillIds: [], reason: "multi-step" });
    adapter1.enqueueText("FAIL");
    adapter1.enqueueText("FAIL");
    adapter1.enqueueJson({ decision: "respond", reason: "done" });
    adapter1.enqueueText("Degrade completed.");

    let fetchCount1 = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount1++;
      // Router(1) success, createPlan(2,3) failure, Action Gate(4) success, Soul(5) success
      if (fetchCount1 === 2 || fetchCount1 === 3) return new Response("overloaded", { status: 529 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await runLangGraphAgentLoop(defaultOptions(adapter1));

    // Round 1: delegate_task should be hidden
    const caps1 = extractCapabilities(adapter1);
    expect(caps1).not.toContain("delegate_task");

    // -- Round 2: Normal direct --
    const adapter2 = new FakeAdapter();
    adapter2.enqueueJson({ executionMode: "direct", skillIds: [], reason: "simple" });
    adapter2.enqueueJson({ decision: "respond", reason: "done" });
    adapter2.enqueueText("Round 2 completed.");

    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await runLangGraphAgentLoop({
      ...defaultOptions(adapter2),
      originalQuery: "Check weather",
      contextualizedQuery: "Check weather",
      messages: [{ role: "user", content: "Check weather" }],
    });

    // Round 2: delegate_task should be restored visible
    const caps2 = extractCapabilities(adapter2);
    expect(caps2).toContain("delegate_task");
  });

  it("tool filtering does not mutate shared enabledTools array in-place", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueJson({ executionMode: "plan", skillIds: [], reason: "multi-step" });
    adapter.enqueueText("FAIL");
    adapter.enqueueText("FAIL");
    adapter.enqueueJson({ decision: "respond", reason: "done" });
    adapter.enqueueText("Completed.");

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      // Router(1) success, createPlan(2,3) failure, Action Gate(4) success, Soul(5) success
      if (fetchCount === 2 || fetchCount === 3) return new Response("overloaded", { status: 529 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    // Pass reference to tool array
    const toolsCopy = [...allTools];
    await runLangGraphAgentLoop({
      ...defaultOptions(adapter),
      tools: toolsCopy,
    });

    // Original array should not be modified (filter creates new array, does not mutate original)
    // Check that hideInPlanMode property on each tool object in toolsCopy is neither deleted nor modified
    expect(toolsCopy.find((t) => t.id === "delegate_task")?.hideInPlanMode).toBe(true);
    // Array length unchanged
    expect(toolsCopy).toHaveLength(3);
  });
});

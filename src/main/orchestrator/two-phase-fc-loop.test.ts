import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "./tool-registry";
import type { ToolCallResult } from "./types";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatVendorAdapter,
  HttpRequest,
  ProviderCapability,
  ToolCall,
  ToolExecutionResult,
} from "./vendors/types";
import { runTwoPhaseFcLoop } from "./two-phase-fc-loop";

const TEST_CAPABILITY: ProviderCapability = {
  id: "test",
  displayName: "test",
  transport: "openai",
  baseUrl: "https://test/",
  authStyle: "bearer",
  defaultModel: "m",
  supportsTools: true,
  supportsThinking: false,
  thinkingField: null,
  cacheStrategy: "none",
  testStrategy: "text",
  supportsVision: false,
};

/**
 * Minimal fake adapter that returns responses according to sequence scripts.
 */
class FakeAdapter implements ChatVendorAdapter {
  readonly id = "fake";
  readonly transport = "openai" as const;
  capability: ProviderCapability = TEST_CAPABILITY;

  /** Script queue for fake responses. */
  private scripts: Array<
    | { kind: "text"; text: string }
    | { kind: "tool"; toolCalls: ToolCall[] }
    | { kind: "error"; message: string }
  > = [];
  private callIndex = 0;
  /** Records all sent request bodies for assertions. */
  readonly requests: ChatRequest[] = [];

  enqueueText(text: string) {
    this.scripts.push({ kind: "text", text });
  }
  enqueueToolCalls(toolCalls: ToolCall[]) {
    this.scripts.push({ kind: "tool", toolCalls });
  }
  enqueueError(message: string) {
    this.scripts.push({ kind: "error", message });
  }

  buildRequest(req: ChatRequest): HttpRequest {
    this.requests.push(req);
    return {
      url: "https://fake/",
      method: "POST",
      headers: {},
      body: JSON.stringify({}),
    };
  }
  parseResponse(raw: unknown): ChatResponse {
    const script = this.scripts[this.callIndex++];
    if (!script) throw new Error("FakeAdapter: no script enqueued for call " + this.callIndex);
    if (script.kind === "error") throw new Error(script.message);

    const text = script.kind === "text" ? script.text : "";
    const toolCalls = script.kind === "tool" ? script.toolCalls : [];

    return {
      assistantMessage: {
        role: "assistant",
        ...(text ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      raw: {},
    };
  }
  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    const next = messages.slice();
    for (const r of results) {
      next.push({
        role: "tool",
        toolCallId: r.toolCall.id,
        name: r.toolCall.name,
        content: r.output,
      });
    }
    return next;
  }
  buildStreamRequest(req: ChatRequest): HttpRequest {
    return this.buildRequest({ ...req, stream: true });
  }
  parseStreamEvent(): null {
    return null;
  }
  async testConnection() {
    return { ok: true, latency: 0 };
  }
}

function makeTool(id: string, enabled = true): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    enabled,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "ok",
  };
}

const baseMessages: ChatMessage[] = [
  { role: "user", content: "Hello" },
];

const baseOptions = {
  messages: baseMessages,
  tools: [makeTool("weather")],
  toolSystemContent: "TOOL_SYSTEM",
  soulSystemBaseContent: "SOUL_SYSTEM_BASE",
  timeoutMs: 30_000,
};

beforeEach(() => {
  // Default fetch stub
  // Fake adapter does not send real requests
  globalThis.fetch = vi.fn(async () => {
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTwoPhaseFcLoop", () => {
  it("executes only model-authored tool calls", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "call-1", name: "music_search", arguments: JSON.stringify({ keyword: "Left turn signal" }) }]);
    adapter.enqueueText("Tool phase ended");
    adapter.enqueueText("Found real result");
    const executed: ToolCall[] = [];

    await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_search")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async (toolCall) => {
        executed.push(toolCall);
        return JSON.stringify({ kind: "search", set: { tracks: [{ id: "1", name: "Left turn signal" }] } });
      },
    });

    expect(JSON.parse(executed[0].arguments)).toEqual({ keyword: "Left turn signal" });
    expect(adapter.requests[0].messages.some((message) => message.role === "tool")).toBe(false);
    expect(adapter.requests[1].messages.some((message) => message.role === "tool")).toBe(true);
    expect(adapter.requests[0].toolChoiceIntent).toBeUndefined();
  });

  it("never forces a tool choice before the model decides", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("Model still did not call tool");
    adapter.enqueueText("Final reply");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
    });

    expect(adapter.requests[0].toolChoiceIntent).toBeUndefined();
    expect(adapter.requests[1].toolChoiceIntent).toBeUndefined();
  });

  it("model without tool_calls switches to SOUL_PHASE, tool phase free text not written to conversation", async () => {
    const adapter = new FakeAdapter();
    // TOOL_PHASE: model generates free text (should not enter soul conversation)
    adapter.enqueueText("UNSEEN_TOOL_TEXT");
    // SOUL_PHASE: model returns final reply
    adapter.enqueueText("Final user-facing reply");

    const executeToolCalls: ToolCall[] = [];
    const events: string[] = [];

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async (tc) => {
        executeToolCalls.push(tc);
        return "tool output";
      },
      onEvent: (e) => events.push(e.type),
    });

    expect(result.reply).toBe("Final user-facing reply");
    expect(result.soulPhaseReason).toBe("no_tool");
    expect(executeToolCalls).toHaveLength(0);

    // First request uses tool_system, second uses soul_systemBase
    expect(adapter.requests).toHaveLength(2);
    const toolReq = adapter.requests[0];
    const soulReq = adapter.requests[1];

    // tool phase system
    expect(toolReq.messages[0].role).toBe("system");
    expect(toolReq.messages[0].content).toBe("TOOL_SYSTEM");
    expect(toolReq.tools).toBeDefined();
    expect(toolReq.tools!.length).toBeGreaterThan(0);

    // soul phase system
    expect(soulReq.messages[0].role).toBe("system");
    expect(String(soulReq.messages[0].content)).toContain("SOUL_SYSTEM_BASE");
    expect(String(soulReq.messages[0].content)).toContain('"actions":[]');
    // soul phase omits tools
    expect(soulReq.tools).toBeUndefined();

    // Key: tool phase UNSEEN_TOOL_TEXT does not enter soul conversation
    // All messages in soul request must not contain UNSEEN_TOOL_TEXT
    const allSoulContent = soulReq.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(allSoulContent).not.toContain("UNSEEN_TOOL_TEXT");
  });

  it("tool phase: model calls tools -> executes -> continues TOOL_PHASE", async () => {
    const adapter = new FakeAdapter();
    // Round 1: model calls tool
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: '{"city":"Beijing"}' },
    ]);
    // Round 2: model calls no tool -> switches to SOUL_PHASE
    adapter.enqueueText("");
    // SOUL_PHASE
    adapter.enqueueText("Beijing is 25C today");

    const executeResults: string[] = [];

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async (tc) => {
        executeResults.push(tc.name);
        return "Beijing: Sunny 25C";
      },
    });

    expect(executeResults).toEqual(["weather"]);
    expect(result.reply).toBe("Beijing is 25C today");
    expect(result.soulPhaseReason).toBe("no_tool");

    // 3 requests: 2 tool phase + 1 soul phase
    expect(adapter.requests.length).toBeGreaterThanOrEqual(3);
    // soul phase omits tools
    const soulReq = adapter.requests[adapter.requests.length - 1];
    expect(soulReq.tools).toBeUndefined();
    // soul phase system includes base and execution context
    expect(String(soulReq.messages[0].content)).toContain("SOUL_SYSTEM_BASE");
    expect(String(soulReq.messages[0].content)).toContain('"executionStatus":"succeeded"');
  });

  it("chat-only scenario: tool phase no_tool -> soul phase reply", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText(""); // tool phase: model called no tool
    adapter.enqueueText("hi friend~");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("executeTool should not be called in pure chat");
      },
    });

    expect(result.reply).toBe("hi friend~");
    expect(result.soulPhaseReason).toBe("no_tool");
    expect(result.toolResults).toHaveLength(0);
  });

  it("reaches maxToolRounds -> SOUL_PHASE forced summary", async () => {
    const adapter = new FakeAdapter();
    // Continually calls tools until ceiling is reached
    for (let i = 0; i < 3; i++) {
      adapter.enqueueToolCalls([
        { id: `tc-${i}`, name: "weather", arguments: "{}" },
      ]);
    }
    // soul phase
    adapter.enqueueText("Sorry, looped too many times");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      maxToolRounds: 3,
      executeTool: async () => "tool output",
    });

    expect(result.soulPhaseReason).toBe("max_rounds");
    expect(result.reply).toBe("Sorry, looped too many times");
  });

  it("tool execution error does not break main flow, records structured failure", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText(""); // tool phase: stop calling
    adapter.enqueueText("Error occurred but I continue");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("boom");
      },
    });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      output: "boom",
      status: "failed",
      errorCode: "E_TOOL_EXECUTION_FAILED",
    });
    expect(result.reply).toBe("Error occurred but I continue");
  });

  it("preserves a structured runtime failure for the final Soul call", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "play-1", name: "music_play_track", arguments: "{\"candidateRef\":\"ctx_missing\"}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("Request did not succeed, let me reconfirm the goal.");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_play_track")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => ({
        status: "failed" as const,
        output: "E_CONTEXT_REF_NOT_FOUND",
        errorCode: "E_CONTEXT_REF_NOT_FOUND",
      }),
    });

    expect(result.toolResults[0]).toMatchObject({
      toolId: "music_play_track",
      status: "failed",
      errorCode: "E_CONTEXT_REF_NOT_FOUND",
    });
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"executionStatus":"failed"');
    expect(sysContent).toContain('"errorCode":"E_CONTEXT_REF_NOT_FOUND"');
  });

  it("emits a concise structured tool execution trace", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const adapter = new FakeAdapter();
      adapter.enqueueToolCalls([{ id: "play-1", name: "music_play_track", arguments: "{}" }]);
      adapter.enqueueText("");
      adapter.enqueueText("Execution was not successful.");

      await runTwoPhaseFcLoop({
        ...baseOptions,
        tools: [makeTool("music_play_track")],
        settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
        adapter,
        executeTool: async () => ({
          status: "failed",
          output: "E_CONTEXT_REF_NOT_FOUND",
          errorCode: "E_CONTEXT_REF_NOT_FOUND",
        }),
      });

      const lines = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(lines).toContain("[ToolExecution/Trace] tool=music_play_track status=failed errorCode=E_CONTEXT_REF_NOT_FOUND");
    } finally {
      log.mockRestore();
    }
  });

  it("Soul phase retains tool message and injects authoritative execution context", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText("");
    adapter.enqueueText("Beijing 25C");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "Beijing: Sunny 25C",
    });

    const soulReq = adapter.requests[adapter.requests.length - 1];
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain("SOUL_SYSTEM_BASE");
    expect(sysContent).toContain("[SOUL_EXECUTION_CONTEXT]");
    expect(sysContent).toContain('"executionStatus":"succeeded"');
    expect(sysContent).not.toContain('"toolId"');
    expect(soulReq.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", name: "weather", content: "Beijing: Sunny 25C" }),
    ]));
  });

  it("buildSoulToolResultsSummary appends to soul system when non-empty", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText("");
    adapter.enqueueText("Beijing 25C");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "Beijing: Sunny 25C",
      buildSoulToolResultsSummary: () => "Tool summary: weather query successful",
    });

    const soulReq = adapter.requests[adapter.requests.length - 1];
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain("SOUL_SYSTEM_BASE");
    expect(sysContent).toContain("Tool summary: weather query successful");
  });

  it("tool phase free text must never be sent to user (does not enter reply)", async () => {
    const adapter = new FakeAdapter();
    // Model returned text in tool phase
    adapter.enqueueText("This is tool phase text, must not leak to user");
    adapter.enqueueText("This is official soul phase reply");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("Should not be called");
      },
    });

    expect(result.reply).not.toContain("tool phase text");
    expect(result.reply).toBe("This is official soul phase reply");
  });

  it("strips leaked leading chat timestamp metadata before emitting and returning reply", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("[2026-07-13 13:36, Asia/Shanghai]\nWhat's wrong, you look unhappy...");

    let streamed = "";
    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("Should not be called");
      },
      onEvent: (event) => {
        if (event.type === "text_message_content") streamed += event.delta;
      },
    });

    expect(result.reply).toBe("What's wrong, you look unhappy...");
    expect(streamed).toBe("What's wrong, you look unhappy...");
  });

  it("never emits MiniMax textual tool-call protocol from the Soul phase", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("]<]minimax[>[<tool_call>\n]<]minimax[>[<invoke name=\"music_get_daily_recommendations\">]<]minimax[>[</invoke>\n]<]minimax[>[</tool_call>");

    let streamed = "";
    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
      onEvent: (event) => {
        if (event.type === "text_message_content") streamed += event.delta;
      },
    });

    expect(result.reply).not.toContain("tool_call");
    expect(result.reply).not.toContain("minimax");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(streamed).toBe(result.reply);
  });

  it("replaces a leaked textual tool protocol with a generic retry message", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "daily-1", name: "music_get_daily_recommendations", arguments: "{}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("[tool_call]\nmusic_get_daily_recommendations\n[/tool_call]");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_get_daily_recommendations")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "recommendations",
        set: { tracks: [{ id: "1", name: "Real song" }] },
        presentation: { cardRef: "cyrene:music:daily-1" },
      }),
    });

    expect(result.reply).toContain("did not produce a valid response")
    expect(result.reply).not.toContain("tool_call")
  });

  it("lets Soul generate the natural card reply from structured tool facts without fixed replacement", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "daily-1", name: "music_get_daily_recommendations", arguments: "{}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("Today's recommendations are ready, check if you like any♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_get_daily_recommendations")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "recommendations",
        context: {
          setRef: "ctx_set",
          source: "daily_recommendation",
          candidates: [{
            candidateRef: "ctx_song_1",
            position: 1,
            name: "Initial Memory",
            artists: ["LaLa Hsu"],
          }],
        },
        presentation: { presented: true },
      }),
    });

    expect(result.reply).toBe("Today's recommendations are ready, check if you like any♪");
    const soulReq = adapter.requests.at(-1)!;
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain('[SOUL_EXECUTION_CONTEXT]');
    expect(sysContent).toContain('"executionStatus":"succeeded"');
    expect(sysContent).not.toContain('"kind":"recommendations"');
  });

  it("tells Soul explicitly when no tool ran instead of using a reply regex", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("Now playing for you♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
    });

    expect(result.reply).toBe("Now playing for you♪");
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"actions":[]');
  });

  it("provides dispatched playback as a runtime fact and leaves wording to Soul", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{
      id: "play-1",
      name: "music_play_track",
      arguments: JSON.stringify({ provider: "netease-cloud-music", setId: "s1", trackId: "1" }),
    }]);
    adapter.enqueueText("");
    adapter.enqueueText("Playback has started♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_play_track")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "playback",
        dispatch: { state: "dispatched", resourceType: "song", resourceId: "1" },
      }),
    });

    expect(result.reply).toBe("Playback has started♪");
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"executionStatus":"succeeded"');
    expect(sysContent).not.toContain('"toolId"');
    expect(sysContent).not.toContain('effect.state');
  });

  it("keeps style sampling out of tool requests and applies it to Soul only", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("done");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      soulSampling: { temperature: 0.9, frequencyPenalty: 0.2 },
      executeTool: async () => {
        throw new Error("Should not be called");
      },
    });

    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[0]).not.toHaveProperty("temperature");
    expect(adapter.requests[0]).not.toHaveProperty("frequencyPenalty");
    expect(adapter.requests[1]).toMatchObject({ temperature: 0.9, frequencyPenalty: 0.2 });
    expect(adapter.requests[1].tools).toBeUndefined();
  });
});

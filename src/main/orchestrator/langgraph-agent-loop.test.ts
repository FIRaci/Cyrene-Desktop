import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./task-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-router")>();
  return { ...actual, ENABLE_TASK_ROUTER: false };
});
import { runLangGraphAgentLoop } from "./langgraph-agent-loop";
import { AgentExecutionError } from "./run-execution-status";
import { ExecutionLedger } from "./execution-ledger";
import { contextRefRegistry } from "./tool-context";
import type { ToolDefinition } from "./tool-registry";
import type { TwoPhaseEvent } from "./two-phase-fc-loop";
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
  // id="chatgpt"; test model not on verified A-tier list, so fixed to prompt_json.
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
  /** Mock Action Gate structured JSON text response. */
  enqueueDecision(value: Record<string, unknown>) {
    this.enqueueJson(value);
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

function musicPlayTool(): ToolDefinition {
  return {
    id: "music_play_track", capability: "music.play_track", name: "Play track",
    description: "Play trusted track candidate", enabled: true,
    inputSchema: {
      type: "object", properties: { candidateRef: { type: "string" } }, required: ["candidateRef"],
    },
    controlledInput: { candidateRef: "context_ref" },
    execute: async () => "unused",
  };
}

function weatherTool(): ToolDefinition {
  return {
    id: "weather", capability: "weather.lookup", name: "Query weather",
    description: "Query weather for specified city", enabled: true,
    inputSchema: {
      type: "object", properties: { city: { type: "string" } }, required: [],
    },
    execute: async () => "unused",
  };
}

function options(adapter: FakeAdapter, executeTool = vi.fn(async () => ({
  status: "succeeded" as const,
  output: JSON.stringify({ kind: "playback", dispatch: { state: "dispatched" } }),
}))) {
  return {
    settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
    adapter,
    messages: [{ role: "user" as const, content: "Play track 1" }],
    tools: [musicPlayTool()],
    toolSystemContent: "TOOL_SYSTEM",
    soulSystemBaseContent: "SOUL_SYSTEM",
    originalQuery: "Play track 1",
    contextualizedQuery: "Play current NetEase Cloud daily recommendation track 1",
    citaContextBlock: "ctx_song_1",
    trustedRefs: ["ctx_song_1", "ctx_song_2"],
    timeoutMs: 30_000,
    executeTool,
  };
}

beforeEach(() => {
  process.env.CYRENE_LEGACY_STRUCTURED_OUTPUT = "1";
  // Context refs used in tests (ctx_song_1 etc.) are not registered in global registry,
  // mock resolve ensures reference verification always passes, focusing test on agent loop flow.
  vi.spyOn(contextRefRegistry, "resolve").mockImplementation((() => ({})) as never);
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => {
  delete process.env.CYRENE_LEGACY_STRUCTURED_OUTPUT;
  vi.restoreAllMocks();
});

describe("runLangGraphAgentLoop native Function Calling runtime", () => {
  it("executes a non-reference tool after discarding an invented target ref", async () => {
    vi.mocked(contextRefRegistry.resolve).mockImplementation(() => {
      throw new Error("unknown ref");
    });
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "act",
      capability: "weather.lookup",
      objective: "Query Hangzhou weather",
      targetRefs: ["Hangzhou"],
      afterSuccess: "respond",
    });
    adapter.enqueueToolCall("weather", { city: "Hangzhou" });
    adapter.enqueueText("Hangzhou is sunny today.");
    const executeTool = vi.fn(async () => ({
      status: "succeeded" as const,
      output: JSON.stringify({ city: "Hangzhou", condition: "sunny" }),
    }));

    const result = await runLangGraphAgentLoop({
      ...options(adapter, executeTool),
      messages: [{ role: "user", content: "Check Hangzhou weather" }],
      tools: [weatherTool()],
      originalQuery: "Check Hangzhou weather",
      contextualizedQuery: "Query Hangzhou current weather",
      citaContextBlock: "",
      trustedRefs: [],
      runtimeEnvironmentContext: "Default city: Zibo\nDesktop: C:\\Users\\13575\\Desktop",
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "weather", arguments: '{"city":"Hangzhou"}' }),
      expect.any(Set),
    );
    const actionGatePayload = JSON.parse(
      String(adapter.requests[0].messages.at(-1)?.content),
    ) as {
      machineInput: {
        availableCapabilities: Array<{
          capability: string;
          referencePolicy: string;
          requiredInputs: string[];
        }>;
        runtimeEnvironmentContext: string;
      };
    };
    expect(actionGatePayload.machineInput.availableCapabilities).toEqual([
      expect.objectContaining({
        capability: "weather.lookup",
        referencePolicy: "none",
        requiredInputs: [],
      }),
    ]);
    expect(actionGatePayload.machineInput.runtimeEnvironmentContext).toContain("Default city: Zibo");
    const nativeRequest = adapter.requests.find(
      (request) => request.toolChoiceIntent?.toolName === "weather",
    );
    expect(nativeRequest?.messages[0]?.content).toContain("C:\\Users\\13575\\Desktop");
    expect(result.reply).toBe("Hangzhou is sunny today.");
  });

  it("decides an action, resolves one native ToolCall, then Runtime executes it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // routeAfterTool routes directly to soul after tool succeeds, does not call Action Gate
    adapter.enqueueText("Play request sent to NetEase Cloud.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "{\"kind\":\"playback\"}" }));

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "music_play_track", arguments: '{"candidateRef":"ctx_song_1"}' }),
      expect.any(Set),
    );
    // Action Gate no longer carries virtual tools; only real Native FC requests filtered here.
    const nativeRequests = adapter.requests.filter(
      (request) => request.toolChoiceIntent?.toolName === "music_play_track",
    );
    expect(nativeRequests).toHaveLength(1);
    expect(nativeRequests[0]).toMatchObject({
      toolChoiceIntent: { mode: "must_call", toolName: "music_play_track" },
    });
    expect(result.reply).toBe("Play request sent to NetEase Cloud.");
    const lines = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(lines).toContain("[AgentFlow] 3. Select action: call music_play_track");
    expect(lines).toContain("[AgentFlow] 4. Generate tool arguments: completed (candidateRef)");
    expect(lines).toContain("[AgentFlow] 5. Execute tool: music_play_track");
    expect(lines).toContain("[AgentFlow] 6. Tool result: success");
    expect(lines).toContain("[AgentFlow] 7. Generate final response");
    expect(lines).not.toContain("[AgentGraph/Trace]");
    expect(lines).not.toContain("[StructuredOutput]");
  });

  it("shows an Action Gate validation failure and that no tool ran", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(contextRefRegistry.resolve).mockImplementation(() => {
      throw new Error("stale ref");
    });
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "act",
      capability: "music.play_track",
      objective: "Play track 1",
      targetRefs: ["stale-ref"],
      afterSuccess: "respond",
    });
    // Re-decision: model still picks same expired reference, transitions to failed reply when refresh budget exhausted
    adapter.enqueueDecision({
      decision: "act",
      capability: "music.play_track",
      objective: "Play track 1",
      targetRefs: ["stale-ref"],
      afterSuccess: "respond",
    });
    adapter.enqueueText("Tool was not executed.");
    const executeTool = vi.fn();

    await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(lines).toContain("[AgentFlow] 3. Action validation failed: TARGET_REF_INVALID");
    expect(lines).toContain("[AgentFlow]    Tool not executed; entering failure response");
  });

  it("recovers from a stale target ref via refresh re-decision", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(contextRefRegistry.resolve).mockImplementation(() => {
      throw new Error("stale ref");
    });
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "act",
      capability: "music.play_track",
      objective: "Play track 1",
      targetRefs: ["stale-ref"],
      afterSuccess: "respond",
    });
    // Re-decision: model observes previousGateFailure, changes to direct reply
    adapter.enqueueDecision({ decision: "respond", reason: "Reference has expired, please search again" });
    adapter.enqueueText("The reference has expired, shall I search again for you?");
    const executeTool = vi.fn();

    await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(lines).toContain("[AgentFlow] 3. Re-decision (last failed: TARGET_REF_INVALID)");
    expect(lines).toContain("[AgentFlow] 3. Select action: direct reply");
  });

  it("uses the choice-card answer to continue from ask_user to tool execution", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "ask_user",
      reason: "Version unclear",
      missingFields: [{
        field: "version",
        reason: "Song version unclear",
        required: true,
        questionHint: "Which version would you like to play?",
        typeHint: "single_select",
        allowedOptions: [],
        candidateHints: ["Live version", "Studio version"],
        allowCustom: true,
      }],
    });
    adapter.enqueueJson({
      intro: "Partner, to play what you like best, please choose a version.",
      questions: [{
        field: "version",
        question: "Which version would you like to play?",
        type: "single_select",
        options: [{ value: "Live version", label: "Live version" }],
        allowCustom: true,
        freeTextPlaceholder: "Enter other version",
      }],
      deferredFields: [],
    });
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play user-selected version", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    adapter.enqueueText("Played according to your choice.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "playing" }));
    const requestUserClarification = vi.fn(async () => ({
      requestId: "choice-1",
      answers: [{ field: "version", selectedValues: ["Live version"] }],
    }));

    const result = await runLangGraphAgentLoop(({
      ...options(adapter, executeTool),
      askSystemContent: "ASK_SYSTEM\n\nASK_PERSONA\n\nASK_QUOTES",
      trustedAskUserProfile: { callPreference: "partner", gender: "male" },
      requestUserClarification,
    } as Parameters<typeof runLangGraphAgentLoop>[0]));

    expect(requestUserClarification).toHaveBeenCalledWith(expect.objectContaining({
      intro: "Partner, to play what you like best, please choose a version.",
      questions: [expect.objectContaining({ field: "version" })],
    }));
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Played according to your choice.");
  });

  it("applies style sampling only to the final Soul request", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "respond", reason: "Direct reply" });
    adapter.enqueueText("Right here with you.");

    await runLangGraphAgentLoop({
      ...options(adapter),
      soulSampling: { temperature: 0.82, frequencyPenalty: 0.2 },
    });

    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[0].temperature).toBeUndefined();
    expect(adapter.requests[0].frequencyPenalty).toBeUndefined();
    expect(adapter.requests[1].temperature).toBe(0.82);
    expect(adapter.requests[1].frequencyPenalty).toBe(0.2);
  });

  it("repairs a malformed Action Gate JSON once", async () => {
    const adapter = new FakeAdapter();
    // First returns non-JSON, second repairs according to structured error code.
    adapter.enqueueText("I reply directly to the user");
    adapter.enqueueDecision({ decision: "respond", reason: "ready" });
    adapter.enqueueText("Sure.");

    const result = await runLangGraphAgentLoop(options(adapter));

    expect(String(adapter.requests[1].messages.at(-1)?.content)).toContain("repair");
    expect(String(adapter.requests[1].messages.at(-1)?.content)).toContain("NO_JSON_OBJECT");
    expect(result.reply).toBe("Sure.");
  });

  it("routes exhausted Action Gate failures to Failure Soul without executing tools", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("not json");
    adapter.enqueueText("still not json");
    adapter.enqueueText("again not json");
    adapter.enqueueText("No action was performed this time, please try again later.");
    const executeTool = vi.fn();

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.reply).toBe("No action was performed this time, please try again later.");
    expect(String(adapter.requests[3].messages[0].content)).toContain("FAILURE_SOUL_POLICY");
    expect(String(adapter.requests[3].messages[0].content)).toContain('"toolExecuted":false');
  });

  it("repairs a native ToolCall whose arguments fail Runtime validation", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_invented" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // routeAfterTool routes directly to soul after tool succeeds
    adapter.enqueueText("Request sent.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "ok" }));

    await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(String(adapter.requests[2].messages[0].content)).toContain("E_TOOL_ARGUMENT_SOURCE");
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("stops Native FC after one repair and sends a local non-execution fact to Soul", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "act",
      capability: "music.play_track",
      objective: "Play track 1",
      targetRefs: ["ctx_song_1"],
      afterSuccess: "respond",
    });
    adapter.enqueueText("pretend tool call");
    adapter.enqueueText("still no real tool call");
    adapter.enqueueText("Tool arguments were not reliably generated, so playback was not executed.");
    const executeTool = vi.fn();

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.toolResults).toContainEqual(expect.objectContaining({
      status: "failed",
      errorCode: "E_NATIVE_TOOL_PROTOCOL",
      toolExecuted: false,
      retryable: false,
    }));
    expect(String(adapter.requests[3].messages[0].content)).toContain("FAILURE_SOUL_POLICY");
    expect(String(adapter.requests[3].messages[0].content)).toContain('"toolExecuted":false');
  });

  it("feeds failed execution facts back so the model can explicitly retry", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Retry playing track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // routeAfterTool routes directly to soul after second attempt (succeeded)
    adapter.enqueueText("Second request sent successfully.");
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ status: "failed" as const, errorCode: "E_LAUNCH_FAILED", output: "Launch failed", retryable: true })
      .mockResolvedValueOnce({ status: "succeeded" as const, output: "{\"ok\":true}" });

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.toolResults.map((item) => item.status)).toEqual(["failed", "succeeded"]);
    expect(String(adapter.requests[2].messages.at(-1)?.content)).toContain("E_LAUNCH_FAILED");
  });

  it("does not repeat a successful side effect because routeAfterTool routes directly to Soul", async () => {
    // New happy path: act routes directly to soul via routeAfterTool after success, model has no chance to output same act again.
    // Deduplication / forced_respond in ExecutionLedger no longer bears normal termination responsibility.
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    adapter.enqueueText("Request sent.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "{\"ok\":true}" }));

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Request sent.");
  });

  it("forces respond on a deduplicated terminal action as a fallback (routeAfterTool -> decide -> duplicate)", async () => {
    // Fallback path: routeAfterTool returns to decide because afterSuccess=replan,
    // model repeats same action -> execute hits cache deduplicated=true -> forced_respond without LLM call.
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play", targetRefs: ["ctx_song_1"], afterSuccess: "replan" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // Model repeats same action after replan (same capability+targetRefs+args)
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play again", targetRefs: ["ctx_song_1"], afterSuccess: "replan" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // execute hits cache deduplicated=true -> routeAfterTool sees succeeded+terminal+respond(default) -> soul
    // (Note: replan is only declared on first act; second act also declares replan, but routeAfterTool still routes to soul
    //  because forced_respond is already triggered in decide when deduplicated=true, never reaching routeAfterTool.
    //  In practice: second execute returns deduplicated=true, streak=1, routeAfterTool sees succeeded+terminal+replan -> decide,
    //  decide sees deduplicated -> forced_respond -> soul)
    adapter.enqueueText("Play request sent.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "{\"ok\":true}" }));

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Play request sent.");
  });

  it("still allows a different action after a successful terminal action with afterSuccess=replan", async () => {
    // Multi-step task: 1st play(ctx_song_1) success + afterSuccess=replan -> routeAfterTool returns to decide
    // -> 2nd play(ctx_song_2) different fingerprint, cached=false, executes normally -> respond
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "replan" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    adapter.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 2", targetRefs: ["ctx_song_2"], afterSuccess: "respond" });
    adapter.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_2" });
    adapter.enqueueText("Done.");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "{\"ok\":true}" }));

    const result = await runLangGraphAgentLoop(options(adapter, executeTool));

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe("Done.");
  });

  it("does not repeat a successful side effect when Soul fails and the same turn is retried", async () => {
    const ledger = new ExecutionLedger();
    const first = new FakeAdapter();
    first.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    first.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // routeAfterTool routes directly to soul after tool succeeds, does not call Action Gate
    first.enqueueText("Undelivered Soul reply");
    const executeTool = vi.fn(async () => ({ status: "succeeded" as const, output: "{\"ok\":true}" }));
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("soul failed", { status: 500 })) as unknown as typeof fetch;

    // Soul failed but tool succeeded -> partial success fallback (does not throw)
    const firstResult = await runLangGraphAgentLoop({ ...options(first, executeTool), executionLedger: ledger });
    expect(firstResult.reply).toContain("Some operations completed");
    expect(firstResult.soulPhaseReason).toBe("tool_error");

    const retry = new FakeAdapter();
    retry.enqueueDecision({ decision: "act", capability: "music.play_track", objective: "Play track 1", targetRefs: ["ctx_song_1"], afterSuccess: "respond" });
    retry.enqueueToolCall("music_play_track", { candidateRef: "ctx_song_1" });
    // On retry execute hits ledger cache -> deduplicated=true -> forced_respond does not call LLM -> soul
    retry.enqueueText("Play request sent to NetEase Cloud.");
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    const result = await runLangGraphAgentLoop({ ...options(retry, executeTool), executionLedger: ledger });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("Play request sent to NetEase Cloud.");
  });

  it("preserves image-caption fallback for the first JSON decision request", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({
      decision: "ask_user",
      reason: "Insufficient image information",
      missingFields: [{
        field: "image_detail",
        reason: "Insufficient image details",
        required: true,
        questionHint: "Could you describe the image further?",
        typeHint: "text",
        allowedOptions: [],
        candidateHints: [],
        allowCustom: false,
      }],
    });
    adapter.enqueueText("Could you describe the image further?");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported image", { status: 400 }))
      .mockImplementation(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const imageCaptionFallback = vi.fn(async (): Promise<ChatMessage[]> => [
      { role: "user", content: "[Image description] A night view photo" },
    ]);

    await runLangGraphAgentLoop({ ...options(adapter), imageCaptionFallback });

    expect(imageCaptionFallback).toHaveBeenCalledTimes(1);
    expect(adapter.requests[1].messages).toContainEqual({ role: "user", content: "[Image description] A night view photo" });
  });

  it("strips MiniMax uffff-delimited tool protocol leak from Soul reply", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "respond", reason: "done" });
    // Soul reply leaked MiniMax tool protocol text (\uffff delimiter + protocol labels)
    adapter.enqueueText("\uffff\uffff[\u7cfb\u7edf\u63d0\u793a] Please output tool call in following JSON format:\n{\"action\":\"music_play_track\"}\uffff[\u5de5\u5177\u8c03\u7528]\uffff[{\"type\":\"function\"}]\uffff[\u5de5\u5177\u7ed3\u679c]\uffff{\"error\":\"unavailable\"}");
    const executeTool = vi.fn();
    const events: TwoPhaseEvent[] = [];
    await runLangGraphAgentLoop({ ...options(adapter, executeTool), onEvent: (e) => events.push(e) });

    // Fallback reply should be triggered after leaked text cleared, should not contain protocol text
    const textEvents = events.filter((e) => e.type === "text_message_content");
    const reply = textEvents.map((e) => (e as { delta?: string }).delta).join("");
    expect(reply).not.toContain("\uffff");
    expect(reply).not.toContain("[\u7cfb\u7edf\u63d0\u793a]");
    expect(reply).not.toContain("[\u5de5\u5177\u8c03\u7528]");
  });

  it("AgentExecutionError preserves cause and executionStatus on Soul failure", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "respond", reason: "done" });
    // Soul LLM returns 500
    globalThis.fetch = vi.fn(async () => new Response("soul failed", { status: 500 })) as unknown as typeof fetch;

    try {
      await runLangGraphAgentLoop(options(adapter));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentExecutionError);
      const execErr = err as AgentExecutionError;
      expect(execErr.executionStatus.phase).toBe("soul");
      // cause should retain original error
      expect(execErr.cause).toBeDefined();
    }
  });

  it("AgentExecutionError does not double-wrap", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "respond", reason: "done" });
    globalThis.fetch = vi.fn(async () => new Response("soul failed", { status: 500 })) as unknown as typeof fetch;

    try {
      await runLangGraphAgentLoop(options(adapter));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentExecutionError);
      // cause should not be another AgentExecutionError
      const execErr = err as AgentExecutionError;
      expect(execErr.cause).not.toBeInstanceOf(AgentExecutionError);
    }
  });

  it("Soul failure + successful tool → partial success fallback (not throw)", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "weather.lookup", objective: "Query weather", targetRefs: [], afterSuccess: "respond" });
    adapter.enqueueToolCall("weather", { city: "Hangzhou" });
    adapter.enqueueText("Soul will fail");
    const executeTool = vi.fn(async () => ({
      status: "succeeded" as const,
      output: JSON.stringify({ city: "Hangzhou", weather: "sunny", temperature: "25°C" }),
    }));
    // Action Gate(1) succeeded, Native FC(2) succeeded, Soul(3) failed
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 3) return new Response("soul failed", { status: 529 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runLangGraphAgentLoop({
      ...options(adapter, executeTool),
      tools: [weatherTool()],
    });

    // Should return partial success reply, does not throw
    expect(result.reply).toContain("Some operations completed");
    expect(result.reply).toContain("Query weather");
    expect(result.soulPhaseReason).toBe("tool_error");
  });

  it("Soul failure + file artifact → partial success mentions file path", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "write_word", objective: "Write document", targetRefs: [], afterSuccess: "respond" });
    adapter.enqueueToolCall("write_word", { filename: "test.docx", title: "Test", paragraphs: ["Content"] });
    adapter.enqueueText("Soul will fail");
    const writeWordTool: ToolDefinition = {
      id: "write_word", capability: "write_word", name: "Write Word",
      description: "Generate document", enabled: true,
      inputSchema: { type: "object", properties: { filename: { type: "string" }, title: { type: "string" }, paragraphs: { type: "array" } }, required: ["filename", "title", "paragraphs"] },
      completionEvidence: [{ kind: "tool_succeeded" }],
      execute: async () => "unused",
    };
    const executeTool = vi.fn(async () => ({
      status: "succeeded" as const,
      output: "[write_word] Generated: C:\\Users\\test\\Desktop\\test.docx",
    }));
    // Action Gate(1) succeeded, Native FC(2) succeeded, Soul(3) failed
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 3) return new Response("soul failed", { status: 529 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runLangGraphAgentLoop({
      ...options(adapter, executeTool),
      tools: [writeWordTool],
    });

    expect(result.reply).toContain("Some operations completed");
    expect(result.reply).toContain("test.docx");
  });

  it("Soul failure + no successful tools → throws AgentExecutionError (no fallback)", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "respond", reason: "done" });
    // Soul failed directly, no tools executed
    globalThis.fetch = vi.fn(async () => new Response("soul failed", { status: 529 })) as unknown as typeof fetch;

    await expect(runLangGraphAgentLoop(options(adapter))).rejects.toThrow("LangGraph execution failed");
  });

  it("user cancel → does not trigger partial fallback", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueDecision({ decision: "act", capability: "weather.lookup", objective: "Query weather", targetRefs: [], afterSuccess: "respond" });
    adapter.enqueueToolCall("weather", { city: "Hangzhou" });
    adapter.enqueueText("Soul will fail");
    const executeTool = vi.fn(async () => ({
      status: "succeeded" as const,
      output: JSON.stringify({ city: "Hangzhou", weather: "sunny" }),
    }));
    // Simulate user abort: signal aborted before Soul call -> ensureBudget throws E_AGENT_GRAPH_CANCELLED
    const abortController = new AbortController();
    abortController.abort();
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await expect(runLangGraphAgentLoop({
      ...options(adapter, executeTool),
      tools: [weatherTool()],
      signal: abortController.signal,
    })).rejects.toThrow();
  });
});

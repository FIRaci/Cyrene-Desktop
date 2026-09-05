import { describe, expect, test } from "vitest";
import { AnthropicAdapter } from "./anthropic-adapter";
import type { ProviderCapability } from "./types";

const anthropicCap: ProviderCapability = {
  id: "test-anthropic",
  displayName: "Test Anthropic",
  transport: "anthropic",
  baseUrl: "https://example.test/v1",
  authStyle: "x-api-key",
  defaultModel: "test-model",
  supportsTools: true,
  supportsThinking: true,
  thinkingField: "thinking",
  cacheStrategy: "cache_control",
  testStrategy: "text",
  supportsVision: true,
};

describe("AnthropicAdapter", () => {
  test("maps structured json_schema requests to output_config.format without OpenAI name", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const schema = {
      type: "object",
      properties: { decision: { type: "string", enum: ["respond"] } },
      required: ["decision"],
      additionalProperties: false,
    };
    const req = adapter.buildRequest({
      model: "m",
      maxTokens: 200,
      messages: [{ role: "user", content: "hi" }],
      structuredOutput: { mode: "json_schema", name: "ignored_by_anthropic", schema, strict: true },
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" });

    expect(JSON.parse(req.body).output_config).toEqual({
      format: { type: "json_schema", schema },
    });
  });

  test("does not invent structured output fields for prompt_json", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const req = adapter.buildRequest({
      model: "m",
      maxTokens: 200,
      messages: [{ role: "user", content: "hi" }],
      structuredOutput: { mode: "prompt_json", sendJsonObjectHint: false },
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" });

    expect(JSON.parse(req.body).output_config).toBeUndefined();
  });

  test("keeps ordinary native Function Calling on auto", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const req = adapter.buildRequest({
      model: "m", messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" });
    expect(JSON.parse(req.body).tool_choice).toEqual({ type: "auto" });
  });

  test("maps a must-call intent to named Anthropic tool_choice when reasoning is off", () => {
    const adapter = new AnthropicAdapter("claude", { ...anthropicCap, id: "claude" });
    const req = adapter.buildRequest({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, { provider: "Claude（Anthropic）", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6", apiKey: "sk-test", reasoning: { mode: "off" } });

    expect(JSON.parse(req.body).tool_choice).toEqual({ type: "tool", name: "music_search" });
  });

  test("downgrades must-call to auto when reasoning=auto (server may default thinking on)", () => {
    const adapter = new AnthropicAdapter("claude", { ...anthropicCap, id: "claude" });
    const req = adapter.buildRequest({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, { provider: "Claude（Anthropic）", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6", apiKey: "sk-test" });

    expect(JSON.parse(req.body).tool_choice).toEqual({ type: "auto" });
  });

  test("uses auto for must-call intent while extended thinking is enabled", () => {
    const adapter = new AnthropicAdapter("claude", { ...anthropicCap, id: "claude" });
    const req = adapter.buildRequest({
      model: "claude-sonnet-4-6", messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, {
      provider: "Claude（Anthropic）", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-6",
      apiKey: "k", reasoning: { mode: "on", effort: "high" },
    });
    expect(JSON.parse(req.body).tool_choice).toEqual({ type: "auto" });
  });

  test("maps a required-only provider policy to Anthropic any", () => {
    const adapter = new AnthropicAdapter("required-only", {
      ...anthropicCap,
      id: "required-only",
      toolChoiceModes: ["required"],
    });
    const req = adapter.buildRequest({
      model: "m", messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k", reasoning: { mode: "off" } });
    expect(JSON.parse(req.body).tool_choice).toEqual({ type: "any" });
  });

  test("buildRequest uses x-api-key when authStyle=x-api-key (default Anthropic)", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const req = adapter.buildRequest(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "sk-test" },
    );
    expect(req.headers["x-api-key"]).toBe("sk-test");
    expect(req.headers.Authorization).toBeUndefined();
    // anthropic-version is unrelated to authStyle and must be preserved
    expect(req.headers["anthropic-version"]).toBeDefined();
  });

  test("buildRequest uses Authorization Bearer when authStyle=bearer (decoupled)", () => {
    const mimoCap: ProviderCapability = {
      ...anthropicCap,
      id: "mimo",
      displayName: "MiMo",
      authStyle: "bearer",
    };
    const adapter = new AnthropicAdapter("mimo", mimoCap);
    const req = adapter.buildRequest(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      { provider: "MiMo", baseUrl: "https://api.xiaomimimo.com/anthropic", model: "m", apiKey: "sk-test" },
    );
    // Key: MiMo capability passed to AnthropicAdapter must produce Authorization: Bearer on wire
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    expect(req.headers["x-api-key"]).toBeUndefined();
    expect(req.headers["anthropic-version"]).toBeDefined();
  });

  // --- Streaming / non-streaming thinking parsing (covers Claude / MiniMax) ---

  test("parseStreamEvent: content_block_delta + thinking_delta → chunk.deltaThinking", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const chunk = adapter.parseStreamEvent({
      eventType: "content_block_delta",
      data: JSON.stringify({ delta: { type: "thinking_delta", thinking: "I am reasoning" } }),
    });
    expect(chunk?.deltaThinking).toBe("I am reasoning");
    expect(chunk?.deltaText).toBeUndefined();
  });

  test("parseStreamEvent: content_block_delta + text_delta → chunk.deltaText", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const chunk = adapter.parseStreamEvent({
      eventType: "content_block_delta",
      data: JSON.stringify({ delta: { type: "text_delta", text: "Hello" } }),
    });
    expect(chunk?.deltaText).toBe("Hello");
    expect(chunk?.deltaThinking).toBeUndefined();
  });

  test("parseResponse: parses thinking block + text block + tool_use block completely", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const resp = adapter.parseResponse({
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "need to check weather" },
        { type: "text", text: "let me check first" },
        { type: "tool_use", id: "t1", name: "get_weather", input: { city: "Beijing" } },
      ],
    });
    expect(resp.thinking).toBe("need to check weather");
    expect(resp.text).toBe("let me check first");
    expect(resp.toolCalls).toEqual([
      { id: "t1", name: "get_weather", arguments: '{"city":"Beijing"}' },
    ]);
    expect(resp.finishReason).toBe("tool_calls");  // adapter maps tool_use to tool_calls (OpenAI convention)
  });

  // --- Multi-turn tool calling + thinking block + signature: appendToolResults -> buildRequest end-to-end ---
  // Claude requires returning full assistant.content array for multi-turn tool_calls (including thinking + tool_use),
  // this fixture asserts the order and completeness of blocks in the wire body.

  test("multi-turn tool calling: assistant.content with thinking + tool_use retains full wire body structure", () => {
    const adapter = new AnthropicAdapter("test-anthropic", anthropicCap);
    const rawAssistantBlocks = [
      { type: "thinking", thinking: "let me think first", signature: "sig-abc" },
      { type: "text", text: "need to check weather" },
      { type: "tool_use", id: "t1", name: "get_weather", input: { city: "Beijing" } },
    ];
    // Input messages do not pre-write tool messages -- appendToolResults() generates tool_result,
    // otherwise duplicate tool_result will appear on wire.
    const messages = [
      { role: "user" as const, content: "How is Beijing weather" },
      {
        role: "assistant" as const,
        content: undefined,
        rawAssistant: rawAssistantBlocks,  // Direct content block array form
      },
      { role: "user" as const, content: "What about Shanghai" },
    ];

    const afterAppend = adapter.appendToolResults(messages, [
      { toolCall: { id: "t1", name: "get_weather", arguments: '{"city":"Beijing"}' }, output: "Sunny 25C" },
    ]);

    const req = adapter.buildRequest(
      { model: "claude-test", messages: afterAppend },
      { provider: "Test", baseUrl: "https://e.test/v1", model: "claude-test", apiKey: "k" },
    );
    const body = JSON.parse(req.body) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // 4 wire messages: user -> assistant(blocks) -> user(string) -> user(tool_result array)
    // Tool result adapter embeds tool_result into preceding user content array
    // when previous user is string content, creates new user message
    expect(body.messages).toHaveLength(4);

    // [0] user original
    expect(body.messages[0]).toEqual({ role: "user", content: "How is Beijing weather" });

    // [1] assistant.content is block array
    expect(body.messages[1].role).toBe("assistant");
    expect(Array.isArray(body.messages[1].content)).toBe(true);
    const assistantBlocks = body.messages[1].content as Array<Record<string, unknown>>;
    expect(assistantBlocks).toEqual([
      { type: "thinking", thinking: "let me think first", signature: "sig-abc" },
      { type: "text", text: "need to check weather" },
      { type: "tool_use", id: "t1", name: "get_weather", input: { city: "Beijing" } },
    ]);

    // [2] second user message
    expect(body.messages[2]).toEqual({ role: "user", content: "What about Shanghai" });

    // [3] tool_result embedded in newly created user message content array
    expect(body.messages[3].role).toBe("user");
    expect(Array.isArray(body.messages[3].content)).toBe(true);
    expect(body.messages[3].content).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "Sunny 25C" },
    ]);
  });
});

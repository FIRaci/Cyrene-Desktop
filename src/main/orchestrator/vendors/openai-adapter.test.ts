import { describe, expect, test } from "vitest";
import { OpenAICompatAdapter } from "./openai-adapter";
import type { ProviderCapability } from "./types";

const capability: ProviderCapability = {
  id: "test-openai",
  displayName: "Test OpenAI",
  transport: "openai",
  baseUrl: "https://example.test/v1",
  authStyle: "bearer",
  defaultModel: "test-model",
  supportsTools: true,
  supportsThinking: false,
  thinkingField: null,
  cacheStrategy: "none",
  testStrategy: "text",
  supportsVision: true,
};

describe("OpenAICompatAdapter", () => {
  test("maps structured json_schema requests to response_format", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const schema = {
      type: "object",
      properties: { decision: { type: "string", enum: ["respond"] } },
      required: ["decision"],
      additionalProperties: false,
    };
    const req = adapter.buildRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      structuredOutput: { mode: "json_schema", name: "action_decision", schema, strict: true },
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" });

    expect(JSON.parse(req.body).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "action_decision", strict: true, schema },
    });
  });

  test("maps json_object and prompt-json hints without tools", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const config = { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" };
    const makeBody = (structuredOutput: {
      mode: "json_object";
    } | {
      mode: "prompt_json";
      sendJsonObjectHint: true;
    }) => JSON.parse(adapter.buildRequest({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      structuredOutput,
    }, config).body);

    expect(makeBody({ mode: "json_object" }).response_format).toEqual({ type: "json_object" });
    expect(makeBody({ mode: "prompt_json", sendJsonObjectHint: true }).response_format)
      .toEqual({ type: "json_object" });
  });

  test("preserves refusal even when finish_reason is stop", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    expect(adapter.parseResponse({
      choices: [{
        message: { role: "assistant", content: null, refusal: "blocked" },
        finish_reason: "stop",
      }],
    })).toMatchObject({
      text: "",
      refusal: "blocked",
      finishReason: "stop",
    });
  });

  test("keeps ordinary native Function Calling on auto", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const req = adapter.buildRequest({
      model: "m", messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k" });
    expect(JSON.parse(req.body).tool_choice).toBe("auto");
  });

  test("maps a must-call intent to named OpenAI tool_choice when reasoning is off", () => {
    const adapter = new OpenAICompatAdapter("qwen", { ...capability, id: "qwen" });
    const req = adapter.buildRequest({
      model: "qwen3-7b",
      messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, { provider: "qwen", baseUrl: "https://e.test/v1", model: "qwen3-7b", apiKey: "sk-test", reasoning: { mode: "off" } });

    expect(JSON.parse(req.body).tool_choice).toEqual({
      type: "function",
      function: { name: "music_search" },
    });
  });

  test("maps must-call intent through the active provider and thinking policy", () => {
    const toolRequest = {
      model: "m",
      messages: [{ role: "user" as const, content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call" as const, toolName: "music_search" },
    };
    const deepseek = new OpenAICompatAdapter("deepseek", { ...capability, id: "deepseek" });
    const deepseekBody = JSON.parse(deepseek.buildRequest(toolRequest, {
      provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro",
      apiKey: "k", reasoning: { mode: "on", effort: "high" },
    }).body);
    expect(deepseekBody.tools).toHaveLength(1);
    expect(deepseekBody.tool_choice).toBeUndefined();

    const minimax = new OpenAICompatAdapter("minimax", { ...capability, id: "minimax" });
    const minimaxBody = JSON.parse(minimax.buildRequest(toolRequest, {
      provider: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3",
      apiKey: "k", reasoning: { mode: "on" },
    }).body);
    expect(minimaxBody.tool_choice).toBe("auto");
  });

  test("maps a required-only provider policy to OpenAI required", () => {
    const adapter = new OpenAICompatAdapter("required-only", {
      ...capability,
      id: "required-only",
      toolChoiceModes: ["required"],
    });
    const req = adapter.buildRequest({
      model: "m", messages: [{ role: "user", content: "search songs" }],
      tools: [{ name: "music_search", description: "search", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call", toolName: "music_search" },
    }, { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "k", reasoning: { mode: "off" } });
    expect(JSON.parse(req.body).tool_choice).toBe("required");
  });

  test("preserves user content blocks for direct image attachments", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const request = adapter.buildRequest(
      {
        model: "test-model",
        messages: [
          { role: "system", content: "system" },
          {
            role: "user",
            content: [
              { type: "text", text: "Please see image" },
              { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
            ],
          },
        ],
      },
      {
        provider: "Test OpenAI",
        baseUrl: "https://example.test/v1",
        model: "test-model",
        apiKey: "key",
      },
    );

    const body = JSON.parse(request.body) as { messages: Array<{ role: string; content: unknown }> };
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Please see image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    });
  });

  test("buildRequest uses Authorization Bearer when authStyle=bearer", () => {
    const adapter = new OpenAICompatAdapter("test-openai", { ...capability, authStyle: "bearer" });
    const req = adapter.buildRequest(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "sk-test" },
    );
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    expect(req.headers["x-api-key"]).toBeUndefined();
  });

  test("buildRequest uses x-api-key when authStyle=x-api-key (transport=openai decoupled)", () => {
    const adapter = new OpenAICompatAdapter("test-openai", { ...capability, authStyle: "x-api-key" });
    const req = adapter.buildRequest(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      { provider: "p", baseUrl: "https://e.test/v1", model: "m", apiKey: "sk-test" },
    );
    expect(req.headers["x-api-key"]).toBe("sk-test");
    expect(req.headers.Authorization).toBeUndefined();
  });

  // --- Streaming / non-streaming reasoning_content parsing (covers DeepSeek / Qwen / GLM / MiMo / Doubao) ---

  test("parseStreamEvent: delta.reasoning_content -> chunk.deltaThinking", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const chunk = adapter.parseStreamEvent({
      eventType: "data",
      data: JSON.stringify({ choices: [{ delta: { reasoning_content: "I am thinking" } }] }),
    });
    expect(chunk?.deltaThinking).toBe("I am thinking");
    expect(chunk?.deltaText).toBeUndefined();
  });

  test("parseStreamEvent: delta.content -> chunk.deltaText (does not affect reasoning_content)", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const chunk = adapter.parseStreamEvent({
      eventType: "data",
      data: JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
    });
    expect(chunk?.deltaText).toBe("Hello");
    expect(chunk?.deltaThinking).toBeUndefined();
  });

  test("parseStreamEvent: [DONE] sentinel -> chunk.done=true", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const chunk = adapter.parseStreamEvent({ eventType: "data", data: "[DONE]" });
    expect(chunk?.done).toBe(true);
  });

  test("parseStreamEvent: usage block (choices empty but has usage) -> chunk.usage", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const chunk = adapter.parseStreamEvent({
      eventType: "data",
      data: JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 20 } }),
    });
    expect(chunk?.usage).toEqual({ input: 10, output: 20 });
  });

  test("parseResponse: returns reasoning_content and content simultaneously", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const resp = adapter.parseResponse({
      choices: [{
        message: {
          role: "assistant",
          content: "Final answer",
          reasoning_content: "Thinking process",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    });
    expect(resp.text).toBe("Final answer");
    expect(resp.thinking).toBe("Thinking process");
    expect(resp.assistantMessage.thinking).toBe("Thinking process");
    expect(resp.assistantMessage.content).toBe("Final answer");
    expect(resp.usage).toEqual({ input: 5, output: 10 });
    expect(resp.finishReason).toBe("stop");
  });

  test("parseResponse: tool_calls mapped correctly", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const resp = adapter.parseResponse({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "tc1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    });
    expect(resp.toolCalls).toEqual([
      { id: "tc1", name: "get_weather", arguments: '{"city":"Beijing"}' },
    ]);
    expect(resp.finishReason).toBe("tool_calls");
    expect(resp.assistantMessage.toolCalls).toEqual(resp.toolCalls);
  });

  // --- Multi-turn tool calls: appendToolResults + buildRequest end-to-end ---

  test("multi-turn tool calls: assistant with toolCalls preserves wire message ordering and fields", () => {
    const adapter = new OpenAICompatAdapter("test-openai", capability);
    const messages = [
      { role: "user" as const, content: "How is Beijing weather" },
      {
        role: "assistant" as const,
        content: undefined,
        toolCalls: [{ id: "tc1", name: "get_weather", arguments: '{"city":"Beijing"}' }],
      },
      { role: "tool" as const, toolCallId: "tc1", name: "get_weather", content: "Sunny 25C" },
      { role: "user" as const, content: "What about Shanghai" },
    ];
    const req = adapter.buildRequest(
      { model: "test-model", messages },
      { provider: "Test", baseUrl: "https://e.test/v1", model: "test-model", apiKey: "k" },
    );
    const body = JSON.parse(req.body) as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toHaveLength(4);
    // message 1 user
    expect(body.messages[0]).toEqual({ role: "user", content: "How is Beijing weather" });
    // message 2 assistant with tool_calls
    expect(body.messages[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "tc1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
      }],
    });
    // message 3 tool with tool_call_id and name
    expect(body.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "tc1",
      content: "Sunny 25C",
      name: "get_weather",
    });
    // message 4 user at end
    expect(body.messages[3]).toEqual({ role: "user", content: "What about Shanghai" });
  });
});

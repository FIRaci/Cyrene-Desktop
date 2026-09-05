// OpenAI-compatible transport -- covers Doubao / DeepSeek / GLM / Kimi / Qwen / ChatGPT
// Request body protocol: POST {baseUrl}/chat/completions, messages + tools[].type=function
import {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter,
  HttpRequest, ProviderCapability, StreamChunk, StreamEvent,
  TestConnectionResult, ToolCall, ToolExecutionResult, VendorConfig,
} from "./types";
import { authHeaderFor } from "./auth";
import { resolveReasoningCapability } from "../../../shared/reasoning";
import { applyReasoningPreference } from "./reasoning";
import { resolveAutomaticToolChoicePolicy, resolveToolChoicePolicy } from "./tool-choice-policy";

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** Translate unified messages to OpenAI wire messages. */
function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map(m => {
    if (m.role === "system") return { role: "system", content: m.content ?? "" };
    if (m.role === "user") return { role: "user", content: m.content ?? "" };
    if (m.role === "tool") {
      const wire: Record<string, unknown> = {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content ?? "",
      };
      if (m.name) wire.name = m.name;
      return wire;
    }
    // assistant: return content + tool_calls (OpenAI multi-turn requires assistant message to include tool_calls)
    const wire: Record<string, unknown> = { role: "assistant", content: m.content || null };
    if (m.toolCalls && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    return wire;
  });
}

function toWireTools(tools?: ChatRequest["tools"]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class OpenAICompatAdapter implements ChatVendorAdapter {
  readonly transport = "openai" as const;
  constructor(public readonly id: string, public capability: ProviderCapability) {}

  buildRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toWireMessages(req.messages),
      stream: req.stream ?? false,
    };
    // temperature is only injected into body when explicitly passed.
    // When omitted, let vendor use default--different models have different constraints (e.g. Kimi k2.6 only allows 1),
    // Hardcoded fallbacks cause errors on certain models.
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.frequencyPenalty !== undefined) body.frequency_penalty = req.frequencyPenalty;
    if (req.repetitionPenalty !== undefined) body.repetition_penalty = req.repetitionPenalty;
    // maxTokens: only passed when caller explicitly specifies (usually omitted in streaming)
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    const tools = toWireTools(req.tools);
    if (tools) {
      body.tools = tools;
      if (req.toolChoiceOverride) {
        // Action Gate specific: explicitly specify tool_choice wire value, bypassing resolveToolChoicePolicy
        switch (req.toolChoiceOverride.kind) {
          case "named":
            body.tool_choice = { type: "function", function: { name: req.toolChoiceOverride.toolName } };
            break;
          case "required":
            body.tool_choice = "required";
            break;
          case "auto":
            body.tool_choice = "auto";
            break;
          case "none":
            body.tool_choice = "none";
            break;
          case "omit":
            // Do not send tool_choice field
            break;
        }
      } else if (req.toolChoiceIntent) {
        const policy = resolveToolChoicePolicy({
          providerId: this.capability.id,
          model: cfg.model,
          transport: this.transport,
          reasoning: cfg.reasoning ?? { mode: "auto" },
          requestedToolName: req.toolChoiceIntent.toolName,
          supportedModes: this.capability.toolChoiceModes,
        });
        if (policy.kind === "named") body.tool_choice = { type: "function", function: { name: policy.name } };
        else if (policy.kind === "required") body.tool_choice = "required";
        else if (policy.kind === "auto") body.tool_choice = "auto";
      } else if (resolveAutomaticToolChoicePolicy({
        providerId: this.capability.id,
        model: cfg.model,
        transport: this.transport,
        reasoning: cfg.reasoning ?? { mode: "auto" },
        supportedModes: this.capability.toolChoiceModes,
      }) === "auto") {
        body.tool_choice = "auto";
      }
    }
    if (req.extraBody) Object.assign(body, req.extraBody);
    if (req.structuredOutput?.mode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.structuredOutput.name,
          strict: req.structuredOutput.strict,
          schema: req.structuredOutput.schema,
        },
      };
    } else if (
      req.structuredOutput?.mode === "json_object"
      || req.structuredOutput?.mode === "prompt_json" && req.structuredOutput.sendJsonObjectHint
    ) {
      body.response_format = { type: "json_object" };
    }
    // Reasoning control: resolve capability by (providerId, model), call applyReasoningPreference to transform body.
    // cfg.reasoning defaults to auto (no fields sent).
    const reasoningCap = resolveReasoningCapability(this.capability.id, cfg.model);
    const finalBody = applyReasoningPreference(
      body,
      cfg.reasoning ?? { mode: "auto" },
      reasoningCap,
      {
        hasTools: Boolean(req.tools?.length),
        providerId: this.capability.id,
        model: cfg.model,
      },
    );
    return {
      url: buildUrl(cfg.baseUrl),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaderFor(this.capability, cfg.apiKey),
      },
      body: JSON.stringify(finalBody),
    };
  }

  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    // Reuse buildRequest: adapter writes body per req.stream, forcing stream=true
    return this.buildRequest({ ...req, stream: true }, cfg);
  }

  parseStreamEvent(event: StreamEvent): StreamChunk | null {
    // OpenAI streaming: eventType is always "data" (unified by createSseReader)
    const jsonStr = event.data.trim();
    if (!jsonStr) return null;
    if (jsonStr === "[DONE]") return { done: true };
    let parsed: { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }
    const delta = parsed?.choices?.[0]?.delta;
    if (!delta) {
      // Usage block at end of stream (choices empty but carries usage)
      if (parsed?.usage) {
        return {
          usage: {
            input: parsed.usage.prompt_tokens ?? 0,
            output: parsed.usage.completion_tokens ?? 0,
          },
        };
      }
      return null;
    }
    const chunk: StreamChunk = {};
    if (typeof delta.content === "string") chunk.deltaText = delta.content;
    if (typeof delta.reasoning_content === "string") chunk.deltaThinking = delta.reasoning_content;
    // Unimplemented: if (Array.isArray(delta.tool_calls)) chunk.deltaToolCalls = ...
    // Current callers do not use tools,
    // implement separately with tests if streaming tool_call deltas are needed.
    return chunk;
  }

  parseResponse(raw: unknown): ChatResponse {
    const data = raw as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          reasoning_content?: string;
          thinking?: string;
          refusal?: string | null;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const text = msg?.content ?? "";
    const thinking = msg?.reasoning_content || msg?.thinking || undefined;
    const refusal = msg?.refusal || undefined;

    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(thinking ? { thinking } : {}),
    };

    // Extract token usage (OpenAI protocol: prompt_tokens/completion_tokens)
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined;

    return {
      assistantMessage,
      text,
      thinking,
      refusal,
      toolCalls,
      finishReason: choice?.finish_reason ?? "stop",
      raw,
      usage,
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

  // Kimi: multi-turn agent strongly recommends prompt_cache_key (reflected in usage.cached_tokens).
  // v1 uses stable "vendor+model" key for system/tool caching; v2 can use session-level key.
  applyCacheHints(req: ChatRequest, _cfg: VendorConfig): ChatRequest {
    if (this.capability.cacheStrategy !== "prompt_cache_key") return req;
    const extraBody = { ...(req.extraBody ?? {}), prompt_cache_key: `cyrene:${this.id}` };
    return { ...req, extraBody };
  }

  async testConnection(cfg: VendorConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const req: ChatRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: "Ping. Reply with only: ok" }],
        // Omit temperature: certain models (like Kimi k2.6) require specific values, 0 causes errors
        stream: false,
      };
      const http = this.buildRequest(req, cfg);
      const res = await fetch(http.url, {
        method: "POST",
        signal: controller.signal,
        headers: http.headers,
        body: http.body,
      });
      const latency = Date.now() - start;
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, latency, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
      }
      const data = await res.json();
      const parsed = this.parseResponse(data);
      return { ok: true, latency, sample: parsed.text.slice(0, 80) || "(empty response)" };
    } catch (e) {
      return { ok: false, latency: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

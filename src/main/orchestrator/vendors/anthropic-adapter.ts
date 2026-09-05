// Anthropic transport -- MiniMax / Claude
// Request body protocol: POST {baseUrl}/v1/messages (only appends /messages if baseUrl already contains /v1)
// system top-level + messages[].content is content block array + tools[].input_schema
//
// Authentication is determined by authHeaderFor based on capability.authStyle--Anthropic transport
// can also use bearer (e.g. MiMo /anthropic endpoint).
import {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter,
  HttpRequest, ProviderCapability, StreamChunk, StreamEvent,
  TestConnectionResult, ToolCall, ToolExecutionResult, VendorConfig,
} from "./types";
import { authHeaderFor } from "./auth";
import { resolveReasoningCapability } from "../../../shared/reasoning";
import { applyReasoningPreference } from "./reasoning";
import { resolveAutomaticToolChoicePolicy, resolveToolChoicePolicy } from "./tool-choice-policy";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

interface ContentBlock {
  type: string;
  [k: string]: unknown;
}

/**
 * Translate unified messages to Anthropic wire messages.
 * Extracts system message separately (Anthropic system is a top-level field).
 * Key: if assistant has rawAssistant (raw content block array from prior turn), return it intact,
 * ensuring thinking / tool_use blocks are returned intact (mandatory for MiniMax multi-turn).
 * Tool results: Anthropic uses user-role tool_result blocks, merging multiple in same round into one user message.
 */
function toWireMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<Record<string, unknown>>;
} {
  const systemText = messages
    .filter(m => m.role === "system")
    .map(m => m.content ?? "")
    .join("\n\n")
    .trim();
  const system = systemText || undefined;

  const wire: Array<Record<string, unknown>> = [];
  for (const m of messages.filter(x => x.role !== "system")) {
    if (m.role === "user") {
      wire.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      if (m.rawAssistant !== undefined) {
        wire.push({ role: "assistant", content: m.rawAssistant });
      } else {
        const blocks: ContentBlock[] = [];
        if (m.thinking) blocks.push({ type: "thinking", thinking: m.thinking });
        if (m.content) blocks.push({ type: "text", text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.arguments || "{}");
            } catch {
              input = {};
            }
            blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input });
          }
        }
        wire.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" });
      }
    } else if (m.role === "tool") {
      const block: ContentBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content ?? "",
      };
      const last = wire[wire.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as ContentBlock[]).push(block);
      } else {
        wire.push({ role: "user", content: [block] });
      }
    }
  }
  return { system, messages: wire };
}

export class AnthropicAdapter implements ChatVendorAdapter {
  readonly transport = "anthropic" as const;
  constructor(public readonly id: string, public capability: ProviderCapability) {}

  buildRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    const { system, messages } = toWireMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream: req.stream ?? false,
    };
    // temperature only injected when explicitly passed, letting vendor use default to avoid model conflicts
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    // system + active caching (MiniMax/Claude: cache_control: ephemeral placed on system block)
    if (system) {
      if (this.capability.cacheStrategy === "cache_control") {
        body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
      } else {
        body.system = system;
      }
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (req.toolChoiceOverride) {
        // Action Gate specific: explicitly specify tool_choice wire value, bypassing resolveToolChoicePolicy
        switch (req.toolChoiceOverride.kind) {
          case "named":
            body.tool_choice = { type: "tool", name: req.toolChoiceOverride.toolName };
            break;
          case "required":
            body.tool_choice = { type: "any" };
            break;
          case "auto":
            body.tool_choice = { type: "auto" };
            break;
          case "none":
            body.tool_choice = { type: "none" };
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
        if (policy.kind === "named") body.tool_choice = { type: "tool", name: policy.name };
        else if (policy.kind === "required") body.tool_choice = { type: "any" };
        else if (policy.kind === "auto") body.tool_choice = { type: "auto" };
      } else if (resolveAutomaticToolChoicePolicy({
        providerId: this.capability.id,
        model: cfg.model,
        transport: this.transport,
        reasoning: cfg.reasoning ?? { mode: "auto" },
        supportedModes: this.capability.toolChoiceModes,
      }) === "auto") {
        body.tool_choice = { type: "auto" };
      }
    }
    if (req.extraBody) Object.assign(body, req.extraBody);
    if (req.structuredOutput?.mode === "json_schema") {
      body.output_config = {
        ...(
          body.output_config
          && typeof body.output_config === "object"
          && !Array.isArray(body.output_config)
            ? body.output_config as Record<string, unknown>
            : {}
        ),
        format: {
          type: "json_schema",
          schema: req.structuredOutput.schema,
        },
      };
    }
    // Reasoning control: resolve capability by (providerId, model), call applyReasoningPreference to transform body.
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
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(finalBody),
    };
  }

  parseResponse(raw: unknown): ChatResponse {
    const data = raw as {
      content?: ContentBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const blocks = data.content ?? [];
    let text = "";
    let thinking: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") {
        text += b.text;
      } else if (
        (b.type === "thinking" || b.type === "reasoning" || b.type === "reasoning_details") &&
        typeof (b.thinking ?? b.reasoning) === "string"
      ) {
        thinking = (thinking ?? "") + String(b.thinking ?? b.reasoning);
      } else if (b.type === "tool_use") {
        toolCalls.push({
          id: String(b.id ?? ""),
          name: String(b.name ?? ""),
          arguments: JSON.stringify(b.input ?? {}),
        });
      }
    }

    const stopReason = data.stop_reason ?? "end_turn";
    // Orchestrator uses toolCalls.length>0 to decide whether to continue; finishReason mapped to OpenAI conventions for unified logs
    const finishReason =
      stopReason === "tool_use" ? "tool_calls"
      : stopReason === "end_turn" ? "stop"
      : stopReason === "max_tokens" ? "length"
      : stopReason;

    const assistantMessage: ChatMessage = {
      role: "assistant",
      ...(text ? { content: text } : {}),
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      // Key: retain original content block array to send back in next round buildRequest
      rawAssistant: blocks,
    };

    // Extract token usage (Anthropic protocol: input_tokens/output_tokens)
    const usage = data.usage
      ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 }
      : undefined;

    return { assistantMessage, text, thinking, toolCalls, finishReason, raw, usage };
  }

  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    // Reuse buildRequest: adapter writes body per req.stream, forcing stream=true
    return this.buildRequest({ ...req, stream: true }, cfg);
  }

  parseStreamEvent(event: StreamEvent): StreamChunk | null {
    // Anthropic streaming: eventType is event name, data is JSON
    let parsed: { delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }; usage?: { input_tokens?: number; output_tokens?: number } };
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return null;
    }

    switch (event.eventType) {
      case "content_block_delta": {
        const d = parsed.delta;
        if (!d) return null;
        const chunk: StreamChunk = {};
        if (d.type === "text_delta" && typeof d.text === "string") chunk.deltaText = d.text;
        if (d.type === "thinking_delta" && typeof d.thinking === "string") chunk.deltaThinking = d.thinking;
        // Not implemented: d.type === "input_json_delta" -> accumulate to deltaToolCalls
        // Current callers do not use tools; implement when streaming tool_use increments are needed.
        return Object.keys(chunk).length > 0 ? chunk : null;
      }
      case "message_delta": {
        if (parsed.usage) {
          return {
            usage: {
              input: parsed.usage.input_tokens ?? 0,
              output: parsed.usage.output_tokens ?? 0,
            },
          };
        }
        return null;
      }
      case "message_stop":
        return { done: true };
      // Other events (message_start, content_block_start, ping, etc.) silently ignored
      default:
        return null;
    }
  }

  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    const next = messages.slice();
    for (const r of results) {
      // Unified layer pushes role:"tool"; Anthropic merging (tool_result into user message)
      // is handled by toWireMessages in buildRequest, staying transport-agnostic here.
      next.push({
        role: "tool",
        toolCallId: r.toolCall.id,
        name: r.toolCall.name,
        content: r.output,
      });
    }
    return next;
  }

  async testConnection(cfg: VendorConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const req: ChatRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: "Ping. Reply with only: ok" }],
        // Omit temperature: certain models only permit specific values, 0 causes errors
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

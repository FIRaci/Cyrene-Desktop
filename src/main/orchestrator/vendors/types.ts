// Vendor tool calling adapter layer -- unified types
// Orchestration layer (function-calling.ts) depends only on unified structures here, never if (provider === "xxx").
// Protocol source of truth: docs/vendors/tool-calling-matrix.md

import type { ReasoningPreference } from "../../../shared/reasoning";

export type Transport = "openai" | "anthropic";
export type AuthStyle = "bearer" | "x-api-key";
export type ThinkingField = "reasoning_content" | "thinking" | "reasoning_details" | null;
export type CacheStrategy = "prompt_cache_key" | "cache_control" | "auto" | "none";
export type TestStrategy = "text" | "text+tool";

/** Vendor runtime config passed by orchestration layer (compatible with main/index.ts ModelSettings). */
export interface VendorConfig {
  provider: string; // Vendor display name, e.g. "MiniMax", aligned with capability table displayName
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * Transport explicitly specified by user in settings UI; "auto" uses baseUrl heuristics + capabilities fallback.
   * resolveTransport(cfg) resolves auto into concrete transport.
   */
  explicitTransport?: Transport | "auto";
  /**
   * User reasoning preference. adapter buildRequest must pass this field;
   * Defaults to auto when not provided.
   * Populated by top-level mirrored field in ModelSettings; optional otherwise.
   */
  reasoning?: ReasoningPreference;
}

export type OpenAIContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessageContent = string | OpenAIContentBlock[];

/** Unified tool call description (internal), decoupled from OpenAI/Anthropic wire format. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string, following OpenAI conventions
}

/**
 * Unified message structure. Both transports read only their needed fields; orchestration layer passes through.
 * - OpenAI transport reads content / toolCalls / toolCallId / name
 * - Anthropic transport additionally reads thinking / rawAssistant (multi-round requires content block array)
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: ChatMessageContent;
  /** Tool calls on assistant (unified structure, converted to tool_calls[].function in OpenAI wire). */
  toolCalls?: ToolCall[];
  /** Backfill anchor for role:"tool" (OpenAI: tool_call_id; Anthropic: tool_use_id). */
  toolCallId?: string;
  name?: string;
  /** Extracted thinking/reasoning text (extracted from reasoning_content / thinking block). */
  thinking?: string;
  /** Anthropic multi-turn must return original assistant.content block array; ignored by OpenAI transport. */
  rawAssistant?: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object; // JSON Schema
}

export type StructuredOutputRequest =
  | {
      mode: "json_schema";
      name: string;
      schema: object;
      strict: boolean;
    }
  | {
      mode: "json_object";
      /** LangChain responseFormat schema; legacy wire adapters ignore it. */
      name?: string;
      schema?: object;
    }
  | {
      mode: "prompt_json";
      sendJsonObjectHint: boolean;
      /** LangChain responseFormat schema; legacy wire adapters ignore it. */
      name?: string;
      schema?: object;
    };

/**
 * Action Gate specific: explicitly specify tool_choice wire value, bypassing resolveToolChoicePolicy.
 * Native FC does not set this field, still using toolChoiceIntent + resolveToolChoicePolicy.
 *
 * Difference between `none` and `omit`:
 * - `none`: explicitly send tool inhibition (wire: tool_choice: "none")
 * - `omit`: completely omit tool_choice field from request
 */
export type ToolChoiceOverride =
  | { kind: "named"; toolName: string }
  | { kind: "required" }
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "omit" };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Runtime semantic intent; the active Adapter maps it to named/required/any/auto/omitted wire syntax. */
  toolChoiceIntent?: { mode: "must_call"; toolName: string };
  /** Action Gate specific: explicitly specify tool_choice wire value, bypassing resolveToolChoicePolicy. */
  toolChoiceOverride?: ToolChoiceOverride;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  repetitionPenalty?: number;
  stream?: boolean;
  /** CITA/Action Gate only. Native FC keeps using real tools instead. */
  structuredOutput?: StructuredOutputRequest;
  /**
   * Non-streaming max_tokens limit (OpenAI wire: `max_tokens`; Anthropic wire overrides default 4096).
   * Decided by adapter during streaming (normally unused--streaming relies on finish_reason).
   */
  maxTokens?: number;
  /** Vendor extension fields passed to top-level request body (e.g. Kimi prompt_cache_key). */
  extraBody?: Record<string, unknown>;
}

/**
 * Transport-agnostic unified streaming event.
 * Reader layer (createSseReader) splits HTTP body byte stream into StreamEvent list;
 * Adapter layer parseStreamEvent(event) is a pure, stateless function.
 *
 * - OpenAI streaming: eventType is fixed to "data", data is the JSON string from data: {...} line.
 * - Anthropic streaming: eventType is event name (message_start / content_block_delta / message_delta /
 *   message_stop etc.), data is the JSON string from data: {...} line.
 */
export interface StreamEvent {
  eventType: string;
  data: string;
}

/**
 * Streaming delta chunk. Interface design is broader than current needs (retaining deltaToolCalls),
 * but current parseStreamEvent implementations in both adapters only parse deltaText + deltaThinking;
 * tool deltas are silently ignored when encountered (no error, no accumulation).
 *
 * Future extensions requiring tool calling only need adapter updates,
 * without altering interfaces or callers.
 */
export interface StreamChunk {
  deltaText?: string;
  deltaThinking?: string;
  deltaToolCalls?: ToolCall[];
  done?: boolean;
  usage?: { input: number; output: number };
}

/** Unified response parsed by adapter; orchestration layer only inspects this. */
export interface ChatResponse {
  /** Assistant message to append to conversation (retaining thinking / rawAssistant for subsequent turns). */
  assistantMessage: ChatMessage;
  text: string;
  thinking?: string;
  /** Provider-declared refusal; it may coexist with a normal-looking finish reason. */
  refusal?: string;
  toolCalls: ToolCall[];
  finishReason: string;
  raw: unknown;
  /** LangChain responseFormat result; absent on the legacy adapter path. */
  structuredValue?: unknown;
  /** API token usage (OpenAI: prompt_tokens/completion_tokens; Anthropic: input_tokens/output_tokens).
   *  Undefined when not reported, handled by caller fallback. */
  usage?: { input: number; output: number };
}

export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ToolExecutionResult {
  toolCall: ToolCall;
  output: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latency: number;
  sample?: string;
  error?: string;
}

/**
 * Entry in vendor capability table. The source of truth for vendor adapters,
 * avoiding scattered if (provider === "kimi") checks in function-calling.ts.
 */
export interface ProviderCapability {
  id: string;
  displayName: string;
  transport: Transport;
  baseUrl: string;
  authStyle: AuthStyle;
  defaultModel: string;
  supportsTools: boolean;
  supportsThinking: boolean;
  thinkingField: ThinkingField;
  cacheStrategy: CacheStrategy;
  testStrategy: TestStrategy;
  /** Whether vision (image) input is supported. Non-multimodal models must not use read_image. */
  supportsVision: boolean;
  /** Supported must-call wire policies; Adapter maps required to OpenAI required / Anthropic any. */
  toolChoiceModes?: ReadonlyArray<"named" | "required" | "auto" | "omit">;
  /**
   * OpenAI-compatible baseUrl for vision model. Only needed when main chat uses Anthropic while vision requires OpenAI
   * (e.g. MiniMax configured with /anthropic while vision needs /v1). If unspecified = vision uses main baseUrl.
   */
  visionBaseUrl?: string;
  /** Whether UI permits selection. */
  disabled?: boolean;
}

/** Orchestration layer only interfaces with this layer. */
export interface ChatVendorAdapter {
  readonly id: string;
  readonly transport: Transport;
  capability: ProviderCapability;
  buildRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest;
  parseResponse(raw: unknown): ChatResponse;
  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[];
  applyCacheHints?(req: ChatRequest, cfg: VendorConfig): ChatRequest;
  /**
   * Streaming buildRequest: identical shape to buildRequest, but stream=true in body.
   * Default implementation: reuse buildRequest (adapter writes body per req.stream).
   */
  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest;
  /**
   * Parse a complete streaming event. Pure, stateless function--state is maintained by caller buffer.
   * Returns null if event produces no delta (heartbeats, comments, unrecognized event types, etc.).
   *
   * Strictly aligned with StreamEvent: input is a complete protocol event split by Reader,
   * not a byte chunk.
   */
  parseStreamEvent(event: StreamEvent): StreamChunk | null;
  testConnection(cfg: VendorConfig): Promise<TestConnectionResult>;
}

// Vendor adapter factory: returns adapter instance for transport by provider display name or VendorConfig.
// Orchestration layer uses getAdapter(provider) or getAdapterForConfig(cfg), agnostic to transport details.
import { OpenAICompatAdapter } from "./openai-adapter";
import { AnthropicAdapter } from "./anthropic-adapter";
import { getCapability, getCapabilityOrOpenAI, PROVIDER_CAPABILITIES } from "./capabilities";
import { resolveTransport } from "./transport-detector";
import type {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter, HttpRequest,
  ProviderCapability, StreamChunk, StreamEvent, TestConnectionResult, ToolCall, ToolExecutionResult,
  StructuredOutputRequest, ToolSpec, Transport, VendorConfig,
} from "./types";

export type {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter, HttpRequest,
  ProviderCapability, StreamChunk, StreamEvent, TestConnectionResult, ToolCall, ToolExecutionResult,
  StructuredOutputRequest, ToolSpec, Transport, VendorConfig,
};
export { getCapability, getCapabilityOrOpenAI, PROVIDER_CAPABILITIES };
export { detectTransport, resolveTransport } from "./transport-detector";

const cache = new Map<string, ChatVendorAdapter>();

/** Get adapter by provider display name (reuses instance for same provider) -- legacy path. */
export function getAdapter(provider: string): ChatVendorAdapter {
  const existing = cache.get(provider);
  if (existing) return existing;
  const cap = getCapabilityOrOpenAI(provider);
  const adapter: ChatVendorAdapter =
    cap.transport === "anthropic"
      ? new AnthropicAdapter(cap.id, cap)
      : new OpenAICompatAdapter(cap.id, cap);
  cache.set(provider, adapter);
  return adapter;
}

/**
 * Get adapter instance by runtime config. Three-tiered transport resolution:
 *   1. cfg.explicitTransport (user explicit)
 *   2. baseUrl heuristics (detectTransport)
 *   3. capabilities table default
 * Cache key uses `${provider}::${transport}` to avoid stale instances when transport is changed.
 */
export function getAdapterForConfig(cfg: VendorConfig): ChatVendorAdapter {
  const transport = resolveTransport({
    baseUrl: cfg.baseUrl,
    explicitTransport: cfg.explicitTransport,
    provider: cfg.provider,
  });
  const cacheKey = `${cfg.provider}::${transport}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  const cap = getCapabilityOrOpenAI(cfg.provider);
  const adapter: ChatVendorAdapter =
    transport === "anthropic"
      ? new AnthropicAdapter(cap.id, cap)
      : new OpenAICompatAdapter(cap.id, cap);
  cache.set(cacheKey, adapter);
  return adapter;
}

/**
 * Vendor-agnostic URL builder -- transport passed by caller (already through resolveTransport).
 * - OpenAI transport → {baseUrl}/chat/completions
 * - Anthropic transport -> {baseUrl}/v1/messages (only appends /messages if baseUrl already contains /v1)
 */
export function buildVendorUrl(baseUrl: string, transport: Transport): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (transport === "anthropic") {
    if (trimmed.endsWith("/messages")) return trimmed;
    if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
    return `${trimmed}/v1/messages`;
  }
  // OpenAI transport
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Legacy signature (retained for compatibility): look up transport by provider name then call buildVendorUrl.
 * Existing callers remain supported,
 * but new code should use buildVendorUrl(baseUrl, transport) + getAdapterForConfig(cfg).
 */
export function buildVendorUrlByProvider(provider: string, baseUrl: string): string {
  const cap = getCapabilityOrOpenAI(provider);
  return buildVendorUrl(baseUrl, cap.transport);
}

/**
 * Create an AsyncIterable<StreamEvent>, splitting HTTP body byte stream per transport protocol.
 *
 * - OpenAI SSE format: each event consists of a single `data: {...}` line (separated by \n\n).
 *   -> produces StreamEvent{ eventType: "data", data: "{...}" }
 * - Anthropic event-stream format: each event consists of `event: <type>\ndata: {...}` lines.
 *   -> produces StreamEvent{ eventType: "<type>", data: "{...}" }
 *
 * Splitting rules separate event blocks by \n\n, allowing both protocols to share the state machine.
 * Adapter parseStreamEvent is pure and stateless; all partial line buffer logic is maintained here.
 */
export function createSseReader(
  _adapter: ChatVendorAdapter,
  body: ReadableStream<Uint8Array>,
): AsyncIterable<StreamEvent> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  let buffer = "";

  return {
    [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
      return {
        async next(): Promise<IteratorResult<StreamEvent>> {
          // Loop: keep reading until a complete event block can be split
          // (multi-chunk partial line data will continue to read + append buffer)
          while (true) {
            const splitAt = buffer.indexOf("\n\n");
            if (splitAt !== -1) {
              const raw = buffer.slice(0, splitAt);
              buffer = buffer.slice(splitAt + 2);
              const event = parseSseBlock(raw);
              if (event) return { value: event, done: false };
              // Skip empty comment blocks (OpenAI keepalives) and continue
              continue;
            }
            // Incomplete event block in buffer, requires more bytes
            const { value, done } = await reader.read();
            if (done) {
              // Stream ended: process remaining buffer if present; otherwise return done
              if (buffer.trim().length > 0) {
                const event = parseSseBlock(buffer);
                buffer = "";
                if (event) return { value: event, done: false };
              }
              return { value: undefined, done: true };
            }
            buffer += decoder.decode(value, { stream: true });
          }
        },
        async return(): Promise<IteratorResult<StreamEvent>> {
          try { await reader.cancel(); } catch { /* ignore */ }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/**
 * Parse an SSE event block into StreamEvent.
 * Returns null if block is a comment (OpenAI keepalive `: ...`) or empty.
 */
function parseSseBlock(block: string): StreamEvent | null {
  let eventType = "data"; // OpenAI default
  let dataLine = "";
  let hasData = false;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue; // empty or comment line
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLine = line.slice(5).trimStart();
      hasData = true;
    }
    // Other fields (id: / retry:) currently unused, ignore
  }
  if (!hasData) return null;
  return { eventType, data: dataLine };
}

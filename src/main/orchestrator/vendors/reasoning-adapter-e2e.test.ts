// 23 end-to-end assertions: construct full ProviderCapability + VendorConfig,
// invoke adapter.buildRequest, assert parsed JSON body wire fields.

import { describe, expect, test } from "vitest";
import { OpenAICompatAdapter } from "./openai-adapter";
import { AnthropicAdapter } from "./anthropic-adapter";
import type { ProviderCapability, VendorConfig } from "./types";
import type { ReasoningPreference } from "../../../shared/reasoning";

function makeCap(overrides: Partial<ProviderCapability> & { id: ProviderCapability["id"]; transport: ProviderCapability["transport"] }): ProviderCapability {
  return {
    displayName: overrides.id,
    baseUrl: overrides.transport === "anthropic" ? "https://e.test/v1" : "https://e.test/v1",
    authStyle: overrides.transport === "anthropic" ? "x-api-key" : "bearer",
    defaultModel: "m",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: overrides.transport === "anthropic" ? "thinking" : "reasoning_content",
    cacheStrategy: overrides.transport === "anthropic" ? "cache_control" : "auto",
    testStrategy: "text",
    supportsVision: false,
    ...overrides,
  };
}

function cfg(cap: ProviderCapability, model: string, reasoning?: ReasoningPreference): VendorConfig {
  return {
    provider: cap.displayName,
    baseUrl: cap.baseUrl,
    model,
    apiKey: "sk-test",
    ...(reasoning ? { reasoning } : {}),
  };
}

function buildOpenAI(cap: ProviderCapability, model: string, reasoning?: ReasoningPreference, tools?: ChatRequestTool[]): Record<string, unknown> {
  const adapter = new OpenAICompatAdapter(cap.id, cap);
  const http = adapter.buildRequest(
    { model, messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) },
    cfg(cap, model, reasoning),
  );
  return JSON.parse(http.body) as Record<string, unknown>;
}

function buildAnthropic(cap: ProviderCapability, model: string, reasoning?: ReasoningPreference, tools?: ChatRequestTool[]): Record<string, unknown> {
  const adapter = new AnthropicAdapter(cap.id, cap);
  const http = adapter.buildRequest(
    { model, messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...(tools ? { tools } : {}) },
    cfg(cap, model, reasoning),
  );
  return JSON.parse(http.body) as Record<string, unknown>;
}

interface ChatRequestTool {
  name: string;
  description: string;
  parameters: object;
}

const SAMPLE_TOOL: ChatRequestTool = {
  name: "tool",
  description: "d",
  parameters: { type: "object" },
};

// ── ChatGPT ──────────────────────────────────────────────
describe("ChatGPT end-to-end", () => {
  const cap = makeCap({ id: "chatgpt", transport: "openai" });

  test("#1 gpt-5.6 + {on, high} → reasoning_effort === 'high'", () => {
    expect(buildOpenAI(cap, "gpt-5.6", { mode: "on", effort: "high" }).reasoning_effort).toBe("high");
  });

  test("#2 gpt-5 + {on, medium} → reasoning_effort === 'medium'", () => {
    expect(buildOpenAI(cap, "gpt-5", { mode: "on", effort: "medium" }).reasoning_effort).toBe("medium");
  });

  test("#3 gpt-5 + off → reasoning_effort === 'none'", () => {
    expect(buildOpenAI(cap, "gpt-5", { mode: "off" }).reasoning_effort).toBe("none");
  });

  test("#4 gpt-4o + {on, high} -> no reasoning_effort in body", () => {
    const body = buildOpenAI(cap, "gpt-4o", { mode: "on", effort: "high" });
    expect("reasoning_effort" in body).toBe(false);
  });
});

// ── Claude ──────────────────────────────────────────────
describe("Claude end-to-end", () => {
  const cap = makeCap({ id: "claude", transport: "anthropic" });

  test("#5 claude-sonnet-5 + {on, xhigh} -> output_config.effort=xhigh and thinking.type=adaptive", () => {
    const body = buildAnthropic(cap, "claude-sonnet-5", { mode: "on", effort: "xhigh" });
    expect((body.output_config as Record<string, unknown>).effort).toBe("xhigh");
    expect((body.thinking as Record<string, unknown>).type).toBe("adaptive");
  });

  test("#6 claude-sonnet-5 + output_config existing fields -> merges without overwrite", () => {
    const adapter = new AnthropicAdapter("claude", cap);
    // Call buildRequest and verify merging with extraBody
    // Test extraBody scenario
    // Inject output_config with extraBody, then call buildRequest
    const http = adapter.buildRequest(
      {
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
        extraBody: { output_config: { format: "json" } },
      },
      cfg(cap, "claude-sonnet-5", { mode: "on", effort: "high" }),
    );
    const body = JSON.parse(http.body) as Record<string, unknown>;
    expect((body.output_config as Record<string, unknown>).format).toBe("json");
    expect((body.output_config as Record<string, unknown>).effort).toBe("high");
  });
});

// ── DeepSeek ──────────────────────────────────────────────
describe("DeepSeek end-to-end", () => {
  const cap = makeCap({ id: "deepseek", transport: "openai" });

  test("#7 deepseek-v4-pro + {on, max} -> thinking.type=enabled and reasoning_effort=max", () => {
    const body = buildOpenAI(cap, "deepseek-v4-pro", { mode: "on", effort: "max" });
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
    expect(body.reasoning_effort).toBe("max");
  });
});

// ── GLM ──────────────────────────────────────────────
describe("GLM end-to-end", () => {
  const cap = makeCap({ id: "glm", transport: "openai" });

  test("#8 glm-5.2 + {on, high} -> thinking.type=enabled and reasoning_effort=high", () => {
    const body = buildOpenAI(cap, "glm-5.2", { mode: "on", effort: "high" });
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
    expect(body.reasoning_effort).toBe("high");
  });

  test("#9 glm-4.7 + on -> thinking.type=enabled and no reasoning_effort in body", () => {
    const body = buildOpenAI(cap, "glm-4.7", { mode: "on" });
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
    expect("reasoning_effort" in body).toBe(false);
  });
});

// ── Qwen ──────────────────────────────────────────────
describe("Qwen end-to-end", () => {
  const cap = makeCap({ id: "qwen", transport: "openai" });

  test("#10 qwen3-max + on -> enable_thinking=true and no thinking in body", () => {
    const body = buildOpenAI(cap, "qwen3-max", { mode: "on" });
    expect(body.enable_thinking).toBe(true);
    expect("thinking" in body).toBe(false);
  });

  test("#11 qwen-max-thinking + off -> no thinking/enable_thinking in body (fixed-on)", () => {
    const body = buildOpenAI(cap, "qwen-max-thinking", { mode: "off" });
    expect("thinking" in body).toBe(false);
    expect("enable_thinking" in body).toBe(false);
  });
});

// ── Kimi ──────────────────────────────────────────────
describe("Kimi end-to-end", () => {
  const cap = makeCap({ id: "kimi", transport: "openai" });

  test("#12 kimi-k2.6 + on + hasTools → thinking={type:'enabled', keep:'all'}", () => {
    const body = buildOpenAI(cap, "kimi-k2.6", { mode: "on" }, [SAMPLE_TOOL]);
    expect(body.thinking).toEqual({ type: "enabled", keep: "all" });
  });

  test("#13 kimi-k2.5 + on + hasTools -> thinking={type:'enabled'} without keep", () => {
    const body = buildOpenAI(cap, "kimi-k2.5", { mode: "on" }, [SAMPLE_TOOL]);
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  test("#14 kimi-k2.7-code + on -> no thinking in body (fixed-on + requestStyle=none)", () => {
    const body = buildOpenAI(cap, "kimi-k2.7-code", { mode: "on" });
    expect("thinking" in body).toBe(false);
  });

  test("#15 kimi-k2.7-code + off -> no thinking in body (fixed-on)", () => {
    const body = buildOpenAI(cap, "kimi-k2.7-code", { mode: "off" });
    expect("thinking" in body).toBe(false);
  });

  test("#16 kimi-k2.7-code-highspeed + off -> no thinking in body", () => {
    const body = buildOpenAI(cap, "kimi-k2.7-code-highspeed", { mode: "off" });
    expect("thinking" in body).toBe(false);
  });
});

// ── MiniMax ──────────────────────────────────────────────
describe("MiniMax end-to-end", () => {
  const cap = makeCap({ id: "minimax", transport: "anthropic" });

  test("#17 MiniMax-M3 + off -> thinking.type=disabled (anthropic-adaptive)", () => {
    const body = buildAnthropic(cap, "MiniMax-M3", { mode: "off" });
    expect((body.thinking as Record<string, unknown>).type).toBe("disabled");
  });

  test("#18 MiniMax-M3 + on → thinking.type=adaptive（NOT 'enabled'）", () => {
    const body = buildAnthropic(cap, "MiniMax-M3", { mode: "on" });
    expect((body.thinking as Record<string, unknown>).type).toBe("adaptive");
  });

  test("#19 MiniMax-M2.7 + off -> no thinking in body (fixed-on)", () => {
    const body = buildAnthropic(cap, "MiniMax-M2.7", { mode: "off" });
    expect("thinking" in body).toBe(false);
  });
});

// ── MiMo ──────────────────────────────────────────────
describe("MiMo end-to-end", () => {
  test("#20 mimo-v2.5-pro + on (OpenAI transport) → thinking.type=enabled", () => {
    const cap = makeCap({ id: "mimo", transport: "openai" });
    const body = buildOpenAI(cap, "mimo-v2.5-pro", { mode: "on" });
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
  });

  test("#21 mimo-v2.5-pro + on (Anthropic transport) -> thinking.type=enabled (cross-transport consistency)", () => {
    const cap = makeCap({ id: "mimo", transport: "anthropic" });
    const body = buildAnthropic(cap, "mimo-v2.5-pro", { mode: "on" });
    expect((body.thinking as Record<string, unknown>).type).toBe("enabled");
  });
});

// -- Doubao --
describe("Doubao end-to-end", () => {
  const cap = makeCap({ id: "doubao", transport: "openai" });

  test("#22 doubao-seed-2-1 + on → thinking.type=enabled", () => {
    const body = buildOpenAI(cap, "doubao-seed-2-1-pro-260628", { mode: "on" });
    expect("reasoning_effort" in body).toBe(false);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect("enable_thinking" in body).toBe(false);
  });
});

// -- Unknown model --
describe("Unknown model end-to-end", () => {
  test("#23 Unknown model + on -> no reasoning fields in body (none fallback)", () => {
    const cap = makeCap({ id: "unknown", transport: "openai" });
    const body = buildOpenAI(cap, "anything", { mode: "on" });
    expect("reasoning_effort" in body).toBe(false);
    expect("thinking" in body).toBe(false);
  });
});

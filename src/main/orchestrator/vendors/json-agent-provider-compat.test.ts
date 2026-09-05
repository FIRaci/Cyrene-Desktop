import { describe, expect, test } from "vitest";
import { getAdapterForConfig, getCapability } from "./index";
import type { ChatRequest } from "./types";

describe.each([
  ["MiniMax", "MiniMax-M3"],
  ["Kimi", "kimi-k2.7-code"],
  ["DeepSeek", "deepseek-v4-pro"],
] as const)("native Function Calling protocol on %s", (provider, model) => {
  test("keeps native tools and applies the provider-specific tool_choice policy", () => {
    const capability = getCapability(provider)!;
    const cfg = {
      provider,
      baseUrl: capability.baseUrl,
      model,
      apiKey: "test-key",
      explicitTransport: "openai" as const,
      reasoning: { mode: "on" as const, effort: "medium" as const },
    };
    const adapter = getAdapterForConfig(cfg);
    const request: ChatRequest = {
      model,
      messages: [{ role: "user", content: "play the first track" }],
      tools: [{ name: "music_play_track", description: "play song", parameters: { type: "object" } }],
      toolChoiceIntent: { mode: "must_call" as const, toolName: "music_play_track" },
    };
    const body = JSON.parse(adapter.buildRequest(request, cfg).body) as Record<string, unknown>;

    expect(body.tools).toBeDefined();
    if (provider === "DeepSeek") expect(body.tool_choice).toBeUndefined();
    else expect(body.tool_choice).toBe("auto");
  });
});

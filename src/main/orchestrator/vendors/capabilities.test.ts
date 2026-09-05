import { describe, expect, test } from "vitest";
import { PROVIDER_CAPABILITIES, getCapability } from "./capabilities";
import { getAdapterForConfig } from "./index";

describe("PROVIDER_CAPABILITIES — schema smoke", () => {
  test("every capability has id and displayName, and is non-empty", () => {
    for (const cap of PROVIDER_CAPABILITIES) {
      expect(cap.id, `entry missing id`).toBeTruthy();
      expect(cap.displayName, `entry ${cap.id} missing displayName`).toBeTruthy();
    }
  });

  test("id is unique (no two capabilities share the same id)", () => {
    const ids = PROVIDER_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("displayName is unique (no two capabilities share the same display name)", () => {
    const names = PROVIDER_CAPABILITIES.map((c) => c.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  test("MiMo entry exists and key fields are complete", () => {
    const mimo = getCapability("MiMo");
    expect(mimo).toBeDefined();
    expect(mimo?.id).toBe("mimo");
    expect(mimo?.displayName).toBe("MiMo");
  });

  test("Doubao uses official Ark Chat Completions endpoint", () => {
    expect(getCapability("Doubao")).toMatchObject({
      id: "doubao",
      transport: "openai",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      defaultModel: "doubao-seed-2-1-pro-260628",
    });
    expect(getCapability("Volcengine")).toBeUndefined();
    expect(PROVIDER_CAPABILITIES.some((capability) => capability.id === "volcengine")).toBe(false);
  });
});

describe("PROVIDER_CAPABILITIES — known entry presence regression", () => {
  test("MiniMax defaults to OpenAI-compatible endpoint", () => {
    expect(getCapability("MiniMax")).toMatchObject({
      transport: "openai",
      baseUrl: "https://api.minimaxi.com/v1",
      authStyle: "bearer",
    });
  });

  test("MiniMax default config generates OpenAI chat/completions and Bearer request", () => {
    const cfg = {
      provider: "MiniMax",
      baseUrl: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      apiKey: "test-key",
      explicitTransport: "auto" as const,
    };
    const adapter = getAdapterForConfig(cfg);
    const request = adapter.buildRequest(
      { model: cfg.model, messages: [{ role: "user", content: "ping" }] },
      cfg,
    );

    expect(adapter.transport).toBe("openai");
    expect(request.url).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer test-key");
    expect(request.headers["x-api-key"]).toBeUndefined();
  });

  test("all 9 provider displayNames are in table", () => {
    const names = new Set(PROVIDER_CAPABILITIES.map((c) => c.displayName));
    for (const expected of [
      "MiniMax",
      "DeepSeek",
      "Doubao",
      "GLM",
      "Kimi",
      "Qwen",
      "ChatGPT",
      "Claude",
      "MiMo",
    ]) {
      expect(names.has(expected), `missing displayName: ${expected}`).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { detectTransport, resolveTransport } from "./transport-detector";

describe("detectTransport", () => {
  it("routes to anthropic when path contains /anthropic", () => {
    expect(detectTransport("https://api.minimaxi.com/anthropic")).toBe("anthropic");
  });

  it("handles trailing slash gracefully", () => {
    expect(detectTransport("https://api.minimaxi.com/anthropic/")).toBe("anthropic");
  });

  it("still determines anthropic when other paths follow /anthropic", () => {
    expect(detectTransport("https://example.com/anthropic/v1/something")).toBe("anthropic");
  });

  it("routes to anthropic when path contains /v1/messages (no query)", () => {
    expect(detectTransport("https://api.example.com/v1/messages")).toBe("anthropic");
  });

  it("still determines anthropic when path contains /v1/messages with query", () => {
    expect(detectTransport("https://api.example.com/v1/messages?beta=true")).toBe("anthropic");
  });

  it("heuristic routes to openai when path ends only with /v1", () => {
    expect(detectTransport("https://api.minimaxi.com/v1")).toBe("openai");
  });

  it("routes to openai when path contains /chat/completions", () => {
    expect(detectTransport("https://api.deepseek.com/chat/completions")).toBe("openai");
  });

  it("routes to openai when path is only /completions", () => {
    expect(detectTransport("https://api.example.com/completions")).toBe("openai");
  });

  it("returns null for empty string (indeterminate)", () => {
    expect(detectTransport("")).toBe(null);
  });

  it("returns null for pure domain with no path (capability fallback)", () => {
    expect(detectTransport("https://api.deepseek.com")).toBe(null);
  });

  it("works with uppercase URL (case-insensitive tolerance)", () => {
    expect(detectTransport("HTTPS://API.MINIMAXI.COM/ANTHROPIC")).toBe("anthropic");
  });
});

describe("resolveTransport (three-tier priority)", () => {
  it("explicit anthropic takes precedence over baseUrl", () => {
    // baseUrl is /v1 (heuristic openai), but explicitTransport="anthropic" wins
    expect(
      resolveTransport({
        baseUrl: "https://api.minimaxi.com/v1",
        explicitTransport: "anthropic",
        provider: "MiniMax",
      }),
    ).toBe("anthropic");
  });

  it("explicit openai takes precedence over baseUrl", () => {
    // baseUrl is /anthropic (heuristic anthropic), but explicitTransport="openai" wins
    expect(
      resolveTransport({
        baseUrl: "https://api.minimaxi.com/anthropic",
        explicitTransport: "openai",
        provider: "MiniMax",
      }),
    ).toBe("openai");
  });

  it("explicitTransport=auto -> routes through detectTransport", () => {
    expect(
      resolveTransport({
        baseUrl: "https://api.minimaxi.com/v1",
        explicitTransport: "auto",
        provider: "MiniMax",
      }),
    ).toBe("openai");
  });

  it("explicitTransport=undefined -> routes through detectTransport -> fallback capabilities", () => {
    // DeepSeek baseUrl has no path hint -> null -> capabilities table fallback
    expect(
      resolveTransport({
        baseUrl: "https://api.deepseek.com",
        provider: "DeepSeek",
      }),
    ).toBe("openai");
  });

  it("explicitTransport=undefined + baseUrl heuristic hit -> uses heuristic", () => {
    // MiniMax capabilities default anthropic, but baseUrl /v1 heuristic openai wins
    expect(
      resolveTransport({
        baseUrl: "https://api.minimaxi.com/v1",
        provider: "MiniMax",
      }),
    ).toBe("openai");
  });
});
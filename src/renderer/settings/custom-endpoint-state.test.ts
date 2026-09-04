import { describe, expect, it } from "vitest";
import {
  CUSTOM_ENDPOINT_PROVIDERS,
  DEFAULT_LOCAL_ENDPOINT,
  getCustomEndpointMode,
  getCustomEndpointPresentation,
  getCustomEndpointProvider,
  validateCustomEndpointConfig,
} from "./custom-endpoint-state";

describe("local model defaults", () => {
  it("targets the installed Ollama OpenAI-compatible endpoint without authentication", () => {
    expect(DEFAULT_LOCAL_ENDPOINT).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.1:latest",
    });
    expect(validateCustomEndpointConfig("local", {
      ...DEFAULT_LOCAL_ENDPOINT,
      apiKey: "",
    })).toBeNull();
  });
});

describe("custom endpoint settings state", () => {
  it("uses separate provider keys for cloud and local profiles", () => {
    expect(CUSTOM_ENDPOINT_PROVIDERS.cloud).not.toBe(CUSTOM_ENDPOINT_PROVIDERS.local);
    expect(getCustomEndpointProvider("cloud")).toBe(CUSTOM_ENDPOINT_PROVIDERS.cloud);
    expect(getCustomEndpointProvider("local")).toBe(CUSTOM_ENDPOINT_PROVIDERS.local);
  });

  it("restores the custom endpoint mode from the saved provider", () => {
    expect(getCustomEndpointMode(CUSTOM_ENDPOINT_PROVIDERS.cloud)).toBe("cloud");
    expect(getCustomEndpointMode(CUSTOM_ENDPOINT_PROVIDERS.local)).toBe("local");
    expect(getCustomEndpointMode("MiniMax（稀宇科技）")).toBeNull();
  });

  it("presents cloud endpoints as API-key based OpenAI-compatible services", () => {
    expect(getCustomEndpointPresentation("cloud")).toMatchObject({
      displayName: "Custom Cloud",
      apiKeyOptional: false,
      baseUrlPlaceholder: "https://your-provider.example/v1",
      transport: "openai",
    });
  });

  it("presents local endpoints with an optional key and localhost example", () => {
    expect(getCustomEndpointPresentation("local")).toMatchObject({
      displayName: "Local Model",
      apiKeyOptional: true,
      baseUrlPlaceholder: "http://127.0.0.1:11434/v1",
      transport: "openai",
    });
  });

  it("accepts a valid local endpoint without an API key", () => {
    expect(validateCustomEndpointConfig("local", {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3:8b",
      apiKey: "",
    })).toBeNull();
  });

  it("requires cloud endpoints to provide an API key", () => {
    expect(validateCustomEndpointConfig("cloud", {
      baseUrl: "https://proxy.example.com/v1",
      model: "gpt-compatible",
      apiKey: "",
    })).toBe("Please fill in API Key");
  });

  it.each([
    [{ baseUrl: "", model: "qwen3:8b", apiKey: "" }, "Please fill in Base URL"],
    [{ baseUrl: "127.0.0.1:11434", model: "qwen3:8b", apiKey: "" }, "Base URL must be a complete HTTP(S) address"],
    [{ baseUrl: "ftp://127.0.0.1/model", model: "qwen3:8b", apiKey: "" }, "Base URL must be a complete HTTP(S) address"],
    [{ baseUrl: "http://127.0.0.1:11434/v1", model: "", apiKey: "" }, "Please fill in Model ID"],
  ])("rejects incomplete local endpoint config %#", (config, message) => {
    expect(validateCustomEndpointConfig("local", config)).toBe(message);
  });
});

import { describe, expect, it } from "vitest";
import {
  LOCAL_MODEL_PROVIDER,
  isLoopbackModelBaseUrl,
  isModelEndpointUsable,
  modelAuthorizationHeaders,
} from "./model-endpoint";

describe("model endpoint usability", () => {
  it("allows the explicit local provider without an API key", () => {
    expect(isModelEndpointUsable({
      provider: LOCAL_MODEL_PROVIDER,
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen3:8b",
      apiKey: "",
    })).toBe(true);
  });

  it("allows standalone loopback endpoints without an API key", () => {
    expect(isLoopbackModelBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isModelEndpointUsable({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5vl:7b",
      apiKey: "",
    })).toBe(true);
  });

  it("still requires authentication for cloud and legacy provider profiles", () => {
    expect(isModelEndpointUsable({
      provider: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "",
    })).toBe(false);
    expect(isModelEndpointUsable({
      provider: LOCAL_MODEL_PROVIDER,
      baseUrl: "https://api.example.test/v1",
      model: "cloud-model",
      apiKey: "",
    })).toBe(false);
  });

  it("requires both endpoint and model even for local providers", () => {
    expect(isModelEndpointUsable({ provider: LOCAL_MODEL_PROVIDER, baseUrl: "", model: "qwen3:8b", apiKey: "" })).toBe(false);
    expect(isModelEndpointUsable({ provider: LOCAL_MODEL_PROVIDER, baseUrl: "http://127.0.0.1:11434/v1", model: "", apiKey: "" })).toBe(false);
  });

  it("does not emit an Authorization header for keyless local requests", () => {
    expect(modelAuthorizationHeaders({ apiKey: "" })).toEqual({});
    expect(modelAuthorizationHeaders({ apiKey: " secret " })).toEqual({ Authorization: "Bearer secret" });
  });
});

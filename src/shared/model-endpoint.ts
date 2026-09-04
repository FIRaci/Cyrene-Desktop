export const LOCAL_MODEL_PROVIDER = "Custom Endpoint (Local)";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_OLLAMA_MODEL = "llama3.1:latest";
export const DEFAULT_OLLAMA_VISION_MODEL = "qwen2.5vl:7b";

export function isLocalModelProvider(provider: string): boolean {
  return provider === LOCAL_MODEL_PROVIDER;
}

export function isLoopbackModelBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export interface ModelEndpointConfig {
  provider?: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function isModelEndpointUsable(config: ModelEndpointConfig): boolean {
  if (!config.baseUrl.trim() || !config.model.trim()) return false;
  // A provider label is not a trust boundary. Keyless requests must stay on
  // loopback so a mislabeled cloud endpoint cannot bypass authentication.
  return Boolean(config.apiKey.trim()) || isLoopbackModelBaseUrl(config.baseUrl);
}

export function modelAuthorizationHeaders(config: Pick<ModelEndpointConfig, "apiKey">): Record<string, string> {
  const apiKey = config.apiKey.trim();
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

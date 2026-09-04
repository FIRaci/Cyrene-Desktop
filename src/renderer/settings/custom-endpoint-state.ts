import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  LOCAL_MODEL_PROVIDER,
} from "../../shared/model-endpoint";

export type CustomEndpointMode = "cloud" | "local";

export const CUSTOM_ENDPOINT_PROVIDERS = {
  cloud: "Custom Endpoint (Cloud)",
  local: LOCAL_MODEL_PROVIDER,
} as const;

export const DEFAULT_LOCAL_ENDPOINT = {
  baseUrl: DEFAULT_OLLAMA_BASE_URL,
  model: DEFAULT_OLLAMA_MODEL,
} as const;

export interface CustomEndpointPresentation {
  displayName: string;
  apiKeyOptional: boolean;
  baseUrlPlaceholder: string;
  transport: "openai";
}

export interface CustomEndpointConfigInput {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const PRESENTATION: Record<CustomEndpointMode, CustomEndpointPresentation> = {
  cloud: {
    displayName: "Custom Cloud",
    apiKeyOptional: false,
    baseUrlPlaceholder: "https://your-provider.example/v1",
    transport: "openai",
  },
  local: {
    displayName: "Local Model",
    apiKeyOptional: true,
    baseUrlPlaceholder: "http://127.0.0.1:11434/v1",
    transport: "openai",
  },
};

export function getCustomEndpointProvider(mode: CustomEndpointMode): string {
  return CUSTOM_ENDPOINT_PROVIDERS[mode];
}

export function getCustomEndpointMode(provider: string): CustomEndpointMode | null {
  if (provider === CUSTOM_ENDPOINT_PROVIDERS.cloud) return "cloud";
  if (provider === CUSTOM_ENDPOINT_PROVIDERS.local) return "local";
  return null;
}

export function getCustomEndpointPresentation(mode: CustomEndpointMode): CustomEndpointPresentation {
  return PRESENTATION[mode];
}

export function validateCustomEndpointConfig(
  mode: CustomEndpointMode,
  config: CustomEndpointConfigInput,
): string | null {
  const baseUrl = config.baseUrl.trim();
  if (!baseUrl) return "Please fill in Base URL";

  try {
    const parsed = new URL(baseUrl);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return "Base URL must be a complete HTTP(S) address";
    }
  } catch {
    return "Base URL must be a complete HTTP(S) address";
  }

  if (!config.model.trim()) return "Please fill in Model ID";
  if (mode === "cloud" && !config.apiKey.trim()) return "Please fill in API Key";
  return null;
}

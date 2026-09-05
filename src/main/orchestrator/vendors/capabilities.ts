// Vendor capability table — the single source of truth for vendor adapters.
// Each field follows docs/vendors/tool-calling-matrix.md; unverified matrix items retain conservative defaults.
// displayName must match MODEL_PRESETS.providerName in renderer settings.ts.
import { ProviderCapability } from "./types";

export const PROVIDER_CAPABILITIES = [
  {
    id: "minimax",
    displayName: "MiniMax",
    // Defaults to OpenAI-compatible endpoint; Anthropic endpoint can still be explicitly selected by the user.
    transport: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    authStyle: "bearer",
    defaultModel: "MiniMax-M3",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "cache_control",
    testStrategy: "text",
    // M3 native multimodal (image_url / video_url)
    supportsVision: true,
    // Vision also uses OpenAI-compatible endpoint.
    visionBaseUrl: "https://api.minimaxi.com/v1",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    transport: "openai",
    baseUrl: "https://api.deepseek.com",
    authStyle: "bearer",
    defaultModel: "deepseek-v4-pro",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // Documentation does not indicate vision support for default model
    supportsVision: false,
  },
  {
    id: "doubao",
    displayName: "Doubao",
    transport: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authStyle: "bearer",
    defaultModel: "doubao-seed-2-1-pro-260628",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "none",
    testStrategy: "text",
    supportsVision: true,
  },
  {
    id: "glm",
    displayName: "GLM",
    transport: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authStyle: "bearer",
    defaultModel: "glm-5.2",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // Vision model is glm-5v-turbo; default glm-5.2 does not support vision
    supportsVision: false,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    // OpenAI compatible + prompt_cache_key + function.name regex limits; baseUrl must be .cn
    transport: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    authStyle: "bearer",
    defaultModel: "kimi-k2.7-code",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "prompt_cache_key",
    testStrategy: "text",
    // k2.7-code supports image_url / video_url content blocks
    supportsVision: true,
  },
  {
    id: "qwen",
    displayName: "Qwen",
    transport: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authStyle: "bearer",
    defaultModel: "qwen-max",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // Vision model is qwen-vl series; default qwen-max does not support vision
    supportsVision: false,
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    transport: "openai",
    baseUrl: "https://api.openai.com/v1",
    authStyle: "bearer",
    defaultModel: "",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    // Model specified by user, conservative false; gating checks supportsVision
    supportsVision: false,
  },
  {
    id: "claude",
    displayName: "Claude",
    transport: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authStyle: "x-api-key",
    defaultModel: "claude-sonnet-4-6",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "thinking",
    cacheStrategy: "cache_control",
    testStrategy: "text",
    // Claude supports multimodal image content blocks
    supportsVision: true,
  },
  {
    id: "mimo",
    displayName: "MiMo",
    // Default endpoint: inferred by detectTransport when user switches to /anthropic
    transport: "openai",
    baseUrl: "https://api.xiaomimimo.com/v1",
    // Official docs: both /v1 and /anthropic support Authorization: Bearer
    authStyle: "bearer",
    defaultModel: "mimo-v2.5-pro",
    supportsTools: true,
    supportsThinking: true,
    thinkingField: "reasoning_content",
    cacheStrategy: "auto",
    testStrategy: "text",
    supportsVision: true,
    // Structurally independent: vision still governed by visionBaseUrl when user switches to /anthropic
    visionBaseUrl: "https://api.xiaomimimo.com/v1",
  },
] satisfies readonly ProviderCapability[];

const byDisplayName = new Map(PROVIDER_CAPABILITIES.map(c => [c.displayName, c]));

export function getCapability(provider: string): ProviderCapability | undefined {
  return byDisplayName.get(provider);
}

/** Fallback: Unknown vendors handled as OpenAI compatible (conservatively usable) to prevent crashes. */
export function getCapabilityOrOpenAI(provider: string): ProviderCapability {
  return byDisplayName.get(provider) ?? {
    id: "unknown",
    displayName: provider,
    transport: "openai",
    baseUrl: "",
    authStyle: "bearer",
    defaultModel: "",
    supportsTools: true,
    supportsThinking: false,
    thinkingField: null,
    cacheStrategy: "none",
    testStrategy: "text",
    supportsVision: false,
  };
}

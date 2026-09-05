// Vendor-agnostic reasoning control layer -- types + rules table + resolver + normalize
//
// Scope: reasoning mode auto/off/on + actual existing effort levels only.
// Does not involve temperature / Top-P / max_tokens / verbosity / thinking_budget / Responses API.
//
// Callers:
//   - renderer/settings.ts: UI display and status labels (calls resolveEffectiveReasoning)
//   - main/orchestrator/vendors/*-adapter.ts: transforms request body in buildRequest
//     (calls resolveReasoningCapability + applyReasoningPreference)
//   - main/orchestrator/vendors/reasoning.ts: pure function applyReasoningPreference
//
// providerId must strictly match ProviderCapability.id in main/orchestrator/vendors/capabilities.ts
// exactly: chatgpt / claude / deepseek / glm / kimi / qwen / minimax / mimo / doubao / unknown.
//
// Rule priority: first matching capability takes effect (find() + first-match-wins).
// Ordering principle: specific models first, broad families later (Qwen /-thinking$/ before /^qwen3/;
// Kimi K2.5/K2.6/K2.7-Code/K2.7-Code-HighSpeed must use exact regex, and K2.7 family
// must precede generic kimi-k2-thinking family).

export type ReasoningMode = "auto" | "off" | "on";

export type ReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ReasoningControl =
  | "none"
  | "toggle"
  | "effort"
  | "toggle-effort"
  | "fixed-on"
  | "dynamic";

export type ReasoningRequestStyle =
  | "openai-effort"
  | "thinking-type"
  | "anthropic-adaptive"
  | "qwen-enable-thinking"
  | "none";

export interface ReasoningCapability {
  control: ReasoningControl;
  supportedEfforts?: readonly ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  requestStyle: ReasoningRequestStyle;
  /**
   * Whether this capability supports explicit disable (off).
   * OpenAI models declare per specific rules (gpt-5.6 = true, o1 = true, gpt-4o fallback = false).
   * When supportsDisable=false, UI does not show "off" option, and request does not send reasoning_effort:"none".
   */
  supportsDisable: boolean;
  /**
   * Only applicable to thinking-type: whether to attach thinking.keep="all" when on + hasTools.
   * Kimi K2.6 = true；K2.5 = false。
   */
  keepOnTools?: boolean;
}

export interface ReasoningPreference {
  mode: ReasoningMode;
  effort?: ReasoningEffort;
}

export interface ModelReasoningRule {
  providerId: string;
  modelPattern: RegExp;
  capability: ReasoningCapability;
}

/** Fallback capability: unknown provider / model */
const UNKNOWN_CAPABILITY: ReasoningCapability = {
  control: "none",
  requestStyle: "none",
  supportsDisable: false,
};

/**
 * 9 vendor rule tables. First matching capability takes effect.
 *
 * Before updating this table please synchronize:
 *   - src/shared/reasoning.test.ts (A. Rule match priority + B. All 9 vendors presence)
 *   - reasoning-control-layer-design docs
 */
export const MODEL_REASONING_RULES: readonly ModelReasoningRule[] = [
  // ── chatgpt（OpenAI）──
  // Split by specific model; GPT-5.6 Chat Completions accepts low/medium/high/xhigh/max
  // (excluding minimal); supportsDisable=true, off -> reasoning_effort:"none".
  { providerId: "chatgpt", modelPattern: /^gpt-5\.6/i, capability: {
    control: "effort",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
    requestStyle: "openai-effort",
    supportsDisable: true,
  } },
  { providerId: "chatgpt", modelPattern: /^gpt-5/i, capability: {
    control: "effort",
    supportedEfforts: ["minimal", "low", "medium", "high"],
    defaultEffort: "medium",
    requestStyle: "openai-effort",
    supportsDisable: true,
  } },
  { providerId: "chatgpt", modelPattern: /^o1/i, capability: {
    control: "effort",
    supportedEfforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    requestStyle: "openai-effort",
    supportsDisable: true,
  } },
  { providerId: "chatgpt", modelPattern: /^o3/i, capability: {
    control: "effort",
    supportedEfforts: ["low", "medium", "high"],
    defaultEffort: "medium",
    requestStyle: "openai-effort",
    supportsDisable: true,
  } },
  { providerId: "chatgpt", modelPattern: /^o4/i, capability: {
    control: "effort",
    supportedEfforts: ["medium", "high"],
    defaultEffort: "medium",
    requestStyle: "openai-effort",
    supportsDisable: true,
  } },
  { providerId: "chatgpt", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── claude（Anthropic）──
  { providerId: "claude", modelPattern: /^claude-fable-5/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    requestStyle: "anthropic-adaptive",
    supportsDisable: true,
  } },
  { providerId: "claude", modelPattern: /^claude-sonnet-5/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    requestStyle: "anthropic-adaptive",
    supportsDisable: true,
  } },
  { providerId: "claude", modelPattern: /^claude-opus-4-(8|7|6)/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    requestStyle: "anthropic-adaptive",
    supportsDisable: true,
  } },
  { providerId: "claude", modelPattern: /^claude-sonnet-4-6/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "high",
    requestStyle: "anthropic-adaptive",
    supportsDisable: true,
  } },
  { providerId: "claude", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── deepseek ──
  { providerId: "deepseek", modelPattern: /^deepseek-v4/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["high", "max"],
    defaultEffort: "high",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "deepseek", modelPattern: /^deepseek-(chat|reasoner)$/i, capability: UNKNOWN_CAPABILITY },
  { providerId: "deepseek", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── glm (Zhipu) ──
  // Specific models first; base glm-5 placed after specific models as fallback.
  { providerId: "glm", modelPattern: /^glm-5\.2/i, capability: {
    control: "toggle-effort",
    supportedEfforts: ["high", "max"],
    defaultEffort: "high",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /^glm-5-turbo$/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /^glm-5v-turbo$/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /^glm-5\.1/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /^glm-5/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /^glm-(4\.5|4\.6|4\.7)/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "glm", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── qwen (Tongyi Qianwen) ──
  // /-thinking$/ must precede /^qwen3/.
  { providerId: "qwen", modelPattern: /-thinking$/i, capability: {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  } },
  { providerId: "qwen", modelPattern: /^qwen3/i, capability: {
    control: "toggle",
    requestStyle: "qwen-enable-thinking",
    supportsDisable: true,
  } },
  { providerId: "qwen", modelPattern: /^qwen-(max|plus|turbo)/i, capability: {
    control: "toggle",
    requestStyle: "qwen-enable-thinking",
    supportsDisable: true,
  } },
  { providerId: "qwen", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── kimi (Moonshot) ──
  // K2.7-Code / K2.7-Code-HighSpeed must use exact regex ($-anchor),
  // and precede generic kimi-k2-thinking family.
  { providerId: "kimi", modelPattern: /^kimi-k2\.7-code-highspeed$/i, capability: {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  } },
  { providerId: "kimi", modelPattern: /^kimi-k2\.7-code$/i, capability: {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  } },
  { providerId: "kimi", modelPattern: /^kimi-k2\.6/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
    keepOnTools: true,
  } },
  { providerId: "kimi", modelPattern: /^kimi-k2\.5/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
    keepOnTools: false,
  } },
  { providerId: "kimi", modelPattern: /^kimi-k2-thinking/i, capability: {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  } },
  { providerId: "kimi", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── minimax (MiniMax) ──
  // M3 uses anthropic-adaptive (on=adaptive / off=disabled), not generic thinking-type path.
  { providerId: "minimax", modelPattern: /^MiniMax-M3/i, capability: {
    control: "toggle",
    requestStyle: "anthropic-adaptive",
    supportsDisable: true,
  } },
  { providerId: "minimax", modelPattern: /^MiniMax-M2\./i, capability: {
    control: "fixed-on",
    requestStyle: "none",
    supportsDisable: false,
  } },
  { providerId: "minimax", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── mimo (Xiaomi) ──
  // Shared across transports: both OpenAI and Anthropic endpoints generate thinking.type.
  { providerId: "mimo", modelPattern: /^mimo-v2\./i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "mimo", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },

  // ── doubao (Volcengine) ──
  { providerId: "doubao", modelPattern: /^doubao-seed-/i, capability: {
    control: "toggle",
    requestStyle: "thinking-type",
    supportsDisable: true,
  } },
  { providerId: "doubao", modelPattern: /.*/, capability: UNKNOWN_CAPABILITY },
];

/**
 * Resolves reasoning capability by (providerId, model).
 * Returns fallback { control: "none", requestStyle: "none", supportsDisable: false } when no rule matches.
 */
export function resolveReasoningCapability(
  providerId: string,
  model: string,
): ReasoningCapability {
  for (const rule of MODEL_REASONING_RULES) {
    if (rule.providerId === providerId && rule.modelPattern.test(model)) {
      return rule.capability;
    }
  }
  return UNKNOWN_CAPABILITY;
}

/**
 * Resolves user preference to effective preference.
 *
 * Decision sequence (revision #3):
 * 1. control = none / dynamic -> forced auto
 * 2. control = fixed-on -> always returns { mode: "on" }, ignores pref.mode and pref.effort
 * 3. control ∈ {toggle, effort, toggle-effort}：
 *    - mode !== "on" -> returns { mode } directly without keeping effort
 *    - mode === "on": if effort not in supportedEfforts -> fall back to defaultEffort;
 *      if effort omitted fill defaultEffort; if defaultEffort also not supported -> drop effort
 *
 * Note: saved is never modified, effective is only used for runtime requests and UI display.
 */
export function resolveEffectiveReasoning(
  preference: ReasoningPreference | undefined,
  capability: ReasoningCapability,
): ReasoningPreference {
  const pref = preference ?? { mode: "auto" };

  // 1. Unsupported / dynamic routing -> forced auto
  if (capability.control === "none" || capability.control === "dynamic") {
    return { mode: "auto" };
  }

  // 2. fixed-on: effective always on
  if (capability.control === "fixed-on") {
    return { mode: "on" };
  }

  // 3. toggle / effort / toggle-effort
  const { mode } = pref;

  // mode !== "on" -> do not preserve effort
  if (mode !== "on") {
    return { mode };
  }

  let { effort } = pref;

  // effort not in supportedEfforts -> fall back to defaultEffort
  if (effort !== undefined && capability.supportedEfforts && !capability.supportedEfforts.includes(effort)) {
    effort = capability.defaultEffort;
  }

  // if effort omitted fill defaultEffort
  if (effort === undefined && capability.defaultEffort) {
    effort = capability.defaultEffort;
  }

  return { mode, ...(effort !== undefined ? { effort } : {}) };
}

// ── normalize allowlist (allowlist, no trim) ──

const MODE_SET: ReadonlySet<ReasoningMode> = new Set(["auto", "off", "on"]);
const EFFORT_SET: ReadonlySet<ReasoningEffort> = new Set([
  "minimal", "low", "medium", "high", "xhigh", "max",
]);

/**
 * Normalizes arbitrary input to valid { mode, effort? }.
 * - Completely invalid object -> undefined
 * - Invalid mode -> undefined
 * - Valid mode but invalid effort -> return { mode }, discard effort field
 * - Fully valid -> as-is
 */
export function normalizeReasoningPreference(
  input: unknown,
): { mode: ReasoningMode; effort?: ReasoningEffort } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as { mode?: unknown; effort?: unknown };
  if (typeof obj.mode !== "string" || !MODE_SET.has(obj.mode as ReasoningMode)) {
    return undefined;
  }
  const mode = obj.mode as ReasoningMode;
  if (obj.effort === undefined || obj.effort === null) {
    return { mode };
  }
  if (typeof obj.effort !== "string" || !EFFORT_SET.has(obj.effort as ReasoningEffort)) {
    return { mode };
  }
  return { mode, effort: obj.effort as ReasoningEffort };
}

/**
 * Persistence fold:
 *
 * Semantics:
 * - hasIncomingKey=false (field missing) -> keep old value (no overwrite)
 * - hasIncomingKey=true and incomingRaw is undefined / null -> user cleared -> return undefined
 * - hasIncomingKey=true and incomingRaw is invalid -> normalize undefined -> keep old value (guard overwrite)
 * - hasIncomingKey=true and valid object -> use new value
 *
 * Caller is responsible for passing correct hasIncomingKey.
 * hasOwnProperty is the standard way to check for missing fields.
 */
export function foldReasoning(
  incomingRaw: unknown,
  existing: ReasoningPreference | undefined,
  hasIncomingKey: boolean,
): ReasoningPreference | undefined {
  if (!hasIncomingKey) return existing;
  if (incomingRaw === undefined || incomingRaw === null) return undefined;
  const normalized = normalizeReasoningPreference(incomingRaw);
  if (normalized === undefined) return existing;
  return normalized;
}

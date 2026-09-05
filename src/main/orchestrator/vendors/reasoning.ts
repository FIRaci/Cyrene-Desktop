// Vendor wire body reasoning control transformation -- pure function.
//
// Does not maintain rule tables or read cfg (capability is passed in by adapter).
// Called within adapter buildRequest:
//   const cap = resolveReasoningCapability(this.capability.id, cfg.model);
//   const finalBody = applyReasoningPreference(body, cfg.reasoning ?? {mode:"auto"}, cap, ctx);
//
// Decision tree in reasoning control layer design §6.2.
// Key invariants:
//   - Does not modify input body, returns new object
//   - auto adds no fields
//   - Unsupported effort rolled back to defaultEffort in resolveEffectiveReasoning
//     (applyReasoningPreference trusts the passed preference)
//   - When supportsDisable=false, off does not send reasoning_effort:"none"
//   - fixed-on always has effective.mode on,
//     so applyReasoningPreference treats it directly as on
//   - Mutex field guard: each requestStyle uses only its dedicated field
//   - Logs record only provider / model / requested / effective mode-effort; never apiKey, messages, or reasoning

import {
  resolveEffectiveReasoning,
  type ReasoningCapability,
  type ReasoningPreference,
} from "../../../shared/reasoning";

export interface ApplyReasoningContext {
  hasTools: boolean;
  providerId: string;
  model: string;
}

export function applyReasoningPreference(
  body: Record<string, unknown>,
  preference: ReasoningPreference,
  capability: ReasoningCapability,
  context: ApplyReasoningContext,
): Record<string, unknown> {
  const effective = resolveEffectiveReasoning(preference, capability);
  const result: Record<string, unknown> = { ...body };

  // Log
  const requestedStr = `${preference.mode}/${preference.effort ?? "-"}`;
  const effectiveStr = `${effective.mode}/${effective.effort ?? "-"}`;
  if (requestedStr !== effectiveStr) {
    console.log(
      `[reasoning] provider=${context.providerId} model=${context.model} ` +
      `requested=${requestedStr} effective=${effectiveStr}`,
    );
  }

  // none / dynamic: unsupported capability -> do not modify body
  if (capability.control === "none" || capability.control === "dynamic") {
    return result;
  }

  // 1. fixed-on: effective.mode always on; inject enabled field per requestStyle
  if (capability.control === "fixed-on") {
    switch (capability.requestStyle) {
      case "thinking-type":
        result.thinking = { type: "enabled" };
        break;
      case "anthropic-adaptive":
        result.thinking = { type: "adaptive" };
        break;
      case "qwen-enable-thinking":
        result.enable_thinking = true;
        break;
      case "openai-effort":
      case "none":
        // Do not inject fields (K2.7-Code / K2.7-Code-HighSpeed / M2.x)
        break;
      default: {
        const _exhaustive: never = capability.requestStyle;
        throw new Error(`unsupported requestStyle: ${String(_exhaustive)}`);
      }
    }
    return result;
  }

  // 2. auto: do not add any field
  if (effective.mode === "auto") {
    return result;
  }

  // 3. off: inject disable fields per control + requestStyle
  if (effective.mode === "off") {
    switch (capability.control) {
      case "toggle":
        applyToggleOff(result, capability);
        break;
      case "effort":
        // supportsDisable=false -> send no fields
        if (capability.supportsDisable) {
          result.reasoning_effort = "none";
        }
        break;
      case "toggle-effort":
        // toggle-effort off always sends disable field (thinking.type = disabled)
        // If requestStyle=openai-effort and supportsDisable=false, do not send reasoning_effort
        applyToggleEffortOff(result, capability);
        break;
      default:
        // fixed-on / none / dynamic already handled above
        break;
    }
    return result;
  }

  // 4. on: inject enable fields per control + requestStyle
  if (effective.mode === "on") {
    switch (capability.control) {
      case "toggle":
        applyToggleOn(result, capability, context);
        break;
      case "effort": {
        let effort = effective.effort ?? capability.defaultEffort ?? "medium";
        if (effective.effort !== undefined && capability.supportedEfforts && !capability.supportedEfforts.includes(effective.effort)) {
          effort = capability.defaultEffort ?? effort;
        }
        result.reasoning_effort = effort;
        break;
      }
      case "toggle-effort":
        applyToggleEffortOn(result, capability, effective, context);
        break;
      default:
        break;
    }
    return result;
  }

  return result;
}

// -- Helper functions --

function applyToggleOff(result: Record<string, unknown>, cap: ReasoningCapability): void {
  switch (cap.requestStyle) {
    case "qwen-enable-thinking":
      result.enable_thinking = false;
      break;
    case "thinking-type":
      result.thinking = { type: "disabled" };
      break;
    case "anthropic-adaptive":
      result.thinking = { type: "disabled" };
      break;
    case "openai-effort":
    case "none":
      // Theoretically unreachable
      break;
  }
}

function applyToggleOn(
  result: Record<string, unknown>,
  cap: ReasoningCapability,
  context: ApplyReasoningContext,
): void {
  switch (cap.requestStyle) {
    case "qwen-enable-thinking":
      result.enable_thinking = true;
      break;
    case "thinking-type": {
      const keep = cap.keepOnTools === true && context.hasTools;
      result.thinking = keep ? { type: "enabled", keep: "all" } : { type: "enabled" };
      break;
    }
    case "anthropic-adaptive":
      result.thinking = { type: "adaptive" };
      break;
    case "openai-effort":
    case "none":
      // Theoretically unreachable
      break;
  }
}

function applyToggleEffortOff(result: Record<string, unknown>, cap: ReasoningCapability): void {
  switch (cap.requestStyle) {
    case "openai-effort":
      // Do not send when supportsDisable=false
      if (cap.supportsDisable) {
        result.reasoning_effort = "none";
      }
      break;
    case "thinking-type":
      result.thinking = { type: "disabled" };
      break;
    case "anthropic-adaptive":
      result.thinking = { type: "disabled" };
      // Do not send reasoning_effort / output_config.effort
      break;
    case "qwen-enable-thinking":
    case "none":
      // Theoretically unreachable
      break;
  }
}

function applyToggleEffortOn(
  result: Record<string, unknown>,
  cap: ReasoningCapability,
  effective: ReasoningPreference,
  context: ApplyReasoningContext,
): void {
  let effort = effective.effort ?? cap.defaultEffort ?? "medium";
  // Safety net: if effective.effort not in supportedEfforts -> fallback to defaultEffort
  if (effective.effort !== undefined && cap.supportedEfforts && !cap.supportedEfforts.includes(effective.effort)) {
    effort = cap.defaultEffort ?? effort;
  }
  switch (cap.requestStyle) {
    case "openai-effort":
      result.reasoning_effort = effort;
      break;
    case "thinking-type": {
      const keep = cap.keepOnTools === true && context.hasTools;
      result.thinking = keep ? { type: "enabled", keep: "all" } : { type: "enabled" };
      result.reasoning_effort = effort;
      break;
    }
    case "anthropic-adaptive":
      result.thinking = { type: "adaptive" };
      // Merge existing output_config without overwriting
      const existingOutputConfig = (result.output_config ?? {}) as Record<string, unknown>;
      result.output_config = { ...existingOutputConfig, effort };
      break;
    case "qwen-enable-thinking":
    case "none":
      // Theoretically unreachable
      break;
  }
}
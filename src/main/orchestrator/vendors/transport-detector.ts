// Transport detection -- heuristics to determine OpenAI vs Anthropic protocol from baseUrl.
//
// Motivation: transport was previously hardcoded from provider name -> capabilities table,
// so modifying baseUrl in settings had no effect on dispatch (e.g. MiniMax using /v1 still using anthropic endpoint).
// Now three-tiered priority:
//   1. User explicit explicitTransport (advanced setting in settings UI)
//   2. baseUrl heuristics (detectTransport)
//   3. capabilities table default (fallback compatible with presets)
//
// Heuristic rules:
//   - Path contains /anthropic or /v1/messages -> anthropic
//   - Path contains /chat/completions or /completions -> openai
//   - Ends with /v1 -> openai (vast majority of OpenAI-compatible endpoints)
//   - Other -> null, allowing caller to fallback

import type { Transport } from "./types";
import { getCapabilityOrOpenAI } from "./capabilities";

/**
 * Determine transport based on baseUrl path patterns; returns null if indeterminate.
 * Pure function for easy testing.
 */
export function detectTransport(baseUrl: string): Transport | null {
  const t = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  if (!t) return null;
  // Anthropic endpoint path keywords
  if (/\/anthropic($|\/)|\/v1\/messages($|\?)/.test(t)) return "anthropic";
  // OpenAI endpoint path keywords
  if (/\/chat\/completions($|\?)|\/completions($|\?)|\/v1\/chat/.test(t)) return "openai";
  // Ending with /v1 -> heuristically judged as openai
  if (t.endsWith("/v1")) return "openai";
  return null;
}

/**
 * Three-tiered priority transport resolution, used by getAdapterForConfig.
 *  - explicitTransport = "openai" | "anthropic" -> user forced
 *  - explicitTransport = "auto" | undefined -> detectTransport -> fallback capabilities
 */
export function resolveTransport(cfg: {
  baseUrl: string;
  explicitTransport?: Transport | "auto" | undefined;
  provider: string;
}): Transport {
  if (cfg.explicitTransport === "openai" || cfg.explicitTransport === "anthropic") {
    return cfg.explicitTransport;
  }
  // auto or undefined both use detection + fallback
  return detectTransport(cfg.baseUrl) ?? getCapabilityOrOpenAI(cfg.provider).transport;
}
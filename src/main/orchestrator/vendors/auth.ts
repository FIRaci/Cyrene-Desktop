// Vendor authentication header abstraction -- decouples transport and authStyle
//
// Motivation: previously OpenAI/Anthropic adapters each hardcoded auth header names
// (OpenAI hardcoded Authorization: Bearer, Anthropic hardcoded x-api-key),
// preventing Anthropic transport from using Bearer and vice versa.
// Now authHeaderFor(cap, apiKey) generates headers based on capability.authStyle,
// so Anthropic transport + bearer is also valid (e.g. MiMo /anthropic endpoint).
//
// If cap.authStyle is not a valid value at runtime, throw an explicit config error.
// Do not silently omit auth header--that would result in an ambiguous 401 error,
// making it hard to diagnose whether capability was misconfigured or apiKey was invalid.
import type { ProviderCapability } from "./types";

export function authHeaderFor(
  cap: ProviderCapability,
  apiKey: string,
): Record<string, string> {
  // Local OpenAI-compatible runtimes such as Ollama commonly require no auth.
  if (!apiKey.trim()) return {};
  switch (cap.authStyle) {
    case "x-api-key":
      return { "x-api-key": apiKey };
    case "bearer":
      return { Authorization: `Bearer ${apiKey}` };
    default:
      throw new Error(
        `[vendors/auth] Provider "${cap.displayName}" has invalid authStyle: ` +
          `${JSON.stringify(cap.authStyle)} (expected "bearer" | "x-api-key")`,
      );
  }
}

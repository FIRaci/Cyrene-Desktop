import type { ToolExecutionOutcome } from "./types";

/**
 * Sole entry point for completion semantics derivation. All consumers of ToolExecutionOutcome should call this first.
 *
 * Defaults (revision item 1):
 * - Any tool call (success or failure) is treated as finished: terminal defaults to true.
 *   Argument errors, permission denials, expired ContextRefs, etc., should not automatically retry.
 * - Failures default to non-retryable: retryable defaults to false.
 *   Only when a tool explicitly determines transient error (network timeout, rate limit) does it return retryable=true.
 */
export function normalizeToolExecutionOutcome(
  outcome: ToolExecutionOutcome,
): ToolExecutionOutcome & { terminal: boolean; retryable: boolean } {
  return {
    ...outcome,
    terminal: outcome.terminal ?? true,
    retryable: outcome.retryable ?? false,
  };
}

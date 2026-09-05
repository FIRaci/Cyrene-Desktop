// Orchestrator types

// ToolCallResult: Result of a single tool call
export interface ToolCallResult {
  toolId: string;
  args: Record<string, unknown>;
  output: string;
  status: "succeeded" | "failed";
  errorCode?: string;
  // Completion semantics: whether tool step has ended (defaults to true, derived by normalizer)
  terminal?: boolean;
  // Completion semantics: whether failure warrants retry (defaults to false, derived by normalizer)
  retryable?: boolean;
  // Call was not actually executed; hit ExecutionLedger cache
  deduplicated?: boolean;
  /** false means the failure happened before Tool Runtime was invoked. */
  toolExecuted?: false;
  /** Stable capability identifier (derived from ToolDefinition.capability ?? toolId) */
  capabilityId?: string;
  /** Plan mode: parent plan ID */
  planId?: string;
  /** Plan mode: parent step ID */
  stepId?: string;
  /** Plan mode: step execution cycle ID (covers entire step from start to completion/failure) */
  stepExecutionId?: string;
  /** Plan mode: single act attempt ID */
  stepAttemptId?: string;
}

export interface ToolExecutionOutcome {
  output: string;
  status: "succeeded" | "failed";
  errorCode?: string;
  // Completion semantics: whether tool step has ended (defaults to true, derived by normalizer)
  terminal?: boolean;
  // Completion semantics: whether failure warrants retry (defaults to false, derived by normalizer)
  retryable?: boolean;
}

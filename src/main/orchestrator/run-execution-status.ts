/**
 * Runtime execution status - Independent module avoiding cyrene-agent <-> langgraph-agent-loop circular dependencies.
 *
 * Responsibilities:
 * - Defines RunPhase, SuccessfulToolExecution, CreatedArtifact, RunExecutionStatus
 * - Provides snapshotRunExecutionStatus immutable snapshot
 * - Defines AgentExecutionError (carrying executionStatus + original cause)
 */

// -- Phase types --

/** Execution phase (unified definition, maps legacy node names) */
export type RunPhase =
  | "context"
  | "cita"
  | "router"
  | "create_plan"
  | "action_gate"
  | "native_fc"
  | "tool_execute"
  | "plan_verify"
  | "plan_replan"
  | "soul"
  | "unknown";

// -- Safe compact tool execution record --

/** Safe summary of successful tool (does not contain full output) */
export interface SuccessfulToolExecution {
  capabilityId: string;
  actionLabel: string;
  completionClaims: string[];
}

/** Trusted file artifact */
export interface CreatedArtifact {
  path: string;
  kind?: "docx" | "pdf" | "xlsx" | "markdown" | "file";
  capabilityId: string;
}

// -- Execution status --

export interface RunExecutionStatus {
  phase: RunPhase;
  successfulTools: SuccessfulToolExecution[];
  createdArtifacts: CreatedArtifact[];
  /**
   * Whether the overall task is confirmed complete.
   * Sole sources:
   *   - taskPlan?.status === "completed"
   *   - directExecutionCompletionConfirmed === true (Action Gate routes to respond + all completion evidence satisfied)
   * Cannot be inferred from createdArtifacts, count of successful tools, or entering Soul.
   */
  taskCompletionConfirmed: boolean;
}

/** Creates immutable snapshot (prevents subsequent mutations from polluting error object) */
export function snapshotRunExecutionStatus(status: RunExecutionStatus): RunExecutionStatus {
  return {
    phase: status.phase,
    successfulTools: status.successfulTools.map((t) => ({
      capabilityId: t.capabilityId,
      actionLabel: t.actionLabel,
      completionClaims: [...t.completionClaims],
    })),
    createdArtifacts: status.createdArtifacts.map((a) => ({ ...a })),
    taskCompletionConfirmed: status.taskCompletionConfirmed,
  };
}

// -- Error types --

/** Error carrying execution status (retaining original cause) */
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly executionStatus: RunExecutionStatus,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentExecutionError";
  }
}

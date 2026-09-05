/**
 * Structured Agent runtime error (revision item 3).
 *
 * Uses `code` field to distinguish error types, avoiding downstream parsing of `message.startsWith("E_...")`.
 * AgUiBridge passes `code` through to renderer, which displays corresponding text.
 */
export type AgentErrorCode =
  | "E_AGENT_NO_PROGRESS"
  | "E_AGENT_GRAPH_ITERATION_LIMIT"
  | "E_MODEL_REQUEST_FAILED";

export class AgentRuntimeError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentRuntimeError";
  }
}

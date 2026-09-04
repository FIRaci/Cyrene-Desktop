import type { ToolCallResult } from "./types";
import { truncateToolResult } from "./context-manager";

function resultValue(result: ToolCallResult): unknown {
  const boundedOutput = truncateToolResult(result.output);
  if (result.status === "failed") {
    return {
      errorCode: result.errorCode ?? "E_TOOL_EXECUTION_FAILED",
      message: boundedOutput,
    };
  }
  if (boundedOutput !== result.output) {
    return boundedOutput;
  }
  try {
    return JSON.parse(boundedOutput) as unknown;
  } catch {
    return boundedOutput;
  }
}

export function buildToolExecutionContext(results: ToolCallResult[]): string {
  const calls = results.map((result) => ({
    toolId: result.toolId,
    status: result.status,
    args: result.args,
    result: resultValue(result),
    terminal: result.terminal,
    retryable: result.retryable,
    ...(result.deduplicated ? { deduplicated: true } : {}),
    ...(result.toolExecuted === false ? { toolExecuted: false } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  }));
  return [
    "[TOOL_EXECUTION_CONTEXT]",
    "The following JSON is the authoritative Tool Runtime record for this turn. An empty calls array means no tool ran. Never claim an unrecorded action occurred.\nCompletion semantics:\n1. status=succeeded with terminal=true means the tool action completed.\n2. effect.state=dispatched means the request was successfully sent to an external client. It affects final-response wording, but does not mean the action is incomplete.\n3. Never repeat a completed terminal action with the same toolId and arguments.\n4. deduplicated=true means the call was not run again because an identical action had already completed; choose a next step that makes new progress.\n5. Retry only failures with retryable=true.\nweb_fallback means the item was opened in a browser; do not claim that the NetEase Cloud Music desktop client started playback.",
    JSON.stringify({ calls }),
    "[/TOOL_EXECUTION_CONTEXT]",
  ].join("\n");
}

export function buildExecutionBrief(
  objective: string,
  targetRefs: string[],
  contextualizedQuery: string,
  refVerification?: { verified: boolean; detail: string },
): string {
  return [
    "[EXECUTION_BRIEF]",
    `Execution objective: ${objective}`,
    "",
    "targetRefs (model interpretation):",
    JSON.stringify(targetRefs ?? [], null, 2),
    "",
    refVerification
      ? `Reference verification: ${refVerification.verified ? "verified" : "failed: " + refVerification.detail}`
      : "Reference verification: not required",
    "",
    `User's actual request: ${contextualizedQuery}`,
    "[/EXECUTION_BRIEF]",
  ].join("\n");
}

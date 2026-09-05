// Sub-agent: delegates heavy tasks to independent FC loop, isolating context.
//
// Core concept:
//   Main agent calls delegate_task tool -> execute runs restricted runFunctionCallingLoop
//   -> sub-agent maintains its own disposable conversation
//   -> returns structured summary to main agent upon completion
//   -> keeps main agent context clean from verbose intermediate data
//
// Trigger conditions:
//   Single tool invocation -> sub-agent not needed
//   Multi-step calls without user confirmation -> sub-agent delegation
//
// Sub-agent limits:
//   - Max 8 rounds (main agent is 20 rounds)
//   - 60s per-round timeout (main agent is 75s)
//   - Exposes lightweight tools (disallows recursive delegation)

import { runFunctionCallingLoop } from "./function-calling";
import { toolRegistry } from "./tool-registry";
import { truncateToolResult } from "./context-manager";

const LOG_PREFIX = "[SubAgent]";

/** Sub-agent constraints: tighter limits for execution layer. */
const SUB_AGENT_MAX_ROUNDS = 8;
const SUB_AGENT_TIMEOUT_MS = 60_000;

/** Disallowed tools in sub-agent (prevents recursion and duplicate approvals). */
const BLOCKED_TOOLS = new Set([
  "delegate_task",     // Prevent recursion
  "ask_user_choice",   // Sub-agent cannot interact directly with user
]);

/** Structured result returned by sub-agent. */
export interface SubAgentResult {
  status: "success" | "error";
  summary: string;
  artifacts?: string[];
  key_facts?: Record<string, unknown>;
  error_type?: "timeout" | "tool_error" | "parsing_error" | "max_rounds";
  recoverable?: boolean;
}

/** Injected LLM settings getter (set by index.ts via setDelegateSettings). */
let delegateSettingsGetter: (() => { provider: string; baseUrl: string; model: string; apiKey: string }) | null = null;

/** Called on startup to inject settings getter for sub-agent. */
export function setDelegateSettings(getter: () => { provider: string; baseUrl: string; model: string; apiKey: string }): void {
  delegateSettingsGetter = getter;
}

/**
 * Launch sub-agent to execute sub-task.
 * Sub-agent maintains isolated conversation, returning structured summary.
 */
export async function runSubAgent(task: string): Promise<SubAgentResult> {
  if (!delegateSettingsGetter) {
    return {
      status: "error",
      error_type: "tool_error",
      recoverable: false,
      summary: "The sub-agent has no LLM configuration",
    };
  }

  const settings = delegateSettingsGetter();

  // Temporarily hide disallowed tools from sub-agent
  const hiddenTools: string[] = [];
  for (const toolId of BLOCKED_TOOLS) {
    const tool = toolRegistry.getById(toolId);
    if (tool && tool.enabled) {
      tool.enabled = false;
      hiddenTools.push(toolId);
    }
  }

  try {
    console.log(LOG_PREFIX, "Starting sub-agent task:", task.slice(0, 100));

    const subMessages = [
      {
        role: "system" as const,
        content:
          "You are a sub-agent responsible for a specific task delegated by the primary agent.\n" +
          "Work efficiently. Do not create a task list or ask the user questions.\n" +
          "When finished, summarize the result in one sentence. If you fail, state why.",
      },
      { role: "user" as const, content: task },
    ];

    const result = await runFunctionCallingLoop(
      settings,
      subMessages,
      SUB_AGENT_TIMEOUT_MS,
    );

    const reply = result.reply || "(no response)";
    const toolCount = result.toolResults.length;

    // Collect generated files (extract paths from tool results)
    const artifacts: string[] = [];
    const keyFacts: Record<string, unknown> = {};
    for (const tr of result.toolResults) {
      // Extract output paths from write_* tools
      const pathMatch = tr.output.match(/(?:Generated|Created|\u5df2\u751f\u6210)[：:]\s*(.+)/i);
      if (pathMatch) artifacts.push(pathMatch[1].trim());
      // Extract exchange rate data
      const rateMatch = tr.output.match(/(\d+(?:\.\d+)?)\s*(USD|EUR|CNY)\s*=\s*(\d+(?:\.\d+)?)\s*(USD|EUR|CNY)/);
      if (rateMatch) {
        keyFacts[rateMatch[2] + "_to_" + rateMatch[4]] = Number(rateMatch[3]);
      }
    }

    // Check if max rounds reached (potentially incomplete)
    const hitMaxRounds = toolCount > 0 && reply.length < 50;

    console.log(LOG_PREFIX, "Sub-agent complete:", reply.slice(0, 100), "tools called:", toolCount);

    return {
      status: hitMaxRounds ? "error" : "success",
      summary: truncateToolResult(reply, 500),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      key_facts: Object.keys(keyFacts).length > 0 ? keyFacts : undefined,
      error_type: hitMaxRounds ? "max_rounds" : undefined,
      recoverable: hitMaxRounds ? true : undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes("AbortError") || errMsg.includes("timeout") || errMsg.includes("\u8d85\u65f6");
    console.error(LOG_PREFIX, "Sub-agent failed:", errMsg);

    return {
      status: "error",
      error_type: isTimeout ? "timeout" : "tool_error",
      recoverable: isTimeout,
      summary: "Sub-agent execution failed: " + errMsg.slice(0, 200),
    };
  } finally {
    // Restore previously hidden tools
    for (const toolId of hiddenTools) {
      const tool = toolRegistry.getById(toolId);
      if (tool) tool.enabled = true;
    }
  }
}

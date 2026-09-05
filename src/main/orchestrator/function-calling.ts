// Function Calling -- vendor-agnostic function calling loop
// Orchestrator relies only on unified adapter return structures (buildRequest / parseResponse / appendToolResults),
// never if (provider === "xxx"). Add new vendors in capabilities.ts + transport adapter.
import { isCompanionSafeTool, toolRegistry, ToolDefinition } from "./tool-registry";
import { ToolCallResult } from "./types";
import { checkPermission, ToolRiskLevel } from "../permission";
import {
  getAdapter,
  type ChatMessage,
  type ChatRequest,
  type ToolExecutionResult,
  type ToolSpec,
} from "./vendors";
import { extractLastUserQuery, type ToolContext } from "./tool-context";
import { recordUsage } from "../token-usage-store";
import { resetReadRefs } from "../skills/skill-tools";
import { truncateToolResult, compressConversation } from "./context-manager";

const LOG_PREFIX = "[FunctionCalling]";
const MAX_TOOL_ROUNDS = 20; // Multi-step tasks may require multiple rounds; fallback summary triggered at ceiling
const PER_ROUND_TIMEOUT_MS = 75000; // Per-round timeout relaxed to 75s for reasoning models with thinking
const FORCE_SUMMARY_TIMEOUT_MS = 90000; // Forced summary fallback timeout relaxed to 90s
// Exit on consecutive timeouts to prevent runaway loops.
// Fallback to forced summary after MAX_CONSECUTIVE_TIMEOUTS consecutive timeouts.
const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** Vendor config passed by orchestration layer. */
interface LoopSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Convert ToolRegistry tools to unified ToolSpec. */
function buildToolSpecs(): ToolSpec[] {
  return toolRegistry.getEnabledTools().map(t => ({
    name: t.id,
    description: t.description,
    parameters: {
      type: "object",
      properties: t.inputSchema.properties,
      required: t.inputSchema.required,
    },
  }));
}

/**
 * Fallback message when forced summary fails.
 * Prevents run errors from leaving user without reply.
 * Matches cyrene-agent.ts fallback logic without AG-UI dependency.
 */
function buildFallbackReply(toolResults: ToolCallResult[], reason: string): string {
  const lines: string[] = [
    "Sorry, the task was interrupted before it could finish.",
    "",
    "Reason: " + reason,
  ];
  if (toolResults.length > 0) {
    lines.push("", "Completed steps before the interruption:");
    for (const r of toolResults) {
      const preview = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output;
      lines.push("- " + r.toolId + ": " + preview);
    }
  } else {
    lines.push("", "No completed-step information is available.");
  }
  return lines.join("\n");
}

/**
 * Execute a function calling loop (vendor-agnostic).
 *
 * Flow:
 * 1. adapter.buildRequest(messages + tools) -> send to LLM
 * 2. adapter.parseResponse -> if toolCalls -> execute tools -> adapter.appendToolResults -> return to 1
 * 3. If no toolCalls -> return final text + all tool execution results
 *
 * @returns { reply, toolResults }
 */
export async function runFunctionCallingLoop(
  settings: LoopSettings,
  messages: ChatMessage[],
  timeoutMs: number = 60000,
): Promise<{
  reply: string;
  toolResults: ToolCallResult[];
  totalUsage?: { input: number; output: number };
}> {
  const adapter = getAdapter(settings.provider);
  const tools = buildToolSpecs();
  const allToolResults: ToolCallResult[] = [];
  const startTime = Date.now();
  // Accumulate token usage across rounds
  let accInput = 0;
  let accOutput = 0;
  let consecutiveTimeouts = 0; // Consecutive timeout count: triggers forced summary when threshold reached

  console.log(LOG_PREFIX, `provider=${settings.provider} transport=${adapter.transport} model=${settings.model}`);
  console.log(LOG_PREFIX, "Available tools:", tools.map(t => t.name).join(", ") || "(none)");
  console.log(LOG_PREFIX, "Message count:", messages.length, "Last role:", messages[messages.length - 1]?.role);

  let conversation: ChatMessage[] = messages.map(m => ({ ...m }));

  // Clear skill reference read tracking for current round
  resetReadRefs();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const roundStart = Date.now();

    if (Date.now() - startTime > timeoutMs) {
      console.warn(LOG_PREFIX, "Function Calling timeout, exiting at round " + (round + 1));
      break;
    }

    console.log(LOG_PREFIX, "Round " + (round + 1) + " LLM call...");

    let req: ChatRequest = {
      model: settings.model,
      messages: conversation,
      ...(tools.length > 0 ? { tools } : {}),
      // Omit temperature: let vendor use default value
      stream: false,
    };
    if (adapter.applyCacheHints) req = adapter.applyCacheHints(req, settings);

    const http = adapter.buildRequest(req, settings);
    console.log(LOG_PREFIX, "Request:", http.url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_ROUND_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(http.url, {
        method: "POST",
        signal: controller.signal,
        headers: http.headers,
        body: http.body,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        consecutiveTimeouts++;
        console.warn(LOG_PREFIX, "Round " + (round + 1) + " LLM request timeout (" + PER_ROUND_TIMEOUT_MS + "ms), consecutive count " + consecutiveTimeouts);
        clearTimeout(timer);
        // Exit on consecutive timeouts.
        // Do not inject timeout message into conversation; proceed directly to forced summary.
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          console.warn(LOG_PREFIX, "Consecutive timeouts reached " + MAX_CONSECUTIVE_TIMEOUTS + ", proceeding to forced summary");
          break;
        }
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(LOG_PREFIX, "LLM request failed HTTP " + response.status + ":", errorText.slice(0, 300));
      throw new Error("Model request failed: HTTP " + response.status + (errorText ? " — " + errorText.slice(0, 200) : ""));
    }

    const data = await response.json();
    const chat = adapter.parseResponse(data);

    // Accumulate token usage
    if (chat.usage) {
      accInput += chat.usage.input;
      accOutput += chat.usage.output;
      recordUsage(chat.usage.input, chat.usage.output, 1);
    }

    console.log(
      LOG_PREFIX,
      "Round " + (round + 1) + " completed finish=" + chat.finishReason +
      " toolCalls=" + chat.toolCalls.length + " thinking=" + (chat.thinking ? "yes" : "no") +
      " latency=" + (Date.now() - roundStart) + "ms",
    );

    // Reset consecutive timeout counter on success
    consecutiveTimeouts = 0;

    // Append assistant message to conversation (retaining thinking / rawAssistant)
    conversation.push(chat.assistantMessage);

    // Case 1: Model requested tool calls
    if (chat.toolCalls.length > 0) {
      console.log(
        LOG_PREFIX,
        "Model requested " + chat.toolCalls.length + " tools:",
        chat.toolCalls.map(tc => tc.name).join(", "),
      );

      const execResults: ToolExecutionResult[] = [];
      for (const tc of chat.toolCalls) {
        const tool = toolRegistry.getById(tc.name);

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          console.warn(LOG_PREFIX, "Tool argument JSON parse failed:", tc.arguments?.slice(0, 100));
        }

        console.log(LOG_PREFIX, "Execute tool:", tc.name, JSON.stringify(args).slice(0, 200));

        let output: string;
        let status: ToolCallResult["status"] = "failed";
        let errorCode: string | undefined;
        if (!tool || !tool.enabled || !isCompanionSafeTool(tool)) {
          output = "[Error] Tool is unavailable: " + tc.name;
          errorCode = "E_TOOL_UNAVAILABLE";
          console.warn(LOG_PREFIX, output);
        } else {
          // Permission gateway: builtin tools default safe, MCP tools evaluated by risk
          const risk: ToolRiskLevel = (tool as ToolDefinition & { risk?: ToolRiskLevel }).risk || "safe";
          const perm = await checkPermission({
            toolId: tc.name,
            toolName: tool.name,
            toolDescription: tool.description,
            args,
            risk,
          });
          if (!perm.allowed) {
            output = "[Denied] " + (perm.reason || "Insufficient permission");
            errorCode = "E_PERMISSION_DENIED";
            console.warn(LOG_PREFIX, "Permission denied [" + tc.name + "]:", perm.reason);
          } else {
            // ToolContext injection: tools with needsContext receive user query.
            // Capabilities validated within tools; no early gating in orchestrator.
            const ctx: ToolContext | undefined = tool.needsContext
              ? { userQuery: extractLastUserQuery(conversation), conversationId: "default" }
              : undefined;
            try {
              output = await tool.execute(args, ctx);
              status = "succeeded";
              console.log(LOG_PREFIX, "Tool output [" + tc.name + "]:", output.slice(0, 200));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              output = "[Tool execution failed] " + errMsg;
              errorCode = "E_TOOL_EXECUTION_FAILED";
              console.error(LOG_PREFIX, "Tool execution failed [" + tc.name + "]:", errMsg);
            }
          }
        }

        allToolResults.push({ toolId: tc.name, args, output, status, ...(errorCode ? { errorCode } : {}) });
        // Add execResults to conversation with truncation to protect window
        execResults.push({ toolCall: tc, output: truncateToolResult(output) });
      }

      // Adapter handles feeding tool results back per protocol
      // (OpenAI: multiple role:tool; Anthropic: merged into user tool_result blocks)
      conversation = adapter.appendToolResults(conversation, execResults);

      // Window compression: summarize older turns when conversation exceeds threshold
      conversation = compressConversation(conversation);

      continue;
    }

    // Case 2: Model returned regular text
    const content = chat.text || "";
    console.log(LOG_PREFIX, "Function Calling complete, final reply length=" + content.length);
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput } : undefined;
    return { reply: content, toolResults: allToolResults, totalUsage };
  }

  // Reached max rounds, force summary without tools
  console.warn(LOG_PREFIX, "Reached max rounds " + MAX_TOOL_ROUNDS + ", forcing response");
  conversation.push({
    role: "user",
    content: "Provide the final response using all tool results above. Do not call any more tools.",
  });

  let finalReq: ChatRequest = {
    model: settings.model,
    messages: conversation,
    // Omit temperature: let vendor use default
    stream: false,
  };
  if (adapter.applyCacheHints) finalReq = adapter.applyCacheHints(finalReq, settings);
  const http = adapter.buildRequest(finalReq, settings);
  console.log(LOG_PREFIX, "Request:", http.url);

  const controller = new AbortController();
  // Forced summary fallback: allow 90s timeout for long conversation history,
  // degrading to existing tool results if abort occurs.
  const timer = setTimeout(() => controller.abort(), FORCE_SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(http.url, {
      method: "POST",
      signal: controller.signal,
      headers: http.headers,
      body: http.body,
    });

    if (!response.ok) {
      throw new Error("Final response request failed: HTTP " + response.status);
    }

    const data = await response.json();
    const chat = adapter.parseResponse(data);
    console.log(LOG_PREFIX, "Forced response complete, length=" + chat.text.length);
    // Record final reply usage
    if (chat.usage) {
      accInput += chat.usage.input;
      accOutput += chat.usage.output;
      recordUsage(chat.usage.input, chat.usage.output, 1);
    }
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput } : undefined;
    return { reply: chat.text, toolResults: allToolResults, totalUsage };
  } catch (err) {
    // Prevent crash on complete failure: return task interruption fallback.
    // Assemble fallback summary from collected results.
    const reason = err instanceof Error && err.name === "AbortError"
      ? "The final response request timed out"
      : (err instanceof Error ? err.message : String(err));
    console.error(LOG_PREFIX, "Forced summary failed, returning existing results:", reason);
    const fallback = buildFallbackReply(allToolResults, reason);
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput } : undefined;
    return { reply: fallback, toolResults: allToolResults, totalUsage };
  } finally {
    clearTimeout(timer);
  }
}

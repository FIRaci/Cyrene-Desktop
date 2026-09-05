import { buildToolExecutionContext } from "./tool-execution-context";
import type { ToolDefinition } from "./tool-registry";
import type { ToolCallResult } from "./types";
import type { ChatRequest, ChatResponse, ToolCall } from "./vendors/types";

export interface NativeToolCallInput {
  model: string;
  nativeFcSystemPrompt: string;
  executionBrief: string;
  /** Trusted defaults and absolute paths provided by local main process. */
  runtimeEnvironmentContext?: string;
  toolResults: ToolCallResult[];
  tool: ToolDefinition;
  protocolFeedback?: string;
}

type InvokeNativeModel = (request: ChatRequest) => Promise<ChatResponse>;

function directToolCall(tool: ToolDefinition): ToolCall {
  return { id: `${tool.id}-${Date.now()}`, name: tool.id, arguments: "{}" };
}

function buildRequest(input: NativeToolCallInput): ChatRequest {
  const systemContent = [
    input.nativeFcSystemPrompt,
    input.runtimeEnvironmentContext
      ? `[TRUSTED_RUNTIME_ENVIRONMENT]\n${input.runtimeEnvironmentContext}\n[/TRUSTED_RUNTIME_ENVIRONMENT]`
      : "",
    input.executionBrief,
    buildToolExecutionContext(input.toolResults),
    input.protocolFeedback ? `Previous tool arguments failed runtime validation: ${input.protocolFeedback}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    model: input.model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "Please provide tool arguments based on EXECUTION_BRIEF." },
    ],
    tools: [{
      name: input.tool.id,
      description: input.tool.description,
      parameters: {
        type: "object",
        properties: input.tool.inputSchema.properties,
        ...(input.tool.inputSchema.required ? { required: input.tool.inputSchema.required } : {}),
      },
    }],
    toolChoiceIntent: { mode: "must_call", toolName: input.tool.id },
    stream: false,
  };
}

export async function resolveNativeToolCall(
  input: NativeToolCallInput,
  invoke: InvokeNativeModel,
): Promise<ToolCall> {
  if (Object.keys(input.tool.inputSchema.properties).length === 0) return directToolCall(input.tool);
  const response = await invoke(buildRequest(input));

  // Desensitized diagnostics: record raw structure returned by model, do not print arguments content
  const finishReason = response.finishReason ?? "unknown";
  const toolCallCount = response.toolCalls.length;
  const toolCallNames = response.toolCalls.map((tc) => tc.name);
  const hasText = typeof response.text === "string" && response.text.length > 0;
  const textLength = hasText ? response.text.length : 0;
  const hasRefusal = !!response.refusal;

  console.log(`[NativeFC] tool=${input.tool.id} finish=${finishReason} toolCalls=${toolCallCount} names=[${toolCallNames.join(", ")}] textLen=${textLength} refusal=${hasRefusal}`);

  if (toolCallCount >= 1 && response.toolCalls[0].name === input.tool.id) {
    // Models like MiniMax in must_call mode might return multiple tool calls with same name
    // Take the first, ignore rest
    if (toolCallCount > 1) {
      console.warn(`[NativeFC] tool=${input.tool.id} received ${toolCallCount} calls, using first one`);
    }
    // Record structural info of arguments (do not print content)
    const args = response.toolCalls[0].arguments;
    let argsType = "string";
    let argsLen = 0;
    let argsParsed = false;
    if (typeof args === "string") {
      argsLen = args.length;
      try { JSON.parse(args); argsParsed = true; } catch { /* not valid JSON */ }
    } else {
      argsType = typeof args;
    }
    console.log(`[NativeFC] accepted: tool=${input.tool.id} argsType=${argsType} argsLen=${argsLen} validJson=${argsParsed}`);
    return response.toolCalls[0];
  }

  // Classify failure cause
  let errorCode = "E_NATIVE_TOOL_PROTOCOL";
  let errorDetail = "unknown";
  if (toolCallCount === 0) {
    if (hasRefusal) {
      errorDetail = "MODEL_REFUSED";
    } else if (hasText) {
      errorDetail = "TEXT_INSTEAD_OF_TOOL_CALL";
      console.log(`[NativeFC] text response (first 200 chars): ${response.text!.slice(0, 200)}`);
    } else {
      errorDetail = "EMPTY_RESPONSE";
    }
  } else if (toolCallCount > 1) {
    errorDetail = "MULTIPLE_TOOL_CALLS";
  } else if (toolCallCount === 1 && response.toolCalls[0].name !== input.tool.id) {
    errorDetail = `WRONG_TOOL_NAME: expected=${input.tool.id} got=${response.toolCalls[0].name}`;
  }
  console.error(`[NativeFC] rejected: tool=${input.tool.id} detail=${errorDetail} finish=${finishReason}`);
  throw new Error(`${errorCode}:${errorDetail}`);
}

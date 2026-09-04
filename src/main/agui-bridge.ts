// Secure AG-UI IPC bridge between the trusted chat renderer and CyreneAgent.
import { ipcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { IPC } from "../shared/ipc-channels";
import { Subscription } from "rxjs";
import { AgentRuntimeError } from "./orchestrator/agent-runtime-error";
import {
  CyreneAgent,
  type AgentExecutionMode,
  type CyreneRunOptions,
  type CyreneRunResult,
} from "./orchestrator/cyrene-agent";
import { indexConversationTurn } from "./orchestrator/history-tools";
import type { RelationshipChannel } from "./relationship/relationship-log";
import { createThinkFilter, type ThinkStreamFilter, type ThinkFilterMode } from "./chat/think-filter";
import { perf } from "./perf-trace";
import type { StyleId } from "../shared/style-sampling";

/** Input supplied by the renderer when starting a run. */
export interface AguiRunInput {
  messages: unknown[]; // Raw {role, content}[]; normalized in the main process.
  /** Stable persisted user turn ID used as a social-memory evidence anchor. */
  userTurnId?: string;
  /** Stable assistant placeholder turn ID. */
  assistantTurnId?: string;
  /** Legacy persona style filename, retained only for compatibility. */
  style?: string;
  /** Expression style for this turn, independent from executionMode. */
  styleId?: StyleId | string;
  sessionId?: string; // Optional history-recall partition; defaults to "default".
  /** External channel used to inject channel-specific tone rules. */
  channel?: RelationshipChannel;
  /** Explicit execution mode supplied by desktop chat. */
  executionMode?: AgentExecutionMode | "soul-only" | "collaboration";
  /** Text attachments injected temporarily and not persisted in history. */
  attachments?: { name: string; text: string }[];
  /** Image attachments safely converted into OpenAI-compatible image_url blocks. */
  imageAttachments?: { name: string; filePath: string; mime?: string }[];
}

/** Converts renderer input into agent options, including system context. */
export type BuildOptionsFn = (input: AguiRunInput) => Promise<{
  options: CyreneRunOptions;
  /** Information required by post-run work. */
  latestUserText: string;
}>;

/** Performs post-run memory, sticker, expression, and broadcast work. */
export type OnRunFinishedFn = (result: CyreneRunResult, latestUserText: string) => Promise<void> | void;

/** Gets the chat window used for event delivery. */
export type GetChatWindowFn = () => { webContents: WebContents; isDestroyed(): boolean } | null;
export type GetPetWindowFn = GetChatWindowFn;

export interface AguiConversationLifecycle {
  onUserMessage(): void;
  onConversationStarted(): void;
  onConversationEnded(): void;
}

/** Active subscriptions keyed by run ID. Ownership prevents cross-window cancellation. */
const activeRuns = new Map<string, { ownerId: number; subscription: Subscription; endLifecycle: () => void }>();

let buildOptionsFn: BuildOptionsFn | null = null;
let getChatWindowFn: GetChatWindowFn = () => null;
let trustedChatSenderFn: ((event: IpcMainInvokeEvent) => boolean) | null = null;

const MAX_MESSAGES = 200;
const MAX_ATTACHMENTS = 20;

function validateRunInput(rawInput: unknown): AguiRunInput {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new Error("INVALID_REQUEST");
  }
  const input = rawInput as Partial<AguiRunInput>;
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGES) {
    throw new Error("INVALID_REQUEST");
  }
  for (const message of input.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("INVALID_REQUEST");
    const candidate = message as { role?: unknown; content?: unknown };
    if (typeof candidate.role !== "string" || !(typeof candidate.content === "string" || Array.isArray(candidate.content))) {
      throw new Error("INVALID_REQUEST");
    }
  }
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.length > MAX_ATTACHMENTS)) {
    throw new Error("INVALID_REQUEST");
  }
  if (input.imageAttachments !== undefined && (!Array.isArray(input.imageAttachments) || input.imageAttachments.length > MAX_ATTACHMENTS)) {
    throw new Error("INVALID_REQUEST");
  }
  return input as AguiRunInput;
}

type PetAgentEventDto = {
  type: "RUN_STARTED" | "TOOL_CALL_START" | "TOOL_CALL_END" | "TEXT_MESSAGE_START" |
    "TEXT_MESSAGE_CONTENT" | "TEXT_MESSAGE_END" | "RUN_FINISHED" | "RUN_ERROR";
  delta?: string;
  toolCallName?: string;
};

type ChatAgentEventDto = {
  type: "RUN_STARTED" | "TOOL_CALL_START" | "TOOL_CALL_END" | "TEXT_MESSAGE_START" |
    "TEXT_MESSAGE_CONTENT" | "TEXT_MESSAGE_END" | "RUN_FINISHED" | "RUN_ERROR" | "CUSTOM";
  threadId?: string;
  runId?: string;
  messageId?: string;
  toolCallId?: string;
  toolCallName?: string;
  delta?: string;
  message?: string;
  code?: string;
  name?: string;
  value?: unknown;
};

function boundedIdentifier(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, max);
  return clean || undefined;
}

function safeDisplayText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  if (/data:(?:image|audio)|[A-Za-z0-9+/]{512,}={0,2}/i.test(value)) return "[private content hidden]";
  return diagnosticError(value).slice(0, max);
}

function projectTaskPlan(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.steps)) return null;
  const planStatus = boundedIdentifier(plan.planStatus, 32);
  return {
    planId: boundedIdentifier(plan.planId),
    goal: safeDisplayText(plan.goal, 500),
    planStatus,
    steps: plan.steps.slice(0, 20).flatMap((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const step = raw as Record<string, unknown>;
      return [{
        stepId: boundedIdentifier(step.stepId),
        objective: safeDisplayText(step.objective, 300),
        status: boundedIdentifier(step.status, 32),
      }];
    }),
    replanCount: typeof plan.replanCount === "number" && Number.isFinite(plan.replanCount)
      ? Math.max(0, Math.min(20, Math.trunc(plan.replanCount))) : 0,
    timestamp: typeof plan.timestamp === "number" && Number.isFinite(plan.timestamp) ? plan.timestamp : Date.now(),
  };
}

/** Project the agent stream onto the Chat renderer's bounded public contract. */
export function toChatAgentEvent(value: unknown): ChatAgentEventDto | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  const common = {
    threadId: boundedIdentifier(event.threadId),
    runId: boundedIdentifier(event.runId),
  };
  if (type === "TEXT_MESSAGE_CONTENT") {
    const delta = typeof event.delta === "string" ? event.delta.slice(0, 8_192) : "";
    return { type, ...common, messageId: boundedIdentifier(event.messageId), delta };
  }
  if (type === "TEXT_MESSAGE_START" || type === "TEXT_MESSAGE_END") {
    return { type, ...common, messageId: boundedIdentifier(event.messageId) };
  }
  if (type === "TOOL_CALL_START") {
    return {
      type,
      ...common,
      toolCallId: boundedIdentifier(event.toolCallId),
      toolCallName: boundedIdentifier(event.toolCallName, 80),
    };
  }
  if (type === "TOOL_CALL_END") {
    return { type, ...common, toolCallId: boundedIdentifier(event.toolCallId) };
  }
  if (type === "RUN_ERROR") {
    const safe = safeRunErrorFromCode(event.code);
    return {
      type,
      ...common,
      code: safe.code,
      message: safe.message,
    };
  }
  if (type === "CUSTOM") {
    const name = typeof event.name === "string" ? event.name : "";
    if (name !== "cyrene.taskPlan") return null;
    const plan = projectTaskPlan(event.value);
    return plan ? { type, ...common, name, value: plan } : null;
  }
  if (type === "RUN_STARTED" || type === "RUN_FINISHED") return { type, ...common };
  // Tool arguments/results, step events, arbitrary metadata, and unknown event families are private.
  return null;
}

/** Project the agent stream onto the pet's minimal, non-sensitive UI contract. */
export function toPetAgentEvent(value: unknown): PetAgentEventDto | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "TEXT_MESSAGE_CONTENT") {
    return { type, delta: typeof event.delta === "string" ? event.delta.slice(0, 2_048) : "" };
  }
  if (type === "TOOL_CALL_START") {
    const rawName = typeof event.toolCallName === "string" ? event.toolCallName : "";
    const toolCallName = rawName.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80);
    return toolCallName ? { type, toolCallName } : { type };
  }
  if (type === "RUN_ERROR") return { type };
  if (
    type === "RUN_STARTED" || type === "TOOL_CALL_END" || type === "TEXT_MESSAGE_START" ||
    type === "TEXT_MESSAGE_END" || type === "RUN_FINISHED"
  ) return { type };
  return null;
}

function assertTrustedChatSender(event: IpcMainInvokeEvent): void {
  if (trustedChatSenderFn) {
    if (!trustedChatSenderFn(event)) throw new Error("AG-UI request denied.");
    return;
  }
  const chat = getChatWindowFn();
  if (!chat || chat.isDestroyed() || chat.webContents.id !== event.sender.id) {
    throw new Error("AG-UI request denied.");
  }
}

function safeRunError(err: unknown): { message: string; code?: string } {
  if (err instanceof AgentRuntimeError) {
    const messages: Record<string, string> = {
      E_AGENT_NO_PROGRESS: "Cyrene could not complete that request. Please try again.",
      E_AGENT_GRAPH_ITERATION_LIMIT: "The request took too many steps. Please simplify it and try again.",
      E_MODEL_REQUEST_FAILED: "The local model request failed. Check Ollama and try again.",
    };
    return { message: messages[err.code] ?? "Cyrene could not complete that request.", code: err.code };
  }
  return { message: "Cyrene could not complete that request. Please try again." };
}

function safeRunErrorFromCode(code: unknown): { message: string; code?: string } {
  const safeCode = boundedIdentifier(code, 80);
  const messages: Record<string, string> = {
    E_AGENT_NO_PROGRESS: "Cyrene could not complete that request. Please try again.",
    E_AGENT_GRAPH_ITERATION_LIMIT: "The request took too many steps. Please simplify it and try again.",
    E_MODEL_REQUEST_FAILED: "The model request failed. Check the configured local service and try again.",
  };
  return {
    message: safeCode && messages[safeCode] ? messages[safeCode] : "Cyrene could not complete that request. Please try again.",
    ...(safeCode && messages[safeCode] ? { code: safeCode } : {}),
  };
}

export function diagnosticError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1<redacted>@")
    .replace(/([?&](?:api[_-]?key|key|token|secret|authorization)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted>")
    .replace(/((?:api[_-]?key|authorization|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
    .replace(/\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s]*/g, "<path>")
    .replace(/\/(?:Users|home)\/[^\s]+/g, "<path>")
    .replace(/\{[\s\S]{20,}\}/g, "<response body redacted>")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 600);
}

/**
 * Registers AG-UI IPC once after the application is ready.
 *
 * @param buildOptions Converts renderer input into agent options.
 * @param onRunFinished Runs memory, sticker, and related post-run work.
 * @param getChatWindow Returns the trusted chat event destination.
 */
export function registerAgUiIpc(
  buildOptions: BuildOptionsFn,
  onRunFinished: OnRunFinishedFn,
  getChatWindow: GetChatWindowFn,
  lifecycle?: AguiConversationLifecycle,
  getPetWindow: GetPetWindowFn = () => null,
  isTrustedChatSender?: (event: IpcMainInvokeEvent) => boolean,
  onActivityLog?: (type: "user" | "reasoning" | "response" | "tool" | "error" | "system", text: string, meta?: unknown) => void,
): void {
  buildOptionsFn = buildOptions;
  getChatWindowFn = getChatWindow;
  trustedChatSenderFn = isTrustedChatSender ?? null;

  const onFinished = onRunFinished;
  ipcMain.handle(IPC.AGUI_RUN, async (event: IpcMainInvokeEvent, rawInput: unknown) => {
    assertTrustedChatSender(event);
    if (!buildOptionsFn || !onFinished) {
      throw new Error("AG-UI is not ready.");
    }
    const input = validateRunInput(rawInput);
    lifecycle?.onUserMessage();
    lifecycle?.onConversationStarted();
    perf.beginTurn("desktop");
    let built;
    try {
      built = await perf.track("build_options", () => buildOptionsFn!(input));
    } catch (error) {
      perf.dump();
      lifecycle?.onConversationEnded();
      console.error("[AgUiBridge] Failed to prepare run:", diagnosticError(error));
      onActivityLog?.("error", "Failed to prepare run: " + (error instanceof Error ? error.message : String(error)));
      throw new Error("Cyrene could not start that request. Check Ollama and try again.");
    }
    const { options, latestUserText } = built;
    onActivityLog?.("user", latestUserText);

    const threadId = `thread-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent = new CyreneAgent({ threadId, description: "Cyrene primary chat" });

    // Deliver to the invoking chat renderer and mirror to the current chat if needed.
    const sender = event.sender;

    const send = (baseEvent: unknown): void => {
      const targets: WebContents[] = [];
      if (!sender.isDestroyed()) targets.push(sender);
      const chatWin = getChatWindowFn();
      if (chatWin && !chatWin.isDestroyed() && chatWin.webContents !== sender) {
        targets.push(chatWin.webContents);
      }
      const petWin = getPetWindow();
      if (
        petWin
        && !petWin.isDestroyed()
        && petWin.webContents !== sender
        && !targets.includes(petWin.webContents)
      ) {
        try {
          const petEvent = toPetAgentEvent(baseEvent);
          if (petEvent) petWin.webContents.send(IPC.PET_AGENT_EVENT, petEvent);
        } catch (err) {
          console.error("[AgUiBridge] Failed to update pet companion UI:", err instanceof Error ? err.message : String(err));
        }
      }
      const chatEvent = toChatAgentEvent(baseEvent);
      if (!chatEvent) return;
      for (const t of targets) {
        try {
          t.send(IPC.AGUI_EVENT, chatEvent);
        } catch (err) {
          console.error("[AgUiBridge] Event delivery failed:", diagnosticError(err), "eventType=", (baseEvent as { type?: string })?.type);
        }
      }
    };

    let pendingRunFinishedEvent: unknown | null = null;
    let lifecycleEnded = false;
    const endLifecycle = (): void => {
      if (lifecycleEnded) return;
      lifecycleEnded = true;
      lifecycle?.onConversationEnded();
    };

    // Isolate the <think> filter to one assistant message boundary.
    // Leading-only mode avoids removing ordinary discussion of <think> tags.
    let thinkFilter: ThinkStreamFilter | null = null;
    const thinkFilterMode: ThinkFilterMode = "leading-only";

    // Forward agent events, filter private reasoning, then emit terminal state.
    perf.mark("agent_run_start");
    const sub = agent.runWithEvents(options).subscribe({
      next: (baseEvent) => {
        const eventType = (baseEvent as { type?: string })?.type;

        if (eventType === "TOOL_CALL_START") {
          const name = (baseEvent as { toolCallName?: string })?.toolCallName || "tool";
          onActivityLog?.("tool", `Invoking tool: ${name}`);
        } else if (eventType === "TOOL_CALL_END") {
          const name = (baseEvent as { toolCallName?: string })?.toolCallName || "tool";
          onActivityLog?.("tool", `Finished tool: ${name}`);
        } else if (eventType === "CUSTOM") {
          const custom = baseEvent as { name?: string; delta?: string; value?: unknown };
          if (custom.delta) {
            onActivityLog?.("reasoning", custom.delta);
          }
        }

        // Delay RUN_FINISHED until post-run events are delivered.
        if (eventType === "RUN_FINISHED") {
          // Discard a filter left behind by a missing TEXT_MESSAGE_END.
          thinkFilter = null;
          pendingRunFinishedEvent = baseEvent;
          return;
        }

        // Filter private reasoning from TEXT_MESSAGE_* events.
        if (eventType === "TEXT_MESSAGE_START") {
          thinkFilter = createThinkFilter(thinkFilterMode);
          send(baseEvent);
          return;
        }

        if (eventType === "TEXT_MESSAGE_CONTENT") {
          if (!thinkFilter) {
            // Preserve events when an upstream START boundary is missing.
            send(baseEvent);
            return;
          }
          const event = baseEvent as { type: string; delta?: string };
          const rawDelta = typeof event.delta === "string" ? event.delta : "";
          const visibleDelta = thinkFilter.push(rawDelta);
          if (visibleDelta) {
            send({ ...event, delta: visibleDelta });
          }
          // Do not emit empty CONTENT events.
          return;
        }

        if (eventType === "TEXT_MESSAGE_END") {
          if (thinkFilter) {
            const tail = thinkFilter.flush();
            if (tail) {
              // Flush visible tail content before END.
              send({ type: "TEXT_MESSAGE_CONTENT", delta: tail, threadId, runId });
            }
            thinkFilter = null;
          }
          send(baseEvent);
          return;
        }

        // Forward all other events unchanged.
        send(baseEvent);
      },
      error: (err) => {
        thinkFilter = null;
        const safe = safeRunError(err);
        console.error("[AgUiBridge] Run failed:", diagnosticError(err));
        onActivityLog?.("error", safe.message || "Agent execution failed");
        perf.dump();
        send({ type: "RUN_ERROR", message: safe.message, code: safe.code, threadId, runId });
        activeRuns.delete(runId);
        endLifecycle();
      },
      complete: async () => {
        perf.mark("agent_run_complete");
        activeRuns.delete(runId);
        try {
          if (agent.lastResult) {
            const lastResult = agent.lastResult;
            if (lastResult.reply) {
              onActivityLog?.("response", lastResult.reply);
            }
            await perf.track("on_run_finished", async () => { await onFinished(lastResult, latestUserText); });
            // Index history asynchronously after visible post-run work.
            void indexConversationTurn(
              input.sessionId || "default",
              latestUserText,
              lastResult.reply,
            );
          }
        } catch (err) {
          console.warn("[AgUiBridge] Post-run work failed:", diagnosticError(err));
        }
        if (pendingRunFinishedEvent) {
          send(pendingRunFinishedEvent);
        }
        endLifecycle();
        perf.dump();
      },
    });
    if (!sub.closed) activeRuns.set(runId, { ownerId: sender.id, subscription: sub, endLifecycle });

    // Return the acknowledgement immediately; terminal state arrives via events.
    return { success: true, runId };
  });

  ipcMain.handle(IPC.AGUI_CANCEL, (event: IpcMainInvokeEvent) => {
    assertTrustedChatSender(event);
    for (const [runId, run] of activeRuns) {
      if (run.ownerId !== event.sender.id) continue;
      run.subscription.unsubscribe();
      run.endLifecycle();
      activeRuns.delete(runId);
    }
    return true;
  });
}

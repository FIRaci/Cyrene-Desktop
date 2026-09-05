import type { WebContents } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { AgentRuntimeError } from "../orchestrator/agent-runtime-error";
import { CyreneAgent, type CyreneRunOptions } from "../orchestrator/cyrene-agent";
import { toolRegistry } from "../orchestrator/tool-registry";
import { filterToolsForTask } from "./tool-filter";
import type { ScheduledRunResult, ScheduledTask, ScheduledTaskHistoryEntry } from "./types";

/**
 * Phase 1: scheduler buildOptions returns legacy format (containing system message).
 * CyreneAgent temporarily fallbacks: when options.messages[0].role === "system",
 * uses it as soulSystemBaseContent, and toolSystemContent uses the same string.
 *
 * Phase 2: scheduler migrates to separate tool_system / soul_system phases, with buildOptions returning
 * CyreneRunOptions with toolSystemContent / soulSystemBaseContent.
 */
type LegacyRunOptions = Omit<CyreneRunOptions, "toolSystemContent" | "soulSystemBaseContent">;

interface RunnerDeps {
  buildOptions: (task: ScheduledTask) => Promise<LegacyRunOptions>;
  getChatWebContents: () => WebContents | null;
  recordHistory: (entry: ScheduledTaskHistoryEntry) => void;
  id: () => string;
  now: () => Date;
}

export function createSchedulerRunner(deps: RunnerDeps) {
  async function runScheduledTask(task: ScheduledTask, _scheduledFireAt: Date, manual: boolean): Promise<ScheduledRunResult> {
    const historyId = deps.id();
    const startedAt = deps.now();
    // Scheduled agents receive the same companion-safe catalog as interactive chat.
    const allTools = toolRegistry.getEnabledTools();
    const effectiveTools = filterToolsForTask(task, allTools);
    const effectiveToolIds = effectiveTools.map(t => t.id);

    deps.recordHistory({
      id: historyId,
      taskId: task.id,
      taskTitle: task.title,
      firedAt: startedAt.toISOString(),
      status: "running",
      reason: manual ? "manual fireNow" : undefined,
      effectiveToolIds,
    });

    const send = (event: unknown): void => {
      const wc = deps.getChatWebContents();
      if (!wc || wc.isDestroyed()) return;
      wc.send(IPC.SCHEDULER_EVENT, event);
    };

    send({
      type: "CUSTOM",
      name: "scheduler.started",
      schedulerRunId: historyId,
      schedulerTaskId: task.id,
      value: { taskId: task.id, title: task.title, manual, firedAt: startedAt.toISOString(), runId: historyId },
    });

    try {
      const legacyOptions = await deps.buildOptions(task);
      legacyOptions.tools = effectiveTools;

      // Phase 1 compatibility: extract system message from legacy messages as soulSystemBaseContent.
      // toolSystemContent temporarily uses the same string.
      const sysIdx = legacyOptions.messages.findIndex((m) => m.role === "system");
      let soulSystemBaseContent: string;
      let messages = legacyOptions.messages;
      if (sysIdx >= 0) {
        const sysMsg = legacyOptions.messages[sysIdx];
        soulSystemBaseContent = typeof sysMsg.content === "string" ? sysMsg.content : "";
        messages = legacyOptions.messages.filter((_, i) => i !== sysIdx);
      } else {
        soulSystemBaseContent = "";
      }
      const toolSystemContent = soulSystemBaseContent; // Phase 1 uses same string

      const options: CyreneRunOptions = {
        ...legacyOptions,
        messages,
        toolSystemContent,
        soulSystemBaseContent,
      };

      const agent = new CyreneAgent({ threadId: `scheduler-${task.id}`, description: `Scheduled task: ${task.title}` });

      await new Promise<void>((resolve, reject) => {
        const sub = agent.runWithEvents(options).subscribe({
          next: (event) => send({ ...event, schedulerRunId: historyId, schedulerTaskId: task.id }),
          error: (err) => {
            sub.unsubscribe();
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          complete: () => {
            sub.unsubscribe();
            resolve();
          },
        });
      });

      const finishedAt = deps.now();
      const reply = agent.lastResult?.reply ?? "";
      deps.recordHistory({
        id: historyId,
        taskId: task.id,
        taskTitle: task.title,
        firedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "success",
        outputPreview: reply.slice(0, 160),
        effectiveToolIds,
      });
      return { ok: true, historyId, reply, effectiveToolIds };
    } catch (err) {
      const finishedAt = deps.now();
      const message = err instanceof Error ? err.message : String(err);
      deps.recordHistory({
        id: historyId,
        taskId: task.id,
        taskTitle: task.title,
        firedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: "failed",
        errorMessage: message,
        effectiveToolIds,
      });
      send({ type: "RUN_ERROR", message, code: err instanceof AgentRuntimeError ? err.code : undefined, threadId: `scheduler-${task.id}`, runId: historyId, schedulerRunId: historyId, schedulerTaskId: task.id });
      return { ok: false, historyId, error: message, effectiveToolIds };
    }
  }

  return { runScheduledTask };
}

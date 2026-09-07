import { BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { getSchedulerStore } from "../scheduler/scheduler-store";
import type { NewScheduledTaskInput, ScheduleConfig, ScheduledTask } from "../scheduler/types";
import { toolRegistry } from "./tool-registry";
import { currentUserTimezone } from "./built-in-tools";

const LOG_PREFIX = "[SchedulerTools]";

/** Notify all open windows that tasks/schedule changed */
export function broadcastSchedulerChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send(IPC.SCHEDULER_CHANGED);
      } catch {
        // ignore destroyed or unresponsive windows
      }
    }
  }
}

/**
 * Flexible date parser for user-specified dates and times.
 * Handles ISO, YYYY-MM-DD HH:mm, DD/MM/YYYY HH:mm, or date + time strings.
 */
export function parseDateTimeInput(input: string, now: Date = new Date()): Date | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Pure date like YYYY-MM-DD
  const ymdOnly = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
  if (ymdOnly) {
    const year = Number(ymdOnly[1]);
    const month = Number(ymdOnly[2]) - 1;
    const day = Number(ymdOnly[3]);
    const d = new Date(year, month, day, 9, 0, 0, 0);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 2. Format: YYYY-MM-DD HH:mm(:ss)?
  const ymdMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(trimmed);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    const hours = Number(ymdMatch[4]);
    const minutes = Number(ymdMatch[5]);
    const seconds = ymdMatch[6] !== undefined ? Number(ymdMatch[6]) : 0;
    const d = new Date(year, month, day, hours, minutes, seconds);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 3. Format: DD/MM/YYYY (or DD-MM-YYYY) with optional time
  const dmyMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i.exec(trimmed);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]) - 1;
    const year = Number(dmyMatch[3]);
    const hours = dmyMatch[4] !== undefined ? Number(dmyMatch[4]) : 9;
    const minutes = dmyMatch[5] !== undefined ? Number(dmyMatch[5]) : 0;
    const seconds = dmyMatch[6] !== undefined ? Number(dmyMatch[6]) : 0;
    const d = new Date(year, month, day, hours, minutes, seconds);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 4. Time only: HH:mm (today or tomorrow)
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(trimmed);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
    const d = new Date(now);
    d.setHours(hours, minutes, seconds, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1); // If past for today, schedule for tomorrow
    }
    return d;
  }

  // 5. Direct standard Date parsing (ISO 8601 or natural English strings like "September 8, 2026 14:00")
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  return null;
}

export function formatFriendlySchedule(task: ScheduledTask): string {
  const schedule = task.schedule;
  switch (schedule.kind) {
    case "once":
      return task.nextFireAt ? new Date(task.nextFireAt).toLocaleString() : schedule.runAt;
    case "daily":
      return `Daily at ${schedule.timeOfDay}`;
    case "weekly": {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return `Weekly on ${days[schedule.dayOfWeek] || schedule.dayOfWeek} at ${schedule.timeOfDay}`;
    }
    case "interval":
      return `Every ${schedule.every} ${schedule.unit}`;
  }
}

export function registerSchedulerTools(): void {
  // ── Tool 1: schedule_task ──────────────────────────────────
  toolRegistry.register({
    id: "schedule_task",
    name: "Schedule task or reminder",
    description:
      "Schedule a task, reminder, study session, meeting, or appointment into Cyrene's schedule (Alt+3).\n\n" +
      "Use when the user asks to schedule something, set a reminder, plan a study session, meeting, work target, or recurring event.\n" +
      "Always call this tool whenever the user mentions setting a schedule or reminder — do not merely roleplay or promise without executing this tool.\n\n" +
      "Parameters:\n" +
      "- title (required string): Short, clear title of the event (e.g. 'Study class', 'Math exam', 'Client meeting').\n" +
      "- date_time (optional string): Specific date and time for 'once' schedule. Formats: YYYY-MM-DD HH:mm, ISO string (e.g. '2026-09-08 14:00', '2026-09-08T14:00:00').\n" +
      "- kind (optional string): 'once' (default), 'daily', 'weekly', or 'interval'.\n" +
      "- time_of_day (optional string): 'HH:mm' (e.g. '14:00') if kind is 'daily' or 'weekly'.\n" +
      "- day_of_week (optional number): 0 (Sun) to 6 (Sat) if kind is 'weekly'.\n" +
      "- prompt (optional string): Spoken reminder or prompt for Cyrene when the task fires. Defaults to reminding Master of the title.",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task or event" },
        date_time: { type: "string", description: "Date and time for the event (e.g. '2026-09-08 14:00' or ISO string)" },
        kind: { type: "string", enum: ["once", "daily", "weekly", "interval"], description: "Schedule type, default 'once'" },
        time_of_day: { type: "string", description: "Time of day in HH:mm format for daily/weekly schedules (e.g. '14:00')" },
        day_of_week: { type: "number", description: "Day of week 0-6 (0=Sunday, 1=Monday... 6=Saturday) for weekly schedules" },
        prompt: { type: "string", description: "Reminder text or prompt Cyrene will deliver when due" },
      },
      required: ["title"],
    },
    execute: async (args) => {
      const title = String(args.title || "").trim();
      if (!title) return "[Error] Task title is required";

      const kind = (String(args.kind || "once").toLowerCase()) as ScheduleConfig["kind"];
      let scheduleConfig: ScheduleConfig;
      const now = new Date();

      if (kind === "daily") {
        const timeOfDay = String(args.time_of_day || "").trim();
        if (!/^\d{2}:\d{2}$/.test(timeOfDay)) {
          return "[Error] daily schedule requires time_of_day in 'HH:mm' format (e.g. '14:00')";
        }
        scheduleConfig = { kind: "daily", timeOfDay };
      } else if (kind === "weekly") {
        const timeOfDay = String(args.time_of_day || "").trim();
        const dayOfWeek = Number(args.day_of_week);
        if (!/^\d{2}:\d{2}$/.test(timeOfDay) || Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          return "[Error] weekly schedule requires time_of_day ('HH:mm') and day_of_week (0-6)";
        }
        scheduleConfig = { kind: "weekly", dayOfWeek: dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6, timeOfDay };
      } else if (kind === "interval") {
        const every = Number(args.every) || 1;
        const unit = args.unit === "minutes" ? "minutes" : "hours";
        scheduleConfig = { kind: "interval", every, unit };
      } else {
        // "once"
        const rawDateTime = String(args.date_time || args.datetime || args.time || args.runAt || "").trim();
        const parsedDate = parseDateTimeInput(rawDateTime, now);
        if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
          return `[Error] Could not parse date_time "${rawDateTime}". Please provide format 'YYYY-MM-DD HH:mm' (e.g. '2026-09-08 14:00').`;
        }
        scheduleConfig = { kind: "once", runAt: parsedDate.toISOString() };
      }

      const prompt = String(args.prompt || "").trim() || `Remind Master: It is time for ${title}!`;

      try {
        const store = getSchedulerStore();
        const input: NewScheduledTaskInput = {
          title,
          prompt,
          schedule: scheduleConfig,
          enabled: true,
        };
        const task = store.addTask(input);
        broadcastSchedulerChanged();

        console.log(LOG_PREFIX, "Scheduled new task:", task.id, title, scheduleConfig);
        return `[schedule_task] Successfully added to schedule (Alt+3):\n- Title: ${task.title}\n- When: ${formatFriendlySchedule(task)}\n- ID: ${task.id}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(LOG_PREFIX, "Failed to schedule task:", err);
        return `[Error] Failed to schedule task: ${msg}`;
      }
    },
  });

  // ── Tool 2: query_scheduled_tasks ──────────────────────────
  toolRegistry.register({
    id: "query_scheduled_tasks",
    name: "Query scheduled tasks",
    description:
      "Query or list upcoming scheduled tasks, study sessions, and reminders from Cyrene's schedule (Alt+3).\n\n" +
      "Use when the user asks what is on their schedule, checks upcoming reminders, or asks about tasks for a specific day.\n\n" +
      "Parameters:\n" +
      "- date (optional string): Filter for a specific date in 'YYYY-MM-DD' format (e.g. '2026-09-08').",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional filter date (YYYY-MM-DD)" },
      },
    },
    execute: async (args) => {
      try {
        const store = getSchedulerStore();
        const allTasks = store.getTasks();

        if (allTasks.length === 0) {
          return "[query_scheduled_tasks] There are currently no scheduled tasks in Alt+3.";
        }

        const filterDate = String(args.date || "").trim();
        let tasks = allTasks.filter(t => t.enabled);

        if (filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate)) {
          tasks = tasks.filter(t => {
            if (t.schedule.kind === "once") {
              const d = new Date(t.schedule.runAt);
              return d.toISOString().startsWith(filterDate);
            }
            return true; // Recurring tasks might still apply
          });
        }

        if (tasks.length === 0) {
          return `[query_scheduled_tasks] No active tasks found${filterDate ? ` for ${filterDate}` : ""}.`;
        }

        const list = tasks.map(t => `- [${t.id}] **${t.title}**: ${formatFriendlySchedule(t)} (Enabled: ${t.enabled ? "Yes" : "No"})`).join("\n");
        return `[query_scheduled_tasks] Found ${tasks.length} task(s):\n${list}`;
      } catch (err) {
        return `[Error] Failed to query tasks: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  // ── Tool 3: delete_scheduled_task ──────────────────────────
  toolRegistry.register({
    id: "delete_scheduled_task",
    name: "Delete scheduled task",
    description:
      "Cancel or delete a scheduled task or reminder from Cyrene's schedule (Alt+3).\n\n" +
      "Parameters:\n" +
      "- id (optional string): ID of the task to delete.\n" +
      "- title (optional string): Title of the task to delete if ID is unknown.",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The task ID to remove" },
        title: { type: "string", description: "Title of the task to remove" },
      },
    },
    execute: async (args) => {
      try {
        const store = getSchedulerStore();
        const allTasks = store.getTasks();
        const id = String(args.id || args.taskId || "").trim();
        const title = String(args.title || "").trim().toLowerCase();

        const target = allTasks.find(t => (id && t.id === id) || (title && t.title.toLowerCase().includes(title)));
        if (!target) {
          return `[delete_scheduled_task] Could not find any task matching id="${id}" or title="${title}".`;
        }

        const success = store.deleteTask(target.id);
        if (success) {
          broadcastSchedulerChanged();
          return `[delete_scheduled_task] Successfully deleted task "${target.title}" (ID: ${target.id}).`;
        } else {
          return `[delete_scheduled_task] Task with ID ${target.id} could not be deleted.`;
        }
      } catch (err) {
        return `[Error] Failed to delete task: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

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

// ============================================================================
// 🔒 HARD INVARIANT: AGENTS.md §16.11 - SLOT-FILLING SCHEDULING & MULTI-LANGUAGE PARSER
// DO NOT REMOVE OR STRIP RELATIVE / NAMED-DAY PATTERNS FROM THIS PARSER.
// The LLM operates via slot-filling (extracting user text into `date_time` / `title`),
// and this deterministic TypeScript engine handles all temporal arithmetic and multi-language
// Vietnamese / English keywords (relative offsets, days of week, named times of day).
// ============================================================================
/**
 * Flexible multi-language date parser for user-specified dates and times.
 * Handles:
 * - Relative offsets: "15 phút nữa", "30p nữa", "2 tiếng nữa", "in 15 minutes", "in 2 hours", "sau 1 tiếng"
 * - Named days: "chiều mai lúc 2h", "8h tối nay", "sáng mai 9h", "ngày mai 15:30", "ngày kia 10h", "tomorrow at 3pm"
 * - Days of week: "thứ 2 tuần sau lúc 9h", "chủ nhật 15:00", "next Monday at 10am"
 * - Specific dates: "14h ngày 15/9", "ngày 15 tháng 9 lúc 2h chiều", "15/09/2026 14:00"
 * - ISO / standard formats: YYYY-MM-DD HH:mm, DD/MM/YYYY HH:mm, HH:mm
 */
export function parseDateTimeInput(input: string, now: Date = new Date()): Date | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // ── 1. Relative time offset (e.g. "15 phút nữa", "30p nữa", "2 tiếng nữa", "in 15 minutes", "sau 1 giờ") ──
  const isRelative = /\b(nữa|nua|sau|later|in\s+\d+|tới|toi)\b/i.test(lower) ||
    /^\s*\d+\s*(?:phút|phut|p|mins?|minutes?|tiếng|tieng|giờ|gio|h|hours?|hrs?|ngày|ngay|days?|s|giây|giay|seconds?)\s*$/i.test(lower);

  if (isRelative) {
    let totalMs = 0;
    let matched = false;

    // Days: "3 ngày nữa", "in 3 days"
    const dMatch = /(\d+)\s*(?:ngày|ngay|days?)/i.exec(lower);
    if (dMatch) { totalMs += Number(dMatch[1]) * 86_400_000; matched = true; }

    // Hours: "2 tiếng nữa", "2 giờ nữa", "in 2 hours", "2h nữa"
    const hMatch = /(\d+(?:\.\d+)?)\s*(?:tiếng|tieng|giờ|gio|hours?|hrs?|h(?!\d))/i.exec(lower);
    if (hMatch && !/\b\d{1,2}h\d{2}\b/i.test(lower)) {
      totalMs += Number(hMatch[1]) * 3_600_000;
      matched = true;
    }

    // Minutes: "15 phút nữa", "15p nữa", "in 15 mins"
    const mMatch = /(\d+)\s*(?:phút|phut|p|mins?|minutes?)/i.exec(lower);
    if (mMatch) { totalMs += Number(mMatch[1]) * 60_000; matched = true; }

    // Seconds: "30 giây nữa", "in 30s"
    const sMatch = /(\d+)\s*(?:giây|giay|s|secs?|seconds?)/i.exec(lower);
    if (sMatch) { totalMs += Number(sMatch[1]) * 1_000; matched = true; }

    if (matched && totalMs > 0) {
      return new Date(now.getTime() + totalMs);
    }
  }

  // ── 2. Normalize casual notation ──
  // Convert 12h30 -> 12:30, 14h -> 14:00, 8h tối -> 20:00, 2h chiều -> 14:00
  let working = trimmed
    .replace(/\b(\d{1,2})h(\d{2})\b/gi, (_m, h, min) => `${h}:${min}`)
    .replace(/\b(\d{1,2})h\b/gi, (_m, h) => `${h}:00`)
    .replace(/\b(?:at|on|lúc|vao|vào)\s+/gi, " ")
    .trim();

  const workingLower = working.toLowerCase();

  // ── 3. Check for Named Days: hôm nay, ngày mai, ngày kia, mốt, today, tomorrow ──
  let dayOffset: number | null = null;
  if (/\b(hôm nay|hom nay|tối nay|toi nay|chiều nay|chieu nay|sáng nay|sang nay|trưa nay|trua nay|today|tonight)\b/i.test(workingLower)) {
    dayOffset = 0;
  } else if (/\b(ngày mai|ngay mai|mai|sáng mai|sang mai|chiều mai|chieu mai|tối mai|toi mai|trưa mai|trua mai|tomorrow)\b/i.test(workingLower)) {
    dayOffset = 1;
  } else if (/\b(ngày kia|ngay kia|ngày mốt|ngay mot|mốt|mot|day after tomorrow)\b/i.test(workingLower)) {
    dayOffset = 2;
  } else if (/\b(ngày kìa|ngay kia)\b/i.test(workingLower)) {
    dayOffset = 3;
  }

  // Check Day of week: "thứ 2", "thứ hai", "thứ 3", "thứ 4", "thứ 5", "thứ 6", "thứ 7", "chủ nhật", "monday", ...
  const dowMap: Record<string, number> = {
    "chủ nhật": 0, "chu nhat": 0, "cn": 0, "sunday": 0, "sun": 0,
    "thứ 2": 1, "thu 2": 1, "thứ hai": 1, "thu hai": 1, "monday": 1, "mon": 1,
    "thứ 3": 2, "thu 3": 2, "thứ ba": 2, "thu ba": 2, "tuesday": 2, "tue": 2,
    "thứ 4": 3, "thu 4": 3, "thứ tư": 3, "thu tu": 3, "thứ bốn": 3, "wednesday": 3, "wed": 3,
    "thứ 5": 4, "thu 5": 4, "thứ năm": 4, "thu nam": 4, "thursday": 4, "thu": 4,
    "thứ 6": 5, "thu 6": 5, "thứ sáu": 5, "thu sau": 5, "friday": 5, "fri": 5,
    "thứ 7": 6, "thu 7": 6, "thứ bảy": 6, "thu bay": 6, "saturday": 6, "sat": 6,
  };

  let targetDow: number | null = null;
  for (const [name, dow] of Object.entries(dowMap)) {
    const regex = new RegExp(`\\b${name}\\b`, "i");
    if (regex.test(workingLower)) {
      targetDow = dow;
      break;
    }
  }

  if (targetDow !== null && dayOffset === null) {
    const isNextWeek = /\b(tuần sau|tuan sau|next week|tới|toi)\b/i.test(workingLower);
    const currentDow = now.getDay();
    let diff = targetDow - currentDow;
    if (diff <= 0) diff += 7;
    if (isNextWeek && diff < 7) diff += 7;
    dayOffset = diff;
  }

  // Check specific date pattern: "ngày 15/9", "15/9", "ngày 15 tháng 9", "15/09/2026"
  const vnDateMatch = /(?:ngày\s+)?(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?/i.exec(workingLower)
    || /(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/i.exec(workingLower);

  let specificDate: { year: number; month: number; day: number } | null = null;
  if (vnDateMatch && !/^\d{4}[-/]/.test(working)) {
    const day = Number(vnDateMatch[1]);
    const month = Number(vnDateMatch[2]) - 1;
    const year = vnDateMatch[3] ? Number(vnDateMatch[3]) : now.getFullYear();
    specificDate = { year, month, day };
  }

  // ── 4. Extract Time of Day from string ──
  // Extract HH:mm(:ss)? with optional am/pm or buổi (sáng/trưa/chiều/tối/đêm)
  let hours: number | null = null;
  let minutes = 0;
  let seconds = 0;

  const timeRegex = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/i.exec(working);
  if (timeRegex) {
    hours = Number(timeRegex[1]);
    minutes = Number(timeRegex[2]);
    seconds = timeRegex[3] ? Number(timeRegex[3]) : 0;
  } else {
    // Single number like "2h", "14h", "8 giờ"
    const singleHourRegex = /\b(\d{1,2})\s*(?:h|giờ|gio|giơ)\b/i.exec(trimmed);
    if (singleHourRegex) {
      hours = Number(singleHourRegex[1]);
      minutes = 0;
    }
  }

  // Check am/pm or Vietnamese buổi modifiers
  const isPM = /\b(pm|chiều|chieu|tối|toi|đêm|dem)\b/i.test(workingLower);
  const isAM = /\b(am|sáng|sang)\b/i.test(workingLower);

  if (hours !== null) {
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    if (/\b(đêm|dem|midnight)\b/i.test(workingLower) && hours === 12) hours = 0;
  } else if (dayOffset !== null || specificDate !== null) {
    // No explicit hour given, but buổi indicator exists
    if (/\b(sáng|sang|morning)\b/i.test(workingLower)) hours = 8;
    else if (/\b(trưa|trua|noon)\b/i.test(workingLower)) hours = 12;
    else if (/\b(chiều|chieu|afternoon)\b/i.test(workingLower)) hours = 14;
    else if (/\b(tối|toi|evening|tonight)\b/i.test(workingLower)) hours = 19;
    else if (/\b(đêm|dem|night)\b/i.test(workingLower)) hours = 21;
    else hours = 9; // Default 9:00 AM
  }

  // If we found a specific date
  if (specificDate !== null && hours !== null) {
    const d = new Date(specificDate.year, specificDate.month, specificDate.day, hours, minutes, seconds);
    if (!Number.isNaN(d.getTime())) {
      // If date was specified without year and has passed, roll to next year
      if (!vnDateMatch?.[3] && d.getTime() < now.getTime() - 86_400_000) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return d;
    }
  }

  // If we found a day offset
  if (dayOffset !== null && hours !== null) {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, minutes, seconds, 0);
    return d;
  }

  // ── 5. Standard fallback formats ──
  // A. Format: YYYY-MM-DD HH:mm(:ss)?
  const ymdMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?$/i.exec(working);
  if (ymdMatch) {
    const y = Number(ymdMatch[1]);
    const m = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    let h = Number(ymdMatch[4]);
    const min = Number(ymdMatch[5]);
    const s = ymdMatch[6] ? Number(ymdMatch[6]) : 0;
    const ampm = ymdMatch[7]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(y, m, day, h, min, s);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // B. Format: Pure date like YYYY-MM-DD
  const ymdOnly = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(working);
  if (ymdOnly) {
    const d = new Date(Number(ymdOnly[1]), Number(ymdOnly[2]) - 1, Number(ymdOnly[3]), 9, 0, 0);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // C. Format: DD/MM/YYYY with optional time
  const dmyMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i.exec(working);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]) - 1;
    const y = Number(dmyMatch[3]);
    let h = dmyMatch[4] ? Number(dmyMatch[4]) : 9;
    const min = dmyMatch[5] ? Number(dmyMatch[5]) : 0;
    const s = dmyMatch[6] ? Number(dmyMatch[6]) : 0;
    const ampm = dmyMatch[7]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(y, m, day, h, min, s);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // D. Time only: HH:mm (today or tomorrow)
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?$/i.exec(working);
  if (timeMatch) {
    let h = Number(timeMatch[1]);
    const min = Number(timeMatch[2]);
    const s = timeMatch[3] ? Number(timeMatch[3]) : 0;
    const ampm = timeMatch[4]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, s, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  // E. Direct standard Date parsing with current year fallback
  if (/\d/.test(working)) {
    let direct = new Date(working);
    if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 1970) {
      return direct;
    }
    const hasMonthIndicator = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(working);
    if (hasMonthIndicator && !/\b\d{4}\b/.test(working)) {
      direct = new Date(`${working} ${now.getFullYear()}`);
      if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 1970) {
        return direct;
      }
    }
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
      "- date_time (optional string): Specific date and time for 'once' schedule. Can be natural language or formatted (e.g. '15 phút nữa', '2 tiếng nữa', 'chiều mai lúc 2h', '8h tối nay', '2026-09-15 14:00', 'tomorrow at 3pm').\n" +
      "- kind (optional string): 'once' (default), 'daily', 'weekly', or 'interval'.\n" +
      "- time_of_day (optional string): 'HH:mm' (e.g. '14:00') if kind is 'daily' or 'weekly'.\n" +
      "- day_of_week (optional number): 0 (Sun) to 6 (Sat) if kind is 'weekly'.\n" +
      "- every (optional number): Interval step count if kind is 'interval' (e.g. 1, 2, 30).\n" +
      "- unit (optional string): 'minutes' or 'hours' if kind is 'interval'.\n" +
      "- prompt (optional string): Spoken reminder or prompt for Cyrene when the task fires. Defaults to reminding Master of the title.",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task or event (e.g. 'Study math', 'Team meeting')" },
        date_time: { type: "string", description: "Date and time for 'once' schedule. Can be natural language or formatted (e.g. '15 phút nữa', '2 tiếng nữa', 'chiều mai lúc 2h', '8h tối nay', '2026-09-15 14:00', 'tomorrow at 3pm')" },
        kind: { type: "string", enum: ["once", "daily", "weekly", "interval"], description: "Schedule type, default 'once'" },
        time_of_day: { type: "string", description: "Time of day in HH:mm format for daily/weekly schedules (e.g. '14:00')" },
        day_of_week: { type: "number", description: "Day of week 0-6 (0=Sunday, 1=Monday... 6=Saturday) for weekly schedules" },
        every: { type: "number", description: "Interval step count if kind is 'interval' (e.g. 1, 2, 30)" },
        unit: { type: "string", enum: ["minutes", "hours"], description: "Interval unit if kind is 'interval'" },
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
        // Temporal common sense check: do not schedule events in the past
        if (parsedDate.getTime() < now.getTime() - 60_000) {
          const pastStr = `${parsedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} on ${parsedDate.toLocaleDateString()}`;
          const nowStr = `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} on ${now.toLocaleDateString()}`;
          const tomorrow = new Date(parsedDate);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toLocaleDateString();
          return `[schedule_task Error] The requested time "${rawDateTime}" (${pastStr}) has already passed relative to the current time (${nowStr}). Scheduled reminders cannot be set in the past. Please ask Master if they meant tomorrow (${tomorrowStr}) or another future date/time.`;
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

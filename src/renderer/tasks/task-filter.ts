export interface ScheduleConfig {
  kind: "once" | "daily" | "weekly" | "interval";
  runAt?: string;
  timeOfDay?: string;
  dayOfWeek?: number;
  every?: number;
  unit?: "minutes" | "hours";
}

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  schedule: ScheduleConfig;
  nextFireAt: string | null;
  lastFiredAt?: string;
}

export type TaskCategory = "study" | "work" | "meeting" | "reminder";

export interface TaskCategoryMeta {
  id: TaskCategory;
  name: string;
  icon: string;
  svgIcon: string;
  badgeClass: string;
}

export const TASK_CATEGORY_ICONS: Record<TaskCategory, string> = {
  study: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  work: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  meeting: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  reminder: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

export const TASK_CATEGORIES: Record<TaskCategory, TaskCategoryMeta> = {
  study: {
    id: "study",
    name: "Study",
    icon: "study",
    svgIcon: TASK_CATEGORY_ICONS.study,
    badgeClass: "category-badge--study",
  },
  work: {
    id: "work",
    name: "Work",
    icon: "work",
    svgIcon: TASK_CATEGORY_ICONS.work,
    badgeClass: "category-badge--work",
  },
  meeting: {
    id: "meeting",
    name: "Meeting",
    icon: "meeting",
    svgIcon: TASK_CATEGORY_ICONS.meeting,
    badgeClass: "category-badge--meeting",
  },
  reminder: {
    id: "reminder",
    name: "Reminder",
    icon: "reminder",
    svgIcon: TASK_CATEGORY_ICONS.reminder,
    badgeClass: "category-badge--reminder",
  },
};

const CATEGORY_REGEX: Record<TaskCategory, RegExp> = {
  study: /\b(?:study|class|learn|homework|exam|lecture|school|read|course|lesson|tutorial|math|physics|english|history)\b|📚|\[study\]/i,
  work: /\b(?:work|project|code|commit|review|deploy|fix|bug|task|feature|backend|frontend|release|client|report)\b|💼|\[work\]/i,
  meeting: /\b(?:meeting|meet|call|sync|standup|interview|discussion|conference|presentation|1-on-1|zoom|huddle)\b|👥|\[meeting\]/i,
  reminder: /\b(?:reminder|routine|habit|water|medicine|break|rest|exercise|stretch|sleep|workout|lunch|dinner)\b|⏰|\[reminder\]/i,
};

export function inferTaskCategory(task: ScheduledTask): TaskCategory {
  const text = `${task.title} ${task.prompt}`;
  if (CATEGORY_REGEX.study.test(text)) return "study";
  if (CATEGORY_REGEX.meeting.test(text)) return "meeting";
  if (CATEGORY_REGEX.work.test(text)) return "work";
  if (CATEGORY_REGEX.reminder.test(text)) return "reminder";
  return "work";
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getWeekDays(anchorDate: Date): Date[] {
  const start = new Date(anchorDate);
  start.setHours(0, 0, 0, 0);
  const dayOfWeek = start.getDay(); // 0 = Sun
  start.setDate(start.getDate() - dayOfWeek);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

export function getTasksForCalendarDay(tasks: ScheduledTask[], targetDate: Date): ScheduledTask[] {
  return tasks.filter((task) => {
    if (!task.enabled) return false;
    const kind = task.schedule?.kind;

    if (kind === "daily" || kind === "interval") {
      return true;
    }

    if (kind === "weekly") {
      const taskDow = task.schedule.dayOfWeek ?? 0;
      return targetDate.getDay() === taskDow;
    }

    if (kind === "once") {
      if (task.schedule.runAt) {
        const runAt = new Date(task.schedule.runAt);
        if (!Number.isNaN(runAt.getTime())) {
          return isSameLocalDay(runAt, targetDate);
        }
      }
      if (task.nextFireAt) {
        const fireAt = new Date(task.nextFireAt);
        if (!Number.isNaN(fireAt.getTime())) {
          return isSameLocalDay(fireAt, targetDate);
        }
      }
    }

    if (task.nextFireAt) {
      const fireAt = new Date(task.nextFireAt);
      if (!Number.isNaN(fireAt.getTime()) && isSameLocalDay(fireAt, targetDate)) {
        return true;
      }
    }

    return false;
  });
}

export type SchedulePanelMode = "today" | "upcoming" | "empty";

export interface SchedulePanelItems {
  mode: SchedulePanelMode;
  totalCount: number;
  items: ScheduledTask[];
}

function parseFutureFireAt(task: ScheduledTask, now: Date): Date | null {
  if (!task.enabled || !task.nextFireAt) return null;
  const fireAt = new Date(task.nextFireAt);
  if (Number.isNaN(fireAt.getTime())) return null;
  return fireAt.getTime() >= now.getTime() ? fireAt : null;
}

export function getSchedulePanelItems(
  tasks: ScheduledTask[],
  now = new Date(),
  limit = 3,
): SchedulePanelItems {
  const upcoming = tasks
    .map(task => ({ task, fireAt: parseFutureFireAt(task, now) }))
    .filter((entry): entry is { task: ScheduledTask; fireAt: Date } => entry.fireAt !== null)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  const today = upcoming.filter(entry => isSameLocalDay(entry.fireAt, now));
  const source = today.length > 0 ? today : upcoming;

  return {
    mode: today.length > 0 ? "today" : (upcoming.length > 0 ? "upcoming" : "empty"),
    totalCount: source.length,
    items: source.slice(0, limit).map(entry => entry.task),
  };
}

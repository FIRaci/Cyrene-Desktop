import { describe, expect, it } from "vitest";
import {
  getSchedulePanelItems,
  inferTaskCategory,
  getWeekDays,
  getTasksForCalendarDay,
  type ScheduledTask,
} from "./task-filter";

function task(
  id: string,
  nextFireAt: string | null,
  enabled = true,
  schedule: ScheduledTask["schedule"] = { kind: "daily", timeOfDay: "08:00" },
  prompt = "",
): ScheduledTask {
  return {
    id,
    title: id,
    prompt,
    enabled,
    schedule,
    nextFireAt,
  };
}

describe("getSchedulePanelItems", () => {
  it("shows today's remaining tasks first", () => {
    const now = new Date(2026, 6, 6, 10, 0, 0);
    const result = getSchedulePanelItems([
      task("tomorrow", new Date(2026, 6, 7, 1, 0, 0).toISOString()),
      task("today", new Date(2026, 6, 6, 12, 0, 0).toISOString()),
    ], now);

    expect(result.mode).toBe("today");
    expect(result.totalCount).toBe(1);
    expect(result.items.map(item => item.id)).toEqual(["today"]);
  });

  it("falls back to upcoming tasks when nothing remains today", () => {
    const now = new Date(2026, 6, 6, 10, 0, 0);
    const result = getSchedulePanelItems([
      task("past-today", new Date(2026, 6, 6, 8, 0, 0).toISOString()),
      task("tomorrow", new Date(2026, 6, 7, 8, 0, 0).toISOString()),
    ], now);

    expect(result.mode).toBe("upcoming");
    expect(result.totalCount).toBe(1);
    expect(result.items.map(item => item.id)).toEqual(["tomorrow"]);
  });

  it("ignores disabled tasks and invalid dates", () => {
    const now = new Date(2026, 6, 6, 10, 0, 0);
    const result = getSchedulePanelItems([
      task("disabled", new Date(2026, 6, 6, 12, 0, 0).toISOString(), false),
      task("invalid", "not-a-date"),
    ], now);

    expect(result.mode).toBe("empty");
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });
});

describe("inferTaskCategory", () => {
  it("categorizes tasks accurately by keywords", () => {
    expect(inferTaskCategory(task("Math Lecture", null, true, { kind: "daily" }, "Attend online class"))).toBe("study");
    expect(inferTaskCategory(task("Team Standup", null, true, { kind: "daily" }, "Daily sync meeting with team"))).toBe("meeting");
    expect(inferTaskCategory(task("Backend Refactor", null, true, { kind: "daily" }, "Write code and tests"))).toBe("work");
    expect(inferTaskCategory(task("Morning Jog", null, true, { kind: "daily" }, "Go for a run at the park"))).toBe("health");
    expect(inferTaskCategory(task("Grocery Shopping", null, true, { kind: "daily" }, "Buy groceries at the supermarket"))).toBe("personal");
    expect(inferTaskCategory(task("Draw Character Sketch", null, true, { kind: "daily" }, "Sketch new art design"))).toBe("creative");
    expect(inferTaskCategory(task("Pay Bills", null, true, { kind: "daily" }, "Monthly budget and expense review"))).toBe("finance");
    expect(inferTaskCategory(task("Take Medicine", null, true, { kind: "daily" }, "Health routine reminder"))).toBe("health");
  });

  it("categorizes tasks with emoji or tag prefixes", () => {
    expect(inferTaskCategory(task("📚 Calculus 101", null, true))).toBe("study");
    expect(inferTaskCategory(task("💼 Sprint Planning", null, true))).toBe("work");
    expect(inferTaskCategory(task("👥 Client 1-on-1", null, true))).toBe("meeting");
    expect(inferTaskCategory(task("⏰ Follow up email", null, true))).toBe("reminder");
    expect(inferTaskCategory(task("🏃 Morning Workout", null, true))).toBe("health");
    expect(inferTaskCategory(task("[Study] History assignment", null, true))).toBe("study");
    expect(inferTaskCategory(task("[Creative] Write blog post", null, true))).toBe("creative");
    expect(inferTaskCategory(task("[Finance] Tax preparation", null, true))).toBe("finance");
    expect(inferTaskCategory(task("[Personal] Family dinner", null, true))).toBe("personal");
  });

  it("health category takes priority over reminder for fitness tasks", () => {
    // workout/exercise/sleep should resolve to health, not reminder
    expect(inferTaskCategory(task("Yoga Session", null, true, { kind: "daily" }, "Morning yoga routine"))).toBe("health");
    expect(inferTaskCategory(task("Gym Time", null, true, { kind: "daily" }, "Cardio and lift weights"))).toBe("health");
  });
});

describe("getWeekDays", () => {
  it("returns 7 days starting from Sunday", () => {
    const anchor = new Date(2026, 8, 4); // Friday, Sep 4 2026
    const days = getWeekDays(anchor);
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0); // Sunday
    expect(days[5].getDay()).toBe(5); // Friday
    expect(days[5].getDate()).toBe(4);
  });
});

describe("getTasksForCalendarDay", () => {
  it("filters tasks correctly according to schedule kind", () => {
    const friday = new Date(2026, 8, 4); // Friday
    const saturday = new Date(2026, 8, 5); // Saturday

    const dailyTask = task("daily-routine", null, true, { kind: "daily", timeOfDay: "09:00" });
    const fridayOnlyTask = task("friday-meeting", null, true, { kind: "weekly", dayOfWeek: 5, timeOfDay: "14:00" });
    const onceFridayTask = task("once-exam", null, true, { kind: "once", runAt: "2026-09-04T10:00:00.000Z" });
    const disabledTask = task("disabled-task", null, false, { kind: "daily", timeOfDay: "10:00" });

    const all = [dailyTask, fridayOnlyTask, onceFridayTask, disabledTask];

    const fridayTasks = getTasksForCalendarDay(all, friday);
    expect(fridayTasks.map(t => t.id)).toEqual(["daily-routine", "friday-meeting", "once-exam"]);

    const saturdayTasks = getTasksForCalendarDay(all, saturday);
    expect(saturdayTasks.map(t => t.id)).toEqual(["daily-routine"]);
  });
});

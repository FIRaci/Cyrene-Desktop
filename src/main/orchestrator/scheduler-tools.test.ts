import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseDateTimeInput,
  formatFriendlySchedule,
  registerSchedulerTools,
  broadcastSchedulerChanged,
} from "./scheduler-tools";
import { toolRegistry } from "./tool-registry";
import type { ScheduledTask } from "../scheduler/types";

// Mock Electron BrowserWindow
const sendMock = vi.fn();
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { send: sendMock },
      },
    ]),
  },
}));

// Mock scheduler store
const mockTasks: ScheduledTask[] = [];
const mockAddTask = vi.fn((input: any) => {
  const task: ScheduledTask = {
    id: `task-${Date.now()}`,
    title: input.title,
    prompt: input.prompt,
    schedule: input.schedule,
    enabled: true,
    toolMode: "all-enabled",
    allowedToolIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextFireAt: input.schedule.kind === "once" ? input.schedule.runAt : new Date().toISOString(),
  };
  mockTasks.push(task);
  return task;
});

const mockGetTasks = vi.fn(() => [...mockTasks]);
const mockDeleteTask = vi.fn((id: string) => {
  const idx = mockTasks.findIndex((t) => t.id === id);
  if (idx !== -1) {
    mockTasks.splice(idx, 1);
    return true;
  }
  return false;
});

vi.mock("../scheduler/scheduler-store", () => ({
  getSchedulerStore: () => ({
    addTask: mockAddTask,
    getTasks: mockGetTasks,
    deleteTask: mockDeleteTask,
  }),
}));

describe("scheduler-tools", () => {
  beforeEach(() => {
    mockTasks.length = 0;
    vi.clearAllMocks();
  });

  describe("parseDateTimeInput", () => {
    it("returns null for empty or invalid inputs", () => {
      expect(parseDateTimeInput("")).toBeNull();
      expect(parseDateTimeInput("   ")).toBeNull();
      expect(parseDateTimeInput("not a date")).toBeNull();
    });

    it("parses pure date string YYYY-MM-DD defaulting to 09:00 AM", () => {
      const parsed = parseDateTimeInput("2026-09-08");
      expect(parsed).not.toBeNull();
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(8); // September is month 8 (0-indexed)
      expect(parsed?.getDate()).toBe(8);
      expect(parsed?.getHours()).toBe(9);
      expect(parsed?.getMinutes()).toBe(0);
    });

    it("parses YYYY-MM-DD HH:mm format correctly", () => {
      const parsed = parseDateTimeInput("2026-09-08 14:00");
      expect(parsed).not.toBeNull();
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(8);
      expect(parsed?.getDate()).toBe(8);
      expect(parsed?.getHours()).toBe(14);
      expect(parsed?.getMinutes()).toBe(0);
    });

    it("parses DD/MM/YYYY HH:mm format correctly", () => {
      const parsed = parseDateTimeInput("08/09/2026 14:30");
      expect(parsed).not.toBeNull();
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(8);
      expect(parsed?.getDate()).toBe(8);
      expect(parsed?.getHours()).toBe(14);
      expect(parsed?.getMinutes()).toBe(30);
    });

    it("parses time-only format HH:mm relative to reference date", () => {
      const now = new Date(2026, 8, 8, 10, 0, 0); // 10:00 AM
      const parsed = parseDateTimeInput("14:00", now);
      expect(parsed).not.toBeNull();
      expect(parsed?.getHours()).toBe(14);
      expect(parsed?.getMinutes()).toBe(0);
      expect(parsed?.getDate()).toBe(8);
    });

    it("parses casual 'h' and prepositional time formats like '12h30 pm at 10 September'", () => {
      const now = new Date(2026, 8, 10, 10, 0, 0); // 10:00 AM Sept 10, 2026
      const parsed = parseDateTimeInput("12h30 pm at 10 September", now);
      expect(parsed).not.toBeNull();
      expect(parsed?.getMonth()).toBe(8); // September
      expect(parsed?.getDate()).toBe(10);
      expect(parsed?.getHours()).toBe(12);
      expect(parsed?.getMinutes()).toBe(30);
    });

    it("parses casual 14h00 and 8h30 formats", () => {
      const now = new Date(2026, 8, 10, 6, 0, 0);
      const parsed1 = parseDateTimeInput("14h00", now);
      expect(parsed1?.getHours()).toBe(14);
      expect(parsed1?.getMinutes()).toBe(0);

      const parsed2 = parseDateTimeInput("8h30", now);
      expect(parsed2?.getHours()).toBe(8);
      expect(parsed2?.getMinutes()).toBe(30);
    });

    it("parses Vietnamese relative time offsets ('15 phút nữa', '30p nữa', '2 tiếng nữa', '2h nữa')", () => {
      const now = new Date(2026, 8, 12, 10, 0, 0);
      const parsed15m = parseDateTimeInput("15 phút nữa", now);
      expect(parsed15m?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);

      const parsed30p = parseDateTimeInput("30p nữa", now);
      expect(parsed30p?.getTime()).toBe(now.getTime() + 30 * 60 * 1000);

      const parsed2h = parseDateTimeInput("2 tiếng nữa", now);
      expect(parsed2h?.getTime()).toBe(now.getTime() + 2 * 3600 * 1000);

      const parsed2hCasual = parseDateTimeInput("2h nữa", now);
      expect(parsed2hCasual?.getTime()).toBe(now.getTime() + 2 * 3600 * 1000);
    });

    it("parses English relative time offsets ('in 15 minutes', 'in 2 hours')", () => {
      const now = new Date(2026, 8, 12, 10, 0, 0);
      const parsed15m = parseDateTimeInput("in 15 minutes", now);
      expect(parsed15m?.getTime()).toBe(now.getTime() + 15 * 60 * 1000);

      const parsed2h = parseDateTimeInput("in 2 hours", now);
      expect(parsed2h?.getTime()).toBe(now.getTime() + 2 * 3600 * 1000);
    });

    it("parses Vietnamese named days ('chiều mai lúc 2h', '8h tối nay', 'sáng mai 9h', 'ngày kia lúc 10h')", () => {
      const now = new Date(2026, 8, 12, 10, 0, 0); // Saturday 10:00

      // 'chiều mai lúc 2h' -> tomorrow at 14:00 (10:00 today + 28h)
      const parsedTomorrow2pm = parseDateTimeInput("chiều mai lúc 2h", now);
      expect(parsedTomorrow2pm?.getDate()).toBe(13);
      expect(parsedTomorrow2pm?.getHours()).toBe(14);
      expect(parsedTomorrow2pm?.getMinutes()).toBe(0);

      // '8h tối nay' -> today at 20:00
      const parsedTonight8pm = parseDateTimeInput("8h tối nay", now);
      expect(parsedTonight8pm?.getDate()).toBe(12);
      expect(parsedTonight8pm?.getHours()).toBe(20);
      expect(parsedTonight8pm?.getMinutes()).toBe(0);

      // 'sáng mai 9h' -> tomorrow at 09:00
      const parsedTomorrow9am = parseDateTimeInput("sáng mai 9h", now);
      expect(parsedTomorrow9am?.getDate()).toBe(13);
      expect(parsedTomorrow9am?.getHours()).toBe(9);
      expect(parsedTomorrow9am?.getMinutes()).toBe(0);

      // 'ngày kia lúc 10h' -> 2 days later at 10:00
      const parsedDayAfterTomorrow = parseDateTimeInput("ngày kia lúc 10h", now);
      expect(parsedDayAfterTomorrow?.getDate()).toBe(14);
      expect(parsedDayAfterTomorrow?.getHours()).toBe(10);
      expect(parsedDayAfterTomorrow?.getMinutes()).toBe(0);
    });

    it("parses specific date with time ('14h ngày 15/9', 'ngày 15 tháng 9 lúc 2h chiều')", () => {
      const now = new Date(2026, 8, 12, 10, 0, 0);

      const parsed1 = parseDateTimeInput("14h ngày 15/9", now);
      expect(parsed1?.getDate()).toBe(15);
      expect(parsed1?.getMonth()).toBe(8); // September
      expect(parsed1?.getHours()).toBe(14);
      expect(parsed1?.getMinutes()).toBe(0);

      const parsed2 = parseDateTimeInput("ngày 15 tháng 9 lúc 2h chiều", now);
      expect(parsed2?.getDate()).toBe(15);
      expect(parsed2?.getMonth()).toBe(8);
      expect(parsed2?.getHours()).toBe(14);
      expect(parsed2?.getMinutes()).toBe(0);
    });
  });

  describe("formatFriendlySchedule", () => {
    it("formats once schedule", () => {
      const task: ScheduledTask = {
        id: "1",
        title: "Study",
        prompt: "Study prompt",
        schedule: { kind: "once", runAt: "2026-09-08T14:00:00.000Z" },
        nextFireAt: null,
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const formatted = formatFriendlySchedule(task);
      expect(formatted).toBeDefined();
    });

    it("formats daily schedule", () => {
      const task: ScheduledTask = {
        id: "2",
        title: "Daily Standup",
        prompt: "Standup prompt",
        schedule: { kind: "daily", timeOfDay: "09:30" },
        nextFireAt: null,
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(formatFriendlySchedule(task)).toBe("Daily at 09:30");
    });
  });

  describe("registerSchedulerTools & execution", () => {
    it("registers schedule_task, query_scheduled_tasks, and delete_scheduled_task", async () => {
      registerSchedulerTools();
      const all = toolRegistry.getAllTools();
      const ids = all.map((t) => t.id);

      expect(ids).toContain("schedule_task");
      expect(ids).toContain("query_scheduled_tasks");
      expect(ids).toContain("delete_scheduled_task");
    });

    it("rejects scheduling events in the past with a helpful temporal common sense message", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const pastDate = new Date(Date.now() - 3600_000 * 5); // 5 hours ago
      const pastStr = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, "0")}-${String(pastDate.getDate()).padStart(2, "0")} ${String(pastDate.getHours()).padStart(2, "0")}:${String(pastDate.getMinutes()).padStart(2, "0")}`;

      const result = await scheduleTool!.execute({
        title: "Past study session",
        datetime: pastStr,
      });

      expect(result).toContain("[schedule_task Error]");
      expect(result).toContain("has already passed relative to the current time");
      expect(result).toContain("Scheduled reminders cannot be set in the past");
      expect(mockAddTask).not.toHaveBeenCalled();
    });

    it("executes schedule_task for a future date and saves task to store", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const futureDate = new Date(Date.now() + 86400_000 * 3); // 3 days in future
      const futureStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")} 14:00`;

      const result = await scheduleTool!.execute({
        title: "Go to study",
        datetime: futureStr,
        category: "study",
        reminderMinutesBefore: 10,
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Go to study");
      expect(mockAddTask).toHaveBeenCalled();
      expect(sendMock).toHaveBeenCalledWith("scheduler:changed");
    });

    it("executes schedule_task with Vietnamese relative time ('15 phút nữa')", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Take a break",
        date_time: "15 phút nữa",
        prompt: "Master, time for your 15-minute break!",
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Take a break");
      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Take a break",
          prompt: "Master, time for your 15-minute break!",
          schedule: expect.objectContaining({ kind: "once" }),
        })
      );
      expect(sendMock).toHaveBeenCalledWith("scheduler:changed");
    });

    it("executes schedule_task with named day ('chiều mai lúc 2h')", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Client meeting",
        date_time: "chiều mai lúc 2h",
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Client meeting");
      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Client meeting",
          schedule: expect.objectContaining({ kind: "once" }),
        })
      );
    });

    it("executes schedule_task with interval kind", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Drink water reminder",
        kind: "interval",
        every: 30,
        unit: "minutes",
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Drink water reminder");
      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Drink water reminder",
          schedule: { kind: "interval", every: 30, unit: "minutes" },
        })
      );
    });

    it("executes schedule_task with daily kind", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Morning workout",
        kind: "daily",
        time_of_day: "07:00",
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Morning workout");
      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Morning workout",
          schedule: { kind: "daily", timeOfDay: "07:00" },
        })
      );
    });

    it("executes schedule_task with weekly kind", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Weekly team sprint",
        kind: "weekly",
        day_of_week: 1, // Monday
        time_of_day: "10:00",
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Weekly team sprint");
      expect(mockAddTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weekly team sprint",
          schedule: { kind: "weekly", dayOfWeek: 1, timeOfDay: "10:00" },
        })
      );
    });

    it("executes query_scheduled_tasks correctly", async () => {
      registerSchedulerTools();
      mockTasks.push({
        id: "task-123",
        title: "Math homework",
        prompt: "Do math homework",
        schedule: { kind: "once", runAt: "2026-09-08T14:00:00.000Z" },
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextFireAt: "2026-09-08T14:00:00.000Z",
      });

      const queryTool = toolRegistry.getById("query_scheduled_tasks");
      const result = await queryTool!.execute({ date: "2026-09-08" });

      expect(result).toContain("[query_scheduled_tasks] Found 1 task(s)");
      expect(result).toContain("Math homework");
    });

    it("executes delete_scheduled_task by id or title", async () => {
      registerSchedulerTools();
      mockTasks.push({
        id: "task-to-delete",
        title: "Cancel this study session",
        prompt: "Cancel study session",
        schedule: { kind: "once", runAt: "2026-09-08T14:00:00.000Z" },
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextFireAt: "2026-09-08T14:00:00.000Z",
      });

      const deleteTool = toolRegistry.getById("delete_scheduled_task");
      const result = await deleteTool!.execute({ taskId: "task-to-delete" });

      expect(result).toContain("[delete_scheduled_task] Successfully deleted task");
      expect(mockDeleteTask).toHaveBeenCalledWith("task-to-delete");
      expect(sendMock).toHaveBeenCalledWith("scheduler:changed");
    });
  });

  describe("broadcastSchedulerChanged", () => {
    it("sends IPC event to all browser windows", () => {
      broadcastSchedulerChanged();
      expect(sendMock).toHaveBeenCalledWith("scheduler:changed");
    });
  });
});

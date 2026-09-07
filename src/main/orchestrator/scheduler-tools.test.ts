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
  });

  describe("formatFriendlySchedule", () => {
    it("formats once schedule", () => {
      const task: ScheduledTask = {
        id: "1",
        title: "Study",
        prompt: "Study prompt",
        schedule: { kind: "once", runAt: "2026-09-08T14:00:00.000Z" },
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
        nextFireAt: "2026-09-08T14:00:00.000Z",
      };
      const formatted = formatFriendlySchedule(task);
      expect(formatted).toBeTruthy();
    });

    it("formats daily schedule", () => {
      const task: ScheduledTask = {
        id: "2",
        title: "Daily Standup",
        prompt: "Standup prompt",
        schedule: { kind: "daily", timeOfDay: "09:30" },
        enabled: true,
        toolMode: "all-enabled",
        allowedToolIds: [],
        createdAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
        nextFireAt: "2026-09-08T09:30:00.000Z",
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

    it("executes schedule_task and saves task to store", async () => {
      registerSchedulerTools();
      const scheduleTool = toolRegistry.getById("schedule_task");
      expect(scheduleTool).toBeDefined();

      const result = await scheduleTool!.execute({
        title: "Go to study",
        datetime: "2026-09-08 14:00",
        category: "study",
        reminderMinutesBefore: 10,
      });

      expect(result).toContain("[schedule_task] Successfully added to schedule");
      expect(result).toContain("Go to study");
      expect(mockAddTask).toHaveBeenCalled();
      expect(sendMock).toHaveBeenCalledWith("scheduler:changed");
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

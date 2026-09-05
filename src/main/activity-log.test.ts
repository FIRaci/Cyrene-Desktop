import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC } from "../shared/ipc-channels";

describe("activity log IPC and memory purge contract", () => {
  const mainSource = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");
  const preloadSource = fs.readFileSync(path.join(process.cwd(), "src/preload/index.ts"), "utf8");

  it("defines LOG_CLEAR, LOG_PUSH_ENTRY, and LOG_CLEARED channels in IPC constants", () => {
    expect(IPC.LOG_CLEAR).toBe("log:clear");
    expect(IPC.LOG_PUSH_ENTRY).toBe("log:push-entry");
    expect(IPC.LOG_CLEARED).toBe("log:cleared");
  });

  it("registers IPC.LOG_CLEAR to purge main buffer memory and broadcast", () => {
    const clearIdx = mainSource.indexOf("IPC.LOG_CLEAR");
    expect(clearIdx).toBeGreaterThan(0);
    const clearBlock = mainSource.slice(clearIdx, clearIdx + 400);
    expect(clearBlock).toContain("activityLogBuffer.length = 0");
    expect(clearBlock).toContain("IPC.LOG_CLEARED");
  });

  it("registers IPC.LOG_PUSH_ENTRY to forward entries to pushActivityLog", () => {
    const pushIdx = mainSource.indexOf("IPC.LOG_PUSH_ENTRY");
    expect(pushIdx).toBeGreaterThan(0);
    const pushBlock = mainSource.slice(pushIdx, pushIdx + 400);
    expect(pushBlock).toContain("pushActivityLog");
  });

  it("exposes pushEntry, clear, and onCleared in preload activityLogApi", () => {
    const apiIdx = preloadSource.indexOf("const activityLogApi");
    expect(apiIdx).toBeGreaterThan(0);
    const apiBlock = preloadSource.slice(apiIdx, apiIdx + 700);
    expect(apiBlock).toContain("pushEntry:");
    expect(apiBlock).toContain("clear:");
    expect(apiBlock).toContain("onCleared:");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  windows: [] as Array<{ webContents: any }>,
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => process.cwd()) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      electronMock.handlers.set(channel, handler);
    }),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => electronMock.windows) },
}));

import { IPC } from "../shared/ipc-channels";
import { policyFor, registerPermissionIpc, requestApproval } from "./permission";

function webContents(id: number, url: string) {
  return {
    id,
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  };
}

describe("permission IPC sender authorization", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.windows.length = 0;
    registerPermissionIpc();
  });

  it("pins even the trusted settings renderer to the companion-safe level", async () => {
    const handler = electronMock.handlers.get(IPC.PERMISSION_SET_LEVEL)!;
    const chat = webContents(1, "file:///app/renderer/chat/index.html");
    const settings = webContents(2, "file:///app/renderer/settings/index.html");

    expect(handler({ sender: chat }, "full")).toMatchObject({ ok: false });
    expect(handler({ sender: settings }, "full")).toMatchObject({ ok: false });
    expect(handler({ sender: settings }, "read-only")).toMatchObject({ ok: true, level: "read-only" });
  });

  it("allows observation and network but denies mutation and arbitrary commands", () => {
    expect(policyFor("read-only", "fs-read")).toBe("allow");
    expect(policyFor("read-only", "network")).toBe("allow");
    expect(policyFor("read-only", "input-control")).toBe("allow");
    expect(policyFor("read-only", "fs-write")).toBe("deny");
    expect(policyFor("read-only", "shell")).toBe("deny");
  });

  it("sends approvals only to trusted chat renderers and uses an unguessable id", async () => {
    const chat = webContents(10, "http://localhost:5173/chat/");
    const settings = webContents(11, "http://localhost:5173/settings/");
    electronMock.windows.push({ webContents: chat }, { webContents: settings });

    const result = requestApproval({
      toolId: "shell",
      toolName: "Shell",
      toolDescription: "Run command",
      args: {},
      risk: "shell",
    });
    expect(chat.send).toHaveBeenCalledOnce();
    expect(settings.send).not.toHaveBeenCalled();

    const payload = chat.send.mock.calls[0][1] as { id: string };
    expect(payload.id).toMatch(/^approve-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const resolve = electronMock.handlers.get(IPC.PERMISSION_APPROVAL_RESOLVE)!;
    expect(resolve({ sender: settings }, { id: payload.id, allowed: true })).toEqual({ ok: false });
    expect(resolve({ sender: chat }, { id: payload.id, allowed: true })).toEqual({ ok: true });
    await expect(result).resolves.toBe(true);
  });

  it("rejects immediately when no trusted approval UI exists", async () => {
    electronMock.windows.push({ webContents: webContents(20, "https://attacker.example/") });
    await expect(requestApproval({
      toolId: "write",
      toolName: "Write",
      toolDescription: "Write file",
      args: {},
      risk: "fs-write",
    })).resolves.toBe(false);
  });
});

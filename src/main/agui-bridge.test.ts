import { describe, expect, it, vi } from "vitest";
import { Observable } from "rxjs";
import { IPC } from "../shared/ipc-channels";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  runFactory: null as null | (() => Observable<unknown>),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock("./orchestrator/cyrene-agent", () => ({
  CyreneAgent: class {
    threadId: string;
    lastResult?: { reply: string; toolResults: unknown[] };

    constructor(input: { threadId: string }) {
      this.threadId = input.threadId;
    }

    runWithEvents() {
      if (mocks.runFactory) return mocks.runFactory();
      return new Observable((subscriber) => {
        this.lastResult = { reply: "Sending you a hug", toolResults: [] };
        subscriber.next({ type: "RUN_STARTED" });
        subscriber.next({ type: "RUN_FINISHED" });
        subscriber.complete();
      });
    }
  },
}));

vi.mock("./orchestrator/history-tools", () => ({
  indexConversationTurn: vi.fn(),
}));

describe("agui-bridge sticker event ordering", () => {
  it("projects Chat events through a bounded default-deny DTO", async () => {
    const { toChatAgentEvent } = await import("./agui-bridge");

    expect(toChatAgentEvent({
      type: "TOOL_CALL_START",
      toolCallId: "call-1",
      toolCallName: "read_file",
      args: { apiKey: "secret", filePath: "C:/Users/me/private.txt" },
      metadata: { token: "hidden" },
    })).toEqual({ type: "TOOL_CALL_START", toolCallId: "call-1", toolCallName: "read_file" });
    expect(toChatAgentEvent({ type: "TOOL_CALL_ARGS", delta: "Authorization: Bearer secret" })).toBeNull();
    expect(toChatAgentEvent({ type: "TOOL_CALL_RESULT", content: "private file contents" })).toBeNull();
    expect(toChatAgentEvent({ type: "CUSTOM", name: "unknown.private", value: { secret: "hidden" } })).toBeNull();
    expect(toChatAgentEvent({ type: "CUSTOM", name: "cyrene.choice", value: { question: "Continue?" } })).toBeNull();
    expect(toChatAgentEvent({
      type: "CUSTOM", name: "cyrene.taskPlan", value: {
        planId: "plan-1", goal: "Finish safely", planStatus: "running", replanCount: 0, timestamp: 1,
        steps: [{ stepId: "step-1", objective: "Inspect", status: "running", content: "private" }],
        image: "data:image/png;base64," + "A".repeat(800),
      },
    })).toEqual(expect.objectContaining({
      type: "CUSTOM", name: "cyrene.taskPlan",
      value: expect.objectContaining({ goal: "Finish safely", steps: [{ stepId: "step-1", objective: "Inspect", status: "running" }] }),
    }));
    expect(toChatAgentEvent({
      type: "RUN_ERROR",
      code: "UNKNOWN_UPSTREAM",
      message: "Authorization: Bearer secret C:\\Users\\me\\private.txt",
    })).toEqual(expect.objectContaining({
      type: "RUN_ERROR",
      message: "Cyrene could not complete that request. Please try again.",
    }));
  });

  it("delivers sticker side effects before RUN_FINISHED so renderer keeps listening", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const sent: unknown[] = [];
    const sender = {
      id: 101,
      isDestroyed: () => false,
      send: (_channel: string, event: unknown) => {
        sent.push(event);
      },
    };

    registerAgUiIpc(
      async () => ({
        options: {
          settings: { provider: "test", baseUrl: "", model: "", apiKey: "" },
          messages: [],
          timeoutMs: 1000,
          toolSystemContent: "TOOL",
          soulSystemBaseContent: "SOUL",
        },
        latestUserText: "I am tired",
      }),
      async () => {
        sender.send(IPC.AGUI_EVENT, {
          type: "CUSTOM",
          name: "cyrene.sticker",
          value: "hugtight",
        });
      },
      () => ({ webContents: sender as any, isDestroyed: () => false }),
    );

    const handler = mocks.handlers.get(IPC.AGUI_RUN);
    if (!handler) throw new Error("AGUI_RUN handler was not registered");
    await handler({ sender }, { messages: [{ role: "user", content: "I am tired" }], style: "01_default.md" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const eventTypes = sent.map((event) => (event as { type?: string; name?: string }).name ?? (event as { type?: string }).type);
    expect(eventTypes).toEqual(["RUN_STARTED", "cyrene.sticker", "RUN_FINISHED"]);
  });

  it("passes renderer styleId through to build options", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const buildOptions = vi.fn(async () => ({
      options: {
        settings: { provider: "test", baseUrl: "", model: "", apiKey: "" },
        messages: [],
        timeoutMs: 1000,
        toolSystemContent: "TOOL",
        soulSystemBaseContent: "SOUL",
      },
      latestUserText: "hi",
    }));
    const sender = {
      id: 102,
      isDestroyed: () => false,
      send: () => {},
    };

    registerAgUiIpc(buildOptions, async () => {}, () => ({ webContents: sender as any, isDestroyed: () => false }));

    const handler = mocks.handlers.get(IPC.AGUI_RUN);
    if (!handler) throw new Error("AGUI_RUN handler was not registered");
    await handler(
      { sender },
      { messages: [{ role: "user", content: "hi" }], styleId: "lively", executionMode: "chat" },
    );

    expect(buildOptions).toHaveBeenCalledWith(expect.objectContaining({
      styleId: "lively",
      executionMode: "chat",
    }));
  });

  it("uses the injected main-frame sender policy for run and cancel", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const sender = { id: 104, isDestroyed: () => false, send: () => {} };
    const trustedPolicy = vi.fn(() => false);

    registerAgUiIpc(
      async () => ({
        options: {
          settings: { provider: "test", baseUrl: "", model: "", apiKey: "" },
          messages: [], timeoutMs: 1000, toolSystemContent: "TOOL", soulSystemBaseContent: "SOUL",
        },
        latestUserText: "hello",
      }),
      async () => {},
      () => ({ webContents: sender as any, isDestroyed: () => false }),
      undefined,
      () => null,
      trustedPolicy,
    );

    await expect(mocks.handlers.get(IPC.AGUI_RUN)?.(
      { sender, senderFrame: { url: "file:///wrong-frame.html" } },
      { messages: [{ role: "user", content: "hello" }] },
    )).rejects.toThrow("AG-UI request denied.");
    expect(() => mocks.handlers.get(IPC.AGUI_CANCEL)?.(
      { sender, senderFrame: { url: "file:///wrong-frame.html" } },
    )).toThrow("AG-UI request denied.");
    expect(trustedPolicy).toHaveBeenCalledTimes(2);
  });

  it("mirrors the primary agent lifecycle to the pet without creating another run", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const petEvents: unknown[] = [];
    const sender = { id: 103, isDestroyed: () => false, send: () => {} };
    const petWebContents = {
      isDestroyed: () => false,
      send: (channel: string, event: unknown) => {
        if (channel === IPC.PET_AGENT_EVENT) petEvents.push(event);
      },
    };

    registerAgUiIpc(
      async () => ({
        options: {
          settings: { provider: "test", baseUrl: "", model: "", apiKey: "" },
          messages: [],
          timeoutMs: 1000,
          toolSystemContent: "TOOL",
          soulSystemBaseContent: "SOUL",
        },
        latestUserText: "hello",
      }),
      async () => {},
      () => ({ webContents: sender as any, isDestroyed: () => false }),
      undefined,
      () => ({ webContents: petWebContents as any, isDestroyed: () => false }),
    );

    const handler = mocks.handlers.get(IPC.AGUI_RUN);
    if (!handler) throw new Error("AGUI_RUN handler was not registered");
    await handler({ sender }, { messages: [{ role: "user", content: "hello" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(petEvents).toEqual([
      expect.objectContaining({ type: "RUN_STARTED" }),
      expect.objectContaining({ type: "RUN_FINISHED" }),
    ]);
  });

  it("never exposes tool arguments, results, or custom payloads to the pet", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = () => new Observable((subscriber) => {
      subscriber.next({ type: "RUN_STARTED", secret: "hidden" });
      subscriber.next({ type: "TOOL_CALL_START", toolCallName: "read_file", args: { path: "C:/secret.txt" } });
      subscriber.next({ type: "TOOL_CALL_ARGS", delta: "apiKey=secret" });
      subscriber.next({ type: "TOOL_CALL_RESULT", result: "private file contents" });
      subscriber.next({ type: "CUSTOM", value: { token: "private" } });
      subscriber.next({ type: "TEXT_MESSAGE_START", messageId: "internal" });
      subscriber.next({ type: "TEXT_MESSAGE_CONTENT", delta: "Hello", metadata: { secret: true } });
      subscriber.next({ type: "TEXT_MESSAGE_END", metadata: { secret: true } });
      subscriber.complete();
    });
    const { registerAgUiIpc } = await import("./agui-bridge");
    const sender = { id: 104, isDestroyed: () => false, send: () => {} };
    const petEvents: unknown[] = [];
    const pet = { isDestroyed: () => false, send: (channel: string, event: unknown) => {
      if (channel === IPC.PET_AGENT_EVENT) petEvents.push(event);
    } };
    registerAgUiIpc(
      async () => ({ options: {} as any, latestUserText: "hi" }),
      async () => {},
      () => ({ webContents: sender as any, isDestroyed: () => false }),
      undefined,
      () => ({ webContents: pet as any, isDestroyed: () => false }),
    );
    await mocks.handlers.get(IPC.AGUI_RUN)!({ sender }, { messages: [{ role: "user", content: "hi" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(petEvents).toEqual([
      { type: "RUN_STARTED" },
      { type: "TOOL_CALL_START", toolCallName: "read_file" },
      { type: "TEXT_MESSAGE_START" },
      { type: "TEXT_MESSAGE_CONTENT", delta: "Hello" },
      { type: "TEXT_MESSAGE_END" },
    ]);
    expect(JSON.stringify(petEvents)).not.toMatch(/secret|private|path|args|result|metadata/i);
  });

  it("rejects runs and cancellation from a renderer other than the active chat", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const trusted = { id: 201, isDestroyed: () => false, send: () => {} };
    const attacker = { id: 999, isDestroyed: () => false, send: () => {} };
    const buildOptions = vi.fn();
    registerAgUiIpc(buildOptions, async () => {}, () => ({ webContents: trusted as any, isDestroyed: () => false }));

    await expect(mocks.handlers.get(IPC.AGUI_RUN)!({ sender: attacker }, { messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow("AG-UI request denied");
    expect(() => mocks.handlers.get(IPC.AGUI_CANCEL)!({ sender: attacker }))
      .toThrow("AG-UI request denied");
    expect(buildOptions).not.toHaveBeenCalled();
  });

  it("rejects malformed input before building agent options", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const trusted = { id: 202, isDestroyed: () => false, send: () => {} };
    const buildOptions = vi.fn();
    registerAgUiIpc(buildOptions, async () => {}, () => ({ webContents: trusted as any, isDestroyed: () => false }));

    await expect(mocks.handlers.get(IPC.AGUI_RUN)!({ sender: trusted }, { messages: "not-an-array" }))
      .rejects.toThrow("INVALID_REQUEST");
    expect(buildOptions).not.toHaveBeenCalled();
  });

  it("does not expose provider secrets in invoke errors or RUN_ERROR events", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.runFactory = null;
    const { registerAgUiIpc } = await import("./agui-bridge");
    const sent: unknown[] = [];
    const trusted = { id: 203, isDestroyed: () => false, send: (_channel: string, value: unknown) => sent.push(value) };
    registerAgUiIpc(
      async () => { throw new Error("apiKey=super-secret-value provider exploded"); },
      async () => {},
      () => ({ webContents: trusted as any, isDestroyed: () => false }),
    );
    await expect(mocks.handlers.get(IPC.AGUI_RUN)!({ sender: trusted }, { messages: [{ role: "user", content: "hi" }] }))
      .rejects.not.toThrow("super-secret-value");

    mocks.runFactory = () => new Observable((subscriber) => subscriber.error(new Error("token=private-token crash")));
    registerAgUiIpc(
      async () => ({ options: {} as any, latestUserText: "hi" }),
      async () => {},
      () => ({ webContents: trusted as any, isDestroyed: () => false }),
    );
    await mocks.handlers.get(IPC.AGUI_RUN)!({ sender: trusted }, { messages: [{ role: "user", content: "hi" }] });
    expect(JSON.stringify(sent)).not.toContain("private-token");
    expect(sent).toContainEqual(expect.objectContaining({
      type: "RUN_ERROR",
      message: "Cyrene could not complete that request. Please try again.",
    }));
  });

  it("redacts URL credentials, query secrets, paths, and response bodies from diagnostics", async () => {
    const { diagnosticError } = await import("./agui-bridge");
    const output = diagnosticError(new Error(
      'POST https://alice:password@example.test/v1?api_key=topsecret C:\\Users\\Alice\\secret.txt {"upstream":"private response body"}',
    ));
    expect(output).not.toMatch(/alice:password|topsecret|Alice|private response body/);
    expect(output).toContain("<redacted>");
    expect(output).toContain("<path>");
    expect(output).toContain("<response body redacted>");
  });

  it("only cancels runs owned by the current sender", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    let unsubscribed = false;
    mocks.runFactory = () => new Observable(() => () => { unsubscribed = true; });
    const { registerAgUiIpc } = await import("./agui-bridge");
    const first = { id: 301, isDestroyed: () => false, send: () => {} };
    const second = { id: 302, isDestroyed: () => false, send: () => {} };
    let current = first;
    registerAgUiIpc(
      async () => ({ options: {} as any, latestUserText: "hi" }),
      async () => {},
      () => ({ webContents: current as any, isDestroyed: () => false }),
    );
    await mocks.handlers.get(IPC.AGUI_RUN)!({ sender: first }, { messages: [{ role: "user", content: "hi" }] });

    current = second;
    await mocks.handlers.get(IPC.AGUI_CANCEL)!({ sender: second });
    expect(unsubscribed).toBe(false);

    current = first;
    await mocks.handlers.get(IPC.AGUI_CANCEL)!({ sender: first });
    expect(unsubscribed).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockWebSocket, sockets } = vi.hoisted(() => {
  class HoistedMockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = HoistedMockWebSocket.CONNECTING;
    sent: Array<{ data: unknown; options?: unknown }> = [];
    close = vi.fn(() => { this.readyState = 3; });
    terminate = vi.fn(() => { this.readyState = 3; });
    private listeners = new Map<string, Array<(...args: any[]) => void>>();

    constructor(public readonly url: string) { state.sockets.push(this); }
    on(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }
    emit(event: string, ...args: any[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
    send(data: unknown, options?: unknown): void { this.sent.push({ data, options }); }
  }
  const state: { sockets: HoistedMockWebSocket[] } = { sockets: [] };
  return { MockWebSocket: HoistedMockWebSocket, sockets: state.sockets };
});

vi.mock("ws", () => ({ WebSocket: MockWebSocket }));

import { normalizeAsrLanguage, VolcanoAsrStream } from "./volcano-asr-engine";

function serverEvent(socket: InstanceType<typeof MockWebSocket>, name: string, status = 20_000_000): void {
  socket.emit("message", Buffer.from(JSON.stringify({ header: { name, status } })));
}

describe("VolcanoAsrStream lifecycle", () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Token: { Id: "token" } }),
    }));
  });

  it("resolves start only after TranscriptionStarted and flushes queued audio", async () => {
    const stream = new VolcanoAsrStream(vi.fn(), vi.fn(), { startTimeoutMs: 1_000 });
    const started = stream.start("app", "id", "secret", "en");
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];

    stream.sendAudio(Buffer.alloc(6_400, 7));
    let resolved = false;
    void started.then(() => { resolved = true; });
    socket.readyState = MockWebSocket.OPEN;
    socket.emit("open");
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(socket.sent).toHaveLength(1);

    serverEvent(socket, "TranscriptionStarted");
    await started;
    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1].data).toEqual(Buffer.alloc(6_400, 7));
  });

  it.each([
    ["zh", "zh"],
    ["en", "en"],
    ["auto", "auto"],
    ["legacy-or-unsupported", "auto"],
  ] as const)("uses the appkey-bound language fallback for %s", async (language, normalized) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stream = new VolcanoAsrStream(vi.fn(), vi.fn(), { startTimeoutMs: 1_000 });
    const started = stream.start("language-model-appkey", "id", "secret", language);
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    socket.readyState = MockWebSocket.OPEN;
    socket.emit("open");

    const startFrame = JSON.parse(String(socket.sent[0].data)) as {
      header: { appkey: string };
      payload: Record<string, unknown>;
    };
    expect(normalizeAsrLanguage(language)).toBe(normalized);
    expect(startFrame.header.appkey).toBe("language-model-appkey");
    expect(startFrame.payload).not.toHaveProperty("language");
    expect(startFrame.payload).not.toHaveProperty("language_hints");
    expect(log).toHaveBeenCalledWith("[AliyunASR]", `StartTranscription language=${normalized} (configured by appkey)`);

    serverEvent(socket, "TranscriptionStarted");
    await started;
  });

  it("rejects and closes when stopped before the socket opens", async () => {
    const stream = new VolcanoAsrStream(vi.fn(), vi.fn(), { startTimeoutMs: 1_000 });
    const started = stream.start("app", "id", "secret", "en");
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];

    stream.stop();
    await expect(started).rejects.toThrow("stopped");
    expect(socket.terminate).toHaveBeenCalledOnce();
  });

  it("supports aborting token acquisition", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    ));
    const controller = new AbortController();
    const stream = new VolcanoAsrStream(vi.fn(), vi.fn(), { startTimeoutMs: 1_000 });
    const started = stream.start("app", "id", "secret", "en", controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(started).rejects.toThrow("cancelled");
  });

  it("rejects when the readiness handshake times out", async () => {
    vi.useFakeTimers();
    try {
      const stream = new VolcanoAsrStream(vi.fn(), vi.fn(), { startTimeoutMs: 25 });
      const started = stream.start("app", "id", "secret", "en");
      const rejection = expect(started).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(0);
      const socket = sockets[0];
      socket.readyState = MockWebSocket.OPEN;
      socket.emit("open");
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(socket.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

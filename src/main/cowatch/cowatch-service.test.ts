import { describe, it, expect, vi, beforeEach } from "vitest";
import { CoWatchService, type CoWatchServiceDeps, type CoWatchState } from "./cowatch-service";

describe("CoWatchService", () => {
  let deps: CoWatchServiceDeps;
  let broadcastedStates: CoWatchState[];
  let deliveredReactions: string[];
  let loggedEvents: Array<{ type: string; text: string }>;

  beforeEach(() => {
    broadcastedStates = [];
    deliveredReactions = [];
    loggedEvents = [];

    deps = {
      captureScreen: vi.fn().mockResolvedValue({
        filePath: "/tmp/mock-shot.png",
        mime: "image/png",
        previewUrl: "file:///tmp/mock-shot.png",
      }),
      loadModelSettings: vi.fn().mockReturnValue({
        provider: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        apiKey: "sk-test",
      }),
      broadcastState: vi.fn((state) => {
        broadcastedStates.push({ ...state });
      }),
      deliverReaction: vi.fn((reaction) => {
        deliveredReactions.push(reaction);
      }),
      pushLog: vi.fn((type, text) => {
        loggedEvents.push({ type, text });
      }),
      readFileAsync: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "Ôi nhìn cảnh này hồi hộp ghê nè!",
              },
            },
          ],
        }),
      } as unknown as Response),
      intervalMs: 100_000, // Large so timers don't fire unexpectedly in test
      timeoutMs: 1_000,
      speechCooldownMs: 0,
    };
  });

  it("initializes in idle and inactive state", () => {
    const service = new CoWatchService(deps);
    expect(service.isActive()).toBe(false);
    expect(service.getState()).toEqual({
      active: false,
      status: "idle",
      lastCapturedAt: undefined,
      lastReaction: undefined,
      errorMessage: undefined,
    });
  });

  it("starts co-watch, logs start event and triggers capture tick", async () => {
    const service = new CoWatchService(deps);
    const startPromise = service.start();

    expect(service.isActive()).toBe(true);
    expect(loggedEvents.some((e) => e.text.includes("started"))).toBe(true);

    await startPromise;
    // Wait for the async tick to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(deps.captureScreen).toHaveBeenCalled();
    expect(deliveredReactions).toContain("Ôi nhìn cảnh này hồi hộp ghê nè!");
    expect(broadcastedStates.length).toBeGreaterThan(0);

    service.stop();
  });

  it("stops co-watch and updates status to idle", async () => {
    const service = new CoWatchService(deps);
    await service.start();
    const stoppedState = service.stop();

    expect(service.isActive()).toBe(false);
    expect(stoppedState.active).toBe(false);
    expect(stoppedState.status).toBe("idle");
    expect(loggedEvents.some((e) => e.text.includes("stopped"))).toBe(true);
  });

  it("toggles between active and inactive", async () => {
    const service = new CoWatchService(deps);
    expect(service.isActive()).toBe(false);

    service.toggle();
    expect(service.isActive()).toBe(true);

    service.toggle();
    expect(service.isActive()).toBe(false);
  });

  it("handles capture returning null gracefully", async () => {
    deps.captureScreen = vi.fn().mockResolvedValue(null);
    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(service.getState().status).toBe("idle");
    expect(deliveredReactions.length).toBe(0);

    service.stop();
  });

  it("handles model failure without crashing", async () => {
    deps.fetchFn = vi.fn().mockRejectedValue(new Error("Network timeout"));
    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(service.getState().status).toBe("error");
    expect(service.getState().errorMessage).toContain("Network timeout");
    expect(loggedEvents.some((e) => e.type === "error")).toBe(true);

    service.stop();
  });

  it("warns if no API key is set for non-ollama provider", async () => {
    deps.loadModelSettings = vi.fn().mockReturnValue({
      provider: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "",
    });
    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(loggedEvents.some((e) => e.text.includes("No API key configured"))).toBe(true);
    expect(deliveredReactions.length).toBe(0);

    service.stop();
  });

  it("prioritizes loadVisionConfig over primary loadModelSettings when available", async () => {
    deps.loadVisionConfig = vi.fn().mockReturnValue({
      baseUrl: "https://vision.example.test/v1",
      apiKey: "sk-vision-key",
      model: "custom-vision-v1",
    });

    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(deps.fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("vision.example.test"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-vision-key",
        }),
      }),
    );

    service.stop();
  });

  it("suppresses delivery when model responds with SILENT", async () => {
    deps.fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "SILENT",
            },
          },
        ],
      }),
    } as unknown as Response);

    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(deliveredReactions.length).toBe(0);
    service.stop();
  });

  it("cleans long yapping text, removing asterisks and keeping single short sentence", async () => {
    deps.fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "*excitedly* Hi Master! Are they the heroic twin siblings from celestial kingdom? *smiles* Oh my, characters are priceless!",
            },
          },
        ],
      }),
    } as unknown as Response);

    const service = new CoWatchService(deps);
    await service.start();
    await service.tick();

    expect(deliveredReactions.length).toBe(1);
    const delivered = deliveredReactions[0];
    expect(delivered).not.toContain("*");
    expect(delivered).not.toContain("excitedly");
    // Should be truncated to first sentence
    expect(delivered).toBe("Hi Master!");

    service.stop();
  });
});

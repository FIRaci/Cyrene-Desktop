import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AutonomousThoughtController } from "./autonomous-thoughts";
import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import { POUTING_IDLE_THOUGHTS, STUDY_IDLE_THOUGHTS } from "./chat-context-analyzer";

describe("AutonomousThoughtController", () => {
  let bubbles: CompanionBubbleController;
  let kaomoji: FloatingKaomojiController;

  beforeEach(() => {
    vi.useFakeTimers();
    bubbles = {
      isBusy: false,
      think: vi.fn(),
    } as unknown as CompanionBubbleController;
    kaomoji = {
      spawn: vi.fn(),
    } as unknown as FloatingKaomojiController;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("triggers thought and floating kaomoji on triggerNow()", () => {
    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
      thoughts: [{ text: "Thinking of you~", kaomoji: "(｡♥‿♥｡)" }],
      minIntervalMs: 10_000,
      maxIntervalMs: 20_000,
    });

    const triggered = controller.triggerNow();
    expect(triggered).toBe(true);
    expect(bubbles.think).toHaveBeenCalledWith("Thinking of you~", 4500);
    expect(kaomoji.spawn).toHaveBeenCalledWith("(｡♥‿♥｡)");

    controller.dispose();
  });

  it("does not trigger when bubbles are busy", () => {
    (bubbles as any).isBusy = true;
    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
      thoughts: [{ text: "Thinking of you~", kaomoji: "(｡♥‿♥｡)" }],
    });

    const triggered = controller.triggerNow();
    expect(triggered).toBe(false);
    expect(bubbles.think).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("schedules periodic thoughts automatically", () => {
    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
      thoughts: [{ text: "Periodic thought", kaomoji: "(✿◠‿◠)" }],
      minIntervalMs: 1_000,
      maxIntervalMs: 1_000,
    });

    expect(bubbles.think).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1050);
    expect(bubbles.think).toHaveBeenCalledWith("Periodic thought", 4500);
    expect(kaomoji.spawn).toHaveBeenCalledWith("(✿◠‿◠)");

    controller.dispose();
  });

  it("pauses and resumes timer gracefully", () => {
    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
      thoughts: [{ text: "Pause test", kaomoji: "(o^▽^o)" }],
      minIntervalMs: 2_000,
      maxIntervalMs: 2_000,
    });

    controller.pause();
    vi.advanceTimersByTime(3000);
    expect(bubbles.think).not.toHaveBeenCalled();

    controller.resume();
    vi.advanceTimersByTime(2050);
    expect(bubbles.think).toHaveBeenCalledWith("Pause test", 4500);

    controller.dispose();
  });

  it("synchronizes idle thoughts with active chat context (e.g. pouting)", async () => {
    const mockChatStore = {
      getActiveSession: vi.fn().mockResolvedValue("session-123"),
      get: vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: "Sao em lại dỗi anh thế?" },
          { role: "model", content: "Hmph, ai bảo Master trêu em!" },
        ],
      }),
      onChanged: vi.fn(),
      onActiveSessionChanged: vi.fn(),
    };

    vi.stubGlobal("window", {
      chatStore: mockChatStore,
    });

    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
    });

    await controller.refreshContext();
    expect(controller.getCurrentMood()).toBe("pouting");

    controller.triggerNow();
    expect(bubbles.think).toHaveBeenCalled();
    const calledText = (bubbles.think as any).mock.calls[0][0];
    const poutingTexts = POUTING_IDLE_THOUGHTS.map((t) => t.text);
    expect(poutingTexts).toContain(calledText);

    controller.dispose();
  });

  it("synchronizes idle thoughts with study context", async () => {
    const mockChatStore = {
      getActiveSession: vi.fn().mockResolvedValue("session-study"),
      get: vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: "Schedule study session for calculus exam" },
        ],
      }),
      onChanged: vi.fn(),
      onActiveSessionChanged: vi.fn(),
    };

    vi.stubGlobal("window", {
      chatStore: mockChatStore,
    });

    const controller = new AutonomousThoughtController({
      bubbles,
      kaomoji,
    });

    await controller.refreshContext();
    expect(controller.getCurrentMood()).toBe("study");

    controller.triggerNow();
    expect(bubbles.think).toHaveBeenCalled();
    const calledText = (bubbles.think as any).mock.calls[0][0];
    const studyTexts = STUDY_IDLE_THOUGHTS.map((t) => t.text);
    expect(studyTexts).toContain(calledText);

    controller.dispose();
  });
});

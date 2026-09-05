import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AutonomousThoughtController } from "./autonomous-thoughts";
import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";

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
});

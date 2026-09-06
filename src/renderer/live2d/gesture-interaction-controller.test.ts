import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GestureInteractionController,
  sanitizeBubbleSpeech,
  extractSpokenText,
} from "./gesture-interaction-controller";
import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import type { CompanionVoiceService } from "./voice";

describe("sanitizeBubbleSpeech & extractSpokenText", () => {
  it("preserves asterisks actions and slash thoughts in speech bubbles while stripping outer quotes", () => {
    const raw = '*gently nuzzles into your hand* /so warm.../ "Thank you Master!"';
    const cleaned = sanitizeBubbleSpeech(raw);
    expect(cleaned).toContain("*gently nuzzles into your hand*");
    expect(cleaned).toContain("/so warm.../");
    expect(cleaned).toContain("Thank you Master!");
    expect(cleaned).not.toMatch(/^["']/);
  });

  it("extracts clean spoken dialogue for TTS without asterisks (*...*) or thoughts (/.../)", () => {
    const raw = '*gently nuzzles into your hand* /So warm.../ "Thank you Master! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)"';
    const spoken = extractSpokenText(raw);
    expect(spoken).not.toContain("*");
    expect(spoken).not.toContain("/");
    expect(spoken).not.toContain("gently nuzzles");
    expect(spoken).not.toContain("So warm");
    expect(spoken).toBe("Thank you Master!");
  });

  it("returns empty string for action-only or thought-only text so TTS remains silent", () => {
    expect(extractSpokenText("*nuzzles softly into your hand*")).toBe("");
    expect(extractSpokenText("/I wonder what Master is thinking.../")).toBe("");
    expect(extractSpokenText("*smiles* /blushing furiously/")).toBe("");
  });

  it("strips prompt echo headers from speech bubbles", () => {
    const raw = "*When Master pats your head through the screen:* *gently nuzzles* Mmh... Cyrene loves it!";
    const cleaned = sanitizeBubbleSpeech(raw);
    expect(cleaned).not.toContain("When Master");
    expect(cleaned).toContain("*gently nuzzles* Mmh... Cyrene loves it!");
  });

  it("handles clean normal text directly", () => {
    const raw = "Ehehe, having you pat my head feels so lovely~";
    expect(sanitizeBubbleSpeech(raw)).toBe(raw);
    expect(extractSpokenText(raw)).toBe(raw);
  });

  it("clamps oversized paragraphs cleanly", () => {
    const longText =
      "Today is such a beautiful day. Cyrene loves having you by my side. Let's do our best together! And now let's get back to work. Continuing with lots of long sentences to ensure it exceeds the maximum allowed character threshold.";
    const cleaned = sanitizeBubbleSpeech(longText, 160);
    expect(cleaned.length).toBeLessThanOrEqual(160);
    expect(cleaned).toContain("Today is such a beautiful day");
    expect(cleaned).toMatch(/[.!?…]$/);
  });

  it("preserves English contractions (you're, it's, don't) and handles parentheses in spoken text cleanly", () => {
    const raw = "*tilts head* /oh, so warm.../ Aww, you're being so sweet to me, Master! (Next time, pat me even longer!)";
    const cleaned = sanitizeBubbleSpeech(raw);
    expect(cleaned).toContain("you're being so sweet to me");
    expect(cleaned).toContain("Next time, pat me even longer!");

    const spoken = extractSpokenText(raw);
    expect(spoken).toContain("you're being so sweet to me");
    expect(spoken).toContain("Next time, pat me even longer!");
    expect(spoken).not.toContain("(");
    expect(spoken).not.toContain(")");
    expect(spoken).not.toContain("*");
    expect(spoken).not.toContain("/");
  });
});

describe("GestureInteractionController", () => {
  let bubbles: CompanionBubbleController;
  let kaomoji: FloatingKaomojiController;
  let voice: CompanionVoiceService;
  let onExpressionReset: ReturnType<typeof vi.fn>;
  let autonomousThoughts: { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    bubbles = {
      say: vi.fn(),
      think: vi.fn(),
      hide: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
      isBusy: false,
    } as unknown as CompanionBubbleController;

    kaomoji = {
      spawn: vi.fn(),
      spawnBurst: vi.fn(),
      spawnIdle: vi.fn(),
      spawnMusic: vi.fn(),
      dispose: vi.fn(),
    } as unknown as FloatingKaomojiController;

    voice = {
      speak: vi.fn().mockResolvedValue(true),
      isMuted: vi.fn().mockReturnValue(false),
      toggleMute: vi.fn().mockReturnValue(false),
    } as unknown as CompanionVoiceService;

    onExpressionReset = vi.fn();
    autonomousThoughts = {
      pause: vi.fn(),
      resume: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles head-pat gesture with AI streaming, sanitization, voice synthesis, and pauses idle thoughts", async () => {
    let aguiCallback: ((event: any) => void) | null = null;
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
      aguiCallback = cb;
      return () => {
        aguiCallback = null;
      };
    });

    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("active-session-abc");
    const get = vi.fn().mockResolvedValue({
      id: "active-session-abc",
      messages: [{ role: "user", content: "Chào Cyrene" }],
    });

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession, get },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
      onExpressionReset,
      autonomousThoughts,
    });

    const patPromise = controller.handleHeadPat(150, 200);

    // Immediate visual feedback & idle thoughts paused
    expect(kaomoji.spawn).toHaveBeenCalledWith("(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)", 150, 200);
    expect(bubbles.think).toHaveBeenCalledWith("(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 唔…", 30000);
    expect(onExpressionReset).toHaveBeenCalled();
    expect(autonomousThoughts.pause).toHaveBeenCalled();

    await patPromise;

    // Verify agui.run called with action prompt framing
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "active-session-abc",
        executionMode: "chat",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Chào Cyrene" }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("pats your head"),
          }),
        ]),
      }),
    );

    // Simulate streaming events with roleplay asterisks and thoughts
    expect(aguiCallback).not.toBeNull();
    aguiCallback!({
      type: "TEXT_MESSAGE_CONTENT",
      delta: '*gently blinks* /so sweet.../ "Ehehe~ ',
    });
    expect(bubbles.say).toHaveBeenCalledWith("*gently blinks* /so sweet.../ Ehehe~", 60000);

    aguiCallback!({
      type: "TEXT_MESSAGE_CONTENT",
      delta: 'I love you Master! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)"',
    });
    expect(bubbles.say).toHaveBeenCalledWith("*gently blinks* /so sweet.../ Ehehe~ I love you Master! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)", 60000);

    // Finish run
    aguiCallback!({ type: "RUN_FINISHED" });

    // Verify bubbles, voice, and kaomoji — model turn persistence is now agui-bridge's responsibility
    expect(bubbles.say).toHaveBeenCalledWith("*gently blinks* /so sweet.../ Ehehe~ I love you Master! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)", 5000);
    expect(kaomoji.spawn).toHaveBeenCalledTimes(1);
    expect(voice.speak).toHaveBeenCalledWith("Ehehe~ I love you Master!");
    // User turn is pre-appended by the gesture controller (clean display, not verbose prompt)
    expect(append).toHaveBeenCalledWith(
      "active-session-abc",
      expect.objectContaining({
        role: "user",
        content: "*Gently pats Cyrene's head*",
      }),
    );
    // Model turn is NOT appended from the renderer — agui-bridge backend persistence handles it
    // to avoid the race condition that caused duplicate messages.
    expect(append).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("handles petting gesture with petting prompt and kaomoji", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockReturnValue(() => {});
    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("default");

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handlePetting(100, 100);

    expect(kaomoji.spawn).toHaveBeenCalledWith("(｡♥‿♥｡)", 100, 100);
    expect(bubbles.think).toHaveBeenCalledWith("(✿◠‿◠) ...", 30000);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("caresses you"),
          }),
        ]),
      }),
    );

    controller.dispose();
  });

  it("enforces 7-second cooldown against repetitive spam", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockReturnValue(() => {});

    vi.stubGlobal("window", {
      agui: { run, onEvent },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    // First interaction
    const patPromise = controller.handleHeadPat();
    expect(controller.isBusy()).toBe(true);

    // Immediate second click should be ignored
    void controller.handleHeadPat();

    await patPromise;
    expect(run).toHaveBeenCalledTimes(1);

    // Even after first promise resolves, within 7s cooldown isBusy() remains true
    expect(controller.isBusy()).toBe(true);

    // Another click during cooldown should also be ignored
    void controller.handleHeadPat();
    expect(run).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("falls back cleanly when agui is offline or returns an error", async () => {
    const run = vi.fn().mockResolvedValue({ success: false, error: "Model offline" });
    const onEvent = vi.fn().mockReturnValue(() => {});
    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("fallback-session");

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      // chatStore must be present so finishFallback can persist the fallback message
      chatStore: { append, getActiveSession },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat();

    expect(bubbles.say).toHaveBeenCalledWith(
      expect.stringContaining("希琳最喜欢你了"),
      4000,
    );
    expect(voice.speak).toHaveBeenCalledWith(
      expect.stringContaining("希琳最喜欢你了"),
    );
    // Fallback message is persisted by finishFallback (agui-bridge won't save since run failed)
    expect(append).toHaveBeenCalledWith(
      "fallback-session",
      expect.objectContaining({ role: "model", content: expect.stringContaining("希琳最喜欢你了") }),
    );

    controller.dispose();
  });

  it("handles offline environment where window.agui is undefined", async () => {
    vi.stubGlobal("window", {});

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat();

    expect(bubbles.say).toHaveBeenCalledWith(
      expect.stringContaining("希琳最喜欢你了"),
      4000,
    );
    expect(voice.speak).toHaveBeenCalledWith(
      expect.stringContaining("希琳最喜欢你了"),
    );

    controller.dispose();
  });

  it("resolves active session from list or create when getActiveSession returns null", async () => {
    let aguiCallback: ((event: any) => void) | null = null;
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
      aguiCallback = cb;
      return () => {
        aguiCallback = null;
      };
    });

    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue(null);
    const list = vi.fn().mockResolvedValue([{ id: "session-from-list-xyz" }]);
    const get = vi.fn().mockResolvedValue({
      id: "session-from-list-xyz",
      messages: [],
    });

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession, list, get },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-from-list-xyz",
      }),
    );

    aguiCallback!({ type: "TEXT_MESSAGE_CONTENT", delta: "Hello Master" });
    aguiCallback!({ type: "RUN_FINISHED" });

    // User turn is pre-appended by gesture controller (clean display message)
    expect(append).toHaveBeenCalledWith(
      "session-from-list-xyz",
      expect.objectContaining({
        role: "user",
      }),
    );
    // Model turn persistence is agui-bridge's responsibility — NOT the renderer's
    // This ensures no duplicate messages in the chat window.
    expect(append).toHaveBeenCalledTimes(1);

    controller.dispose();
  });
});


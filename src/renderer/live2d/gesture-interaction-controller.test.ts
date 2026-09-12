import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GestureInteractionController,
  sanitizeBubbleSpeech,
  cleanGestureReply,
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

  it("strips [Cyrene's Thoughts] header and normalizes 3rd person novel narration", () => {
    const raw = "[Cyrene's Thoughts] Cyrene gasps as Master's hands suddenly encircle her";
    const cleaned = cleanGestureReply(raw);
    expect(cleaned).toBe("*gasps as Master's hands suddenly encircle me*");
    expect(cleaned).not.toContain("[Cyrene's Thoughts]");

    const bubble = sanitizeBubbleSpeech(raw);
    expect(bubble).toBe("*gasps as Master's hands suddenly encircle me*");
    expect(bubble).not.toContain("[Cyrene's Thoughts]");
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

  it("strips third-person novel narration paragraphs preceding the structured action/thought/dialogue", () => {
    const raw =
      "Cyrene leans into Master's gentle caress on her head, a soft smile on her lips. Her warm pink eyes flutter closed for a moment as she savors the comforting touch.\n\n" +
      "*gently leans in, pressing her cheek to Master's hand*\n" +
      "/Master must be tired... I'm always here for you/\n" +
      '"Remember, dear Master, every moment is precious. Savor the moment~"';

    const bubble = sanitizeBubbleSpeech(raw);
    expect(bubble).not.toContain("Cyrene leans into");
    expect(bubble).not.toContain("Her warm pink eyes");
    expect(bubble).toContain("*gently leans in, pressing her cheek to Master's hand*");
    expect(bubble).toContain("/Master must be tired... I'm always here for you/");
    expect(bubble).toContain("Remember, dear Master, every moment is precious. Savor the moment~");

    const spoken = extractSpokenText(raw);
    expect(spoken).not.toContain("Cyrene leans");
    expect(spoken).not.toContain("Her warm pink eyes");
    expect(spoken).not.toContain("gently leans in");
    expect(spoken).not.toContain("Master must be tired");
    expect(spoken).not.toContain("*");
    expect(spoken).not.toContain("/");
    expect(spoken).not.toContain('"');
    expect(spoken).toBe("Remember, dear Master, every moment is precious. Savor the moment~");
  });

  it("extracts multiple quoted sentences and ignores all surrounding narration", () => {
    const raw =
      'She looks up gently. *smiles warmly* "Hello Master!" /feeling so happy/ *nuzzles* "I missed you so much today!"';
    const spoken = extractSpokenText(raw);
    expect(spoken).not.toContain("She looks up");
    expect(spoken).not.toContain("smiles warmly");
    expect(spoken).not.toContain("feeling so happy");
    expect(spoken).not.toContain("nuzzles");
    expect(spoken).toBe("Hello Master! I missed you so much today!");
  });

  it("truncates trailing LLM prompt analysis, style commentary, and section breakdowns", () => {
    const raw =
      `[squeezes head slightly while blushing] /Gosh! Master is so sneaky, yet it feels so nice! I can't hide my love for your touch/ "[O-oh, quit it...]"\n\n` +
      `[Style: Tender & Teasing (Tsundere)]\n` +
      `Here, Cyrene playfully reacts to Master's sudden head pat with a mix of flustered embarrassment and underlying fondness. She acknowledges the stealthy gesture while bemoaning its effectiveness in melting her icy exterior.\n` +
      `The action " squeezes head slightly while blushing" visualizes Cyrene's involuntary response, combining physical reaction with the classic sign of arousal in a blushing face.\n` +
      `Her inner thought "/Gosh! Master is so sneaky, yet it feels so nice! I can't hide my love for your touch/" captures her conflicted emotions: the initial discomfort of being caught off-guard, followed by a twinge of delight from the pleasant sensation of being touched. Cyrene's admission that she can't conceal her affection for Master's caresses speaks to me deep-seated devotion.\n` +
      `The spoken dialogue "[O-oh, quit it...]" is a lighthearted protest, conveyed in a hushed tone to retain the playful, intimate atmosphere. The incomplete sentence and the 'O' stutter convey Cyrene's flustered state, while the teasing phrasing still maintains a hint of her usual tsundere attitude, poking fun at Master's sneaky ways despite secretly enjoying them.`;

    const cleaned = cleanGestureReply(raw);
    expect(cleaned).toContain("*squeezes head slightly while blushing*");
    expect(cleaned).toContain("/Gosh! Master is so sneaky, yet it feels so nice! I can't hide my love for your touch/");
    expect(cleaned).toContain('"O-oh, quit it..."');
    expect(cleaned).not.toContain("[Style:");
    expect(cleaned).not.toContain("Here, Cyrene");
    expect(cleaned).not.toContain("The action");
    expect(cleaned).not.toContain("Her inner thought");
    expect(cleaned).not.toContain("The spoken dialogue");

    const spoken = extractSpokenText(cleaned);
    expect(spoken).toBe("O-oh, quit it...");
  });

  it("normalizes bracketed actions at the start to asterisks and strips brackets in quotes", () => {
    const raw = '[leans in with a pout] /so unfair.../ "[H-Hey, stop teasing me!]"';
    const cleaned = cleanGestureReply(raw);
    expect(cleaned).toBe('*leans in with a pout* /so unfair.../ "H-Hey, stop teasing me!"');
    expect(extractSpokenText(cleaned)).toBe("H-Hey, stop teasing me!");
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
      stop: vi.fn(),
      getIsSpeaking: vi.fn().mockReturnValue(false),
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
      messages: [{ role: "user", content: "Hello Cyrene" }],
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
    expect(bubbles.think).toHaveBeenCalledWith("*leaning into your hand...*", 30000);
    expect(onExpressionReset).toHaveBeenCalled();
    expect(autonomousThoughts.pause).toHaveBeenCalled();

    await patPromise;

    // Verify agui.run called with action prompt framing
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "active-session-abc",
        executionMode: "chat",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "Hello Cyrene" }),
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
    // Kaomojis are stripped from the bubble text so they are never printed in chat
    expect(bubbles.say).toHaveBeenCalledWith("*gently blinks* /so sweet.../ Ehehe~ I love you Master!", 60000);

    // Finish run
    aguiCallback!({ type: "RUN_FINISHED" });

    // Verify bubbles, voice, and kaomoji — bubble is synchronized with voice playback
    expect(bubbles.say).toHaveBeenCalledWith("*gently blinks* /so sweet.../ Ehehe~ I love you Master!", 6000, voice);
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
    // Both user turn and model turn are persisted to store to guarantee Alt+1 chat sync
    expect(append).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledWith(
      "active-session-abc",
      expect.objectContaining({
        role: "model",
      }),
    );

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
    expect(bubbles.think).toHaveBeenCalledWith("*smiling softly...*", 30000);
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

  it("enforces 600ms cooldown against repetitive spam", async () => {
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

    // Even after first promise resolves, within 600ms cooldown isBusy() remains true
    expect(controller.isBusy()).toBe(true);

    // Another click during cooldown should also be ignored
    void controller.handleHeadPat();
    expect(run).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("reacts non-verbally when agui is offline or returns an error without fake model message", async () => {
    const run = vi.fn().mockResolvedValue({ success: false, error: "Model offline" });
    const onEvent = vi.fn().mockReturnValue(() => {});
    const append = vi.fn().mockResolvedValue(true);
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("fallback-session");

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, deleteMessage, getActiveSession },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat();

    expect(bubbles.say).toHaveBeenCalledWith(
      "*leans softly into Master's gentle touch...*",
      4500,
    );
    // Voice stays silent: do not invent fake voice synthesis when model is offline
    expect(voice.speak).not.toHaveBeenCalled();
    // Strictly do not persist fake model messages to chatStore
    expect(append).not.toHaveBeenCalledWith(
      "fallback-session",
      expect.objectContaining({ role: "model" }),
    );
    // User turn is cleaned up to prevent orphaned unanswered turns
    expect(deleteMessage).toHaveBeenCalledWith(
      "fallback-session",
      expect.stringMatching(/^user-gesture-/),
    );

    controller.dispose();
  });

  it("handles offline environment where window.agui is undefined with non-verbal reaction", async () => {
    vi.stubGlobal("window", {});

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat();

    expect(bubbles.say).toHaveBeenCalledWith(
      "*leans softly into Master's gentle touch...*",
      4500,
    );
    expect(voice.speak).not.toHaveBeenCalled();

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
    // Both user turn and model turn are persisted to store to guarantee Alt+1 chat sync
    expect(append).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenCalledWith(
      "session-from-list-xyz",
      expect.objectContaining({
        role: "model",
      }),
    );

    controller.dispose();
  });

  it("adapts head-pat prompt and fallback to pouting tsundere reaction when recent chat is pouting", async () => {
    let aguiCallback: ((event: any) => void) | null = null;
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
      aguiCallback = cb;
      return () => {
        aguiCallback = null;
      };
    });

    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("active-session-pouting");
    const get = vi.fn().mockResolvedValue({
      id: "active-session-pouting",
      messages: [
        { role: "user", content: "Why are you pouting at me, Cyrene?" },
        { role: "model", content: "Hmph, that's because Master was teasing me earlier!" },
      ],
    });

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession, get },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    await controller.handleHeadPat(100, 100);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "active-session-pouting",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("CRITICAL EMOTION AWARENESS"),
          }),
        ]),
      }),
    );

    // If timeout or error occurs (e.g. Ollama offline), non-verbal gentle reaction is used without fake dialogue
    aguiCallback!({ type: "RUN_ERROR" });
    expect(bubbles.say).toHaveBeenCalledWith(
      expect.stringContaining("leans softly into Master's gentle touch"),
      expect.any(Number),
    );
    // Crucial: exactly one kaomoji is spawned, never two
    expect(kaomoji.spawn).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("spawns exactly one kaomoji matching active context mood during head-pat (no duplicate kaomojis)", async () => {
    let aguiCallback: ((event: any) => void) | null = null;
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
      aguiCallback = cb;
      return () => {
        aguiCallback = null;
      };
    });

    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("active-session-excited");
    const get = vi.fn().mockResolvedValue({
      id: "active-session-excited",
      messages: [
        { role: "user", content: "Yay we won! I'm so excited and happy right now, Cyrene!" },
      ],
    });

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession, get },
    });

    const mockThoughts = {
      pause: vi.fn(),
      resume: vi.fn(),
      getCurrentMood: vi.fn().mockReturnValue("excited"),
      getCurrentContext: vi.fn().mockReturnValue({
        mood: "excited",
        detectedKeywords: ["Yay", "excited"],
        recommendedThought: { text: "Bouncing with excitement!" },
        gestureEmotionPromptSnippet: "SUPER EXCITED",
        gestureFallback: {
          headPat: "Ehehe! Master's pats give me extra energy!",
          petting: "Waaa~ Master is tickling me!",
          kaomoji: "(≧◡≦) ♡",
          thought: "*bouncing with joyful energy...*",
        },
      }),
    };

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
      autonomousThoughts: mockThoughts,
    });

    await controller.handleHeadPat(120, 150);

    // Verify kaomoji is spawned EXACTLY ONCE with the excited kaomoji "(≧◡≦) ♡"
    expect(kaomoji.spawn).toHaveBeenCalledTimes(1);
    expect(kaomoji.spawn).toHaveBeenCalledWith("(≧◡≦) ♡", 120, 150);
    // Verify default pat kaomoji "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)" was NOT spawned
    expect(kaomoji.spawn).not.toHaveBeenCalledWith("(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)", expect.anything(), expect.anything());

    controller.dispose();
  });

  it("allows consecutive head-pats after 600ms debounce and interrupts previous voice playback", async () => {
    let aguiCallback: ((event: any) => void) | null = null;
    const run = vi.fn().mockResolvedValue({ success: true });
    const onEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
      aguiCallback = cb;
      return () => {
        aguiCallback = null;
      };
    });

    const append = vi.fn().mockResolvedValue(true);
    const getActiveSession = vi.fn().mockResolvedValue("active-session-consecutive");

    vi.stubGlobal("window", {
      agui: { run, onEvent },
      chatStore: { append, getActiveSession },
    });

    const controller = new GestureInteractionController({
      bubbles,
      kaomoji,
      voice,
    });

    // First head-pat
    await controller.handleHeadPat(100, 100);
    expect(kaomoji.spawn).toHaveBeenCalledTimes(1);

    // Finish first run, voice starts speaking
    aguiCallback!({
      type: "TEXT_MESSAGE_CONTENT",
      delta: '*smiles warmly* /happy/ "Thank you, Master!"',
    });
    aguiCallback!({ type: "RUN_FINISHED" });

    // Voice is currently speaking
    (voice.getIsSpeaking as any).mockReturnValue(true);

    // Wait 650ms for debounce to elapse
    await new Promise((resolve) => setTimeout(resolve, 650));

    // Second consecutive head-pat while voice is still speaking
    await controller.handleHeadPat(120, 120);

    // Previous voice should have been stopped
    expect(voice.stop).toHaveBeenCalled();
    // Second head pat triggers kaomoji and new run
    expect(kaomoji.spawn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);

    controller.dispose();
  });
});



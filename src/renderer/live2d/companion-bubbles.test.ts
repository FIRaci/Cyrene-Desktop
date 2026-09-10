import { describe, expect, it, vi } from "vitest";
import {
  CompanionBubbleController,
  PET_SPEECH_LIMIT,
  reducePetBubbleState,
  renderFormattedSpeech,
  truncatePetSpeech,
  type PetBubbleState,
} from "./companion-bubbles";

const idle: PetBubbleState = {
  speech: "",
  thought: "",
  speechVisible: false,
  thoughtVisible: false,
  terminal: false,
};

describe("pet companion bubble lifecycle", () => {
  it("shows a thought while the primary agent reasons and works", () => {
    const thinking = reducePetBubbleState(idle, { type: "RUN_STARTED" });
    expect(thinking).toMatchObject({ thought: "Thinking…", thoughtVisible: true });

    const working = reducePetBubbleState(thinking, {
      type: "TOOL_CALL_START",
      toolCallName: "weather",
    });
    expect(working).toMatchObject({ thought: "Working with weather…", thoughtVisible: true });
  });

  it("replaces thought status with streamed reply text", () => {
    const thinking = reducePetBubbleState(idle, { type: "RUN_STARTED" });
    const speaking = reducePetBubbleState(thinking, {
      type: "TEXT_MESSAGE_CONTENT",
      delta: "I'm right here with you.",
    });
    expect(speaking).toMatchObject({
      speech: "I'm right here with you.",
      speechVisible: true,
      thoughtVisible: false,
    });
    expect(reducePetBubbleState(speaking, { type: "RUN_FINISHED" }).terminal).toBe(true);
  });

  it("bounds long streaming replies while preserving the newest speech", () => {
    const value = truncatePetSpeech(`start ${"x".repeat(PET_SPEECH_LIMIT)} newest`);
    expect(value.length).toBe(PET_SPEECH_LIMIT);
    expect(value.startsWith("…")).toBe(true);
    expect(value.endsWith("newest")).toBe(true);
  });

  it("does not expose raw provider errors in the thought bubble", () => {
    const failed = reducePetBubbleState(idle, {
      type: "RUN_ERROR",
      delta: "secret provider response",
    });
    expect(failed.thought).toBe("I ran into a problem.");
  });

  it("displays instant speech when say() is invoked", () => {
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    controller.say("Cyrene is here~ ✨", 3000);
    expect(speechEl.textContent).toBe("Cyrene is here~ ✨");
    expect(speechEl.hidden).toBe(false);
    expect(thoughtEl.hidden).toBe(true);
    controller.dispose();
  });

  it("displays instant thought when think() is invoked", () => {
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    controller.think("Cyrene đang nhớ bạn đó... (*´˘`*)♡", 4000);
    expect(thoughtEl.textContent).toBe("Cyrene đang nhớ bạn đó... (*´˘`*)♡");
    expect(thoughtEl.hidden).toBe(false);
    expect(speechEl.hidden).toBe(true);
    controller.dispose();
  });

  it("allows say() to override an active thinking state and immediately dismiss thought", () => {
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    // Agent starts running -> enters thinking state
    controller.handle({ type: "RUN_STARTED" });
    expect(thoughtEl.textContent).toBe("Thinking…");
    expect(thoughtEl.hidden).toBe(false);
    expect(speechEl.hidden).toBe(true);

    // When agent reply is delivered, say() must NOT be blocked by isBusy thought
    controller.say("Hello Master! Cyrene is back~", 4000);
    expect(thoughtEl.hidden).toBe(true);
    expect(speechEl.hidden).toBe(false);
    expect(speechEl.textContent).toBe("Hello Master! Cyrene is back~");
    controller.dispose();
  });

  it("immediately clears thinking bubble when clearThought() is called", () => {
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    controller.think("Thinking...", 5000);
    expect(thoughtEl.hidden).toBe(false);

    controller.clearThought();
    expect(thoughtEl.hidden).toBe(true);
    expect(thoughtEl.textContent).toBe("");
    controller.dispose();
  });

  it("hides immediately on RUN_FINISHED when no speech is present", () => {
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    controller.handle({ type: "RUN_STARTED" });
    expect(thoughtEl.hidden).toBe(false);

    controller.handle({ type: "RUN_FINISHED" });
    expect(thoughtEl.hidden).toBe(true);
    expect(speechEl.hidden).toBe(true);
    controller.dispose();
  });

  it("auto-dismisses non-terminal thought after 15s safety watchdog", () => {
    vi.useFakeTimers();
    const speechEl = { textContent: "", hidden: true } as HTMLElement;
    const thoughtEl = { textContent: "", hidden: true } as HTMLElement;
    const controller = new CompanionBubbleController(speechEl, thoughtEl);

    controller.handle({ type: "RUN_STARTED" });
    expect(thoughtEl.hidden).toBe(false);

    vi.advanceTimersByTime(15000);
    expect(thoughtEl.hidden).toBe(true);
    controller.dispose();
    vi.useRealTimers();
  });

  it("formats asterisk actions cleanly with renderFormattedSpeech", () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => ({ tagName: tag, className: "", textContent: "" }),
      createTextNode: (text: string) => ({ textContent: text }),
    });

    const children: any[] = [];
    const fakeEl: any = {
      textContent: "",
      replaceChildren: () => {
        children.length = 0;
      },
      appendChild: (child: any) => {
        children.push(child);
      },
    };

    renderFormattedSpeech(fakeEl, "*gently blinks* /so sweet.../ Thank you Master!");
    expect(children.length).toBe(4);
    expect(children[0].className).toBe("pet-bubble__action");
    expect(children[0].textContent).toBe("*gently blinks*");
    expect(children[1].textContent).toBe(" ");
    expect(children[2].className).toBe("pet-bubble__thought-inline");
    expect(children[2].textContent).toBe("/so sweet.../");
    expect(children[3].textContent).toBe(" Thank you Master!");

    vi.unstubAllGlobals();
  });

  it("strips [Cyrene's Thoughts] and normalizes third-person novel narration in renderFormattedSpeech", () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => ({ tagName: tag, className: "", textContent: "" }),
      createTextNode: (text: string) => ({ textContent: text }),
    });

    const children: any[] = [];
    const fakeEl: any = {
      textContent: "",
      replaceChildren: () => {
        children.length = 0;
      },
      appendChild: (child: any) => {
        children.push(child);
      },
    };

    renderFormattedSpeech(fakeEl, "[Cyrene's Thoughts] Cyrene gasps as Master's hands suddenly encircle her");
    expect(children.length).toBe(1);
    expect(children[0].className).toBe("pet-bubble__action");
    expect(children[0].textContent).toBe("*gasps as Master's hands suddenly encircle me*");

    vi.unstubAllGlobals();
  });

  it("handles wheel scrolling and drag-to-scroll with interactive notifications", () => {
    const listeners: Record<string, Function[]> = {};
    const setInteractiveMock = vi.fn();
    vi.stubGlobal("window", {
      cyrene: { setInteractive: setInteractiveMock },
    });

    const fakeSpeechEl: any = {
      textContent: "",
      hidden: true,
      scrollTop: 0,
      addEventListener: (type: string, fn: Function) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };
    const fakeThoughtEl: any = {
      textContent: "",
      hidden: true,
      scrollTop: 0,
      addEventListener: (type: string, fn: Function) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: vi.fn(),
    };

    const controller = new CompanionBubbleController(fakeSpeechEl, fakeThoughtEl);

    // 1. Pointer enter triggers interactivity
    expect(listeners["pointerenter"]).toBeDefined();
    listeners["pointerenter"][0]();
    expect(setInteractiveMock).toHaveBeenCalledWith(true);

    // 2. Wheel event scrolls scrollTop and prevents propagation
    const fakeWheelEvent: any = {
      deltaY: 50,
      stopPropagation: vi.fn(),
    };
    listeners["wheel"][0](fakeWheelEvent);
    expect(fakeWheelEvent.stopPropagation).toHaveBeenCalled();
    expect(fakeSpeechEl.scrollTop).toBe(50);

    // 3. Pointer drag-to-scroll ("kéo xuống / kéo lên")
    fakeSpeechEl.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 100 });
    fakeSpeechEl.clientWidth = 190; // scrollbar occupies 190px - 200px
    fakeSpeechEl.clientLeft = 0;

    // 3a. Clicking on scrollbar (clientX = 205 >= left + clientLeft + clientWidth = 200) skips pointer capture
    listeners["pointerdown"][0]({ button: 0, clientX: 205, clientY: 100, pointerId: 1 });
    expect(fakeSpeechEl.setPointerCapture).not.toHaveBeenCalled();

    // 3b. Clicking on content (clientX = 50 < 200) initiates drag-to-scroll
    listeners["pointerdown"][0]({ button: 0, clientX: 50, clientY: 100, pointerId: 1 });
    expect(fakeSpeechEl.setPointerCapture).toHaveBeenCalledWith(1);
    listeners["pointermove"][0]({ clientY: 70, pointerId: 1 }); // drag upwards 30px -> scrolls down 30px
    expect(fakeSpeechEl.scrollTop).toBe(80); // 50 + 30
    listeners["pointerup"][0]({ pointerId: 1 });

    controller.dispose();
    vi.unstubAllGlobals();
  });
});

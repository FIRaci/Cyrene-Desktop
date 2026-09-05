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
});

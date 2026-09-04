import { describe, expect, it } from "vitest";
import {
  CompanionBubbleController,
  PET_SPEECH_LIMIT,
  reducePetBubbleState,
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

    controller.say("昔涟在呢~ ✨", 3000);
    expect(speechEl.textContent).toBe("昔涟在呢~ ✨");
    expect(speechEl.hidden).toBe(false);
    expect(thoughtEl.hidden).toBe(true);
    controller.dispose();
  });
});

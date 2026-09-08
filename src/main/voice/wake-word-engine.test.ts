import { describe, it, expect, vi } from "vitest";
import {
  WakeWordEngine,
  matchWakeWord,
  normalizeForWakeWord,
} from "./wake-word-engine";

describe("WakeWordEngine", () => {
  it("normalizes text and strips punctuation", () => {
    expect(normalizeForWakeWord("Hey, Cyrene! How are you?")).toBe(
      "hey cyrene how are you",
    );
    expect(normalizeForWakeWord("昔涟，你好呀！")).toBe("昔涟 你好呀");
  });

  it("matches keywords correctly across variations", () => {
    expect(matchWakeWord("hey cyrene can you hear me?").matched).toBe(true);
    expect(matchWakeWord("Hello Cyrene").matched).toBe(true);
    expect(matchWakeWord("Xilian, look at this!").matched).toBe(true);
    expect(matchWakeWord("昔涟，陪我聊会儿天吧").matched).toBe(true);
    expect(matchWakeWord("Just normal typing here").matched).toBe(false);
  });

  it("triggers onDetected callback and enters cooldown", () => {
    let now = 1000;
    const engine = new WakeWordEngine({ cooldownMs: 3000 }, () => now);
    engine.start();

    const cb = vi.fn();
    engine.onDetected(cb);

    // 1. Process wake word
    const res1 = engine.processTranscript("Hey Cyrene, what's the weather?");
    expect(res1).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].word).toBe("hey cyrene");

    // 2. Immediately process again within cooldown
    now += 1000;
    const res2 = engine.processTranscript("Hey Cyrene are you there?");
    expect(res2).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);

    // 3. Process after cooldown expires (3000ms)
    now += 3500;
    const res3 = engine.processTranscript("Cyrene please help");
    expect(res3).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("ignores input when disabled", () => {
    const engine = new WakeWordEngine({ enabled: false });
    engine.start();
    const res = engine.processTranscript("Hey Cyrene");
    expect(res).toBe(false);
  });
});

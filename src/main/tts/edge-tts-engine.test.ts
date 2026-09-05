import { describe, expect, it } from "vitest";
import { resolveBestNeuralVoice } from "./edge-tts-engine";

describe("edge-tts-engine", () => {
  it("selects zh-CN-XiaoyiNeural for text with Chinese Hanzi characters", () => {
    expect(resolveBestNeuralVoice("摸摸头，希琳最喜欢你了~")).toBe("zh-CN-XiaoyiNeural");
    expect(resolveBestNeuralVoice("你好呀")).toBe("zh-CN-XiaoyiNeural");
  });

  it("selects Japanese voice for Japanese text", () => {
    expect(resolveBestNeuralVoice("こんにちは、シリーンだよ")).toBe("ja-JP-NanamiNeural");
  });

  it("selects Vietnamese voice for accented Vietnamese text", () => {
    expect(resolveBestNeuralVoice("Chào bạn, mình là Cyrene đây!")).toBe("vi-VN-HoaiMyNeural");
  });

  it("defaults to en-US-AnaNeural for English text, even with kaomoji or emojis", () => {
    expect(resolveBestNeuralVoice("Hello master, Cyrene is always by your side!")).toBe("en-US-AnaNeural");
    expect(resolveBestNeuralVoice("Mmh... Cyrene loves head pats! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) ✨")).toBe("en-US-AnaNeural");
    expect(resolveBestNeuralVoice("Ehehe~ 🌸")).toBe("en-US-AnaNeural");
  });

  it("respects explicitly requested voice override", () => {
    expect(resolveBestNeuralVoice("Hello", "zh-CN-XiaoxiaoNeural")).toBe("zh-CN-XiaoxiaoNeural");
  });
});

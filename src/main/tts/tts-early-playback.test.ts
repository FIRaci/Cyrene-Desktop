import { describe, expect, it } from "vitest"
import { canUseMinimaxStreamingEarly, extractEarlyTtsSegment } from "../../shared/tts-early-playback"

describe("tts early playback guards", () => {
  it("only enables early playback for minimax with auto read and streaming", () => {
    const base = {
      ttsEngine: "minimax",
      ttsAutoRead: true,
      ttsStreaming: true,
      ttsMinimaxKey: "key",
      ttsMinimaxVoiceId: "voice",
    }

    expect(canUseMinimaxStreamingEarly(base)).toBe(true)
    expect(canUseMinimaxStreamingEarly({ ...base, ttsStreaming: false })).toBe(false)
    expect(canUseMinimaxStreamingEarly({ ...base, ttsEngine: "gptsovits" })).toBe(false)
    expect(canUseMinimaxStreamingEarly({ ...base, ttsEngine: "custom-cloud" })).toBe(false)
    expect(canUseMinimaxStreamingEarly({ ...base, ttsMinimaxKey: "" })).toBe(false)
  })

  it("extracts the first complete sentence only after a useful minimum length", () => {
    expect(extractEarlyTtsSegment("OK! More follows.")).toBeNull()
    expect(extractEarlyTtsSegment("Great work today, let us take our time! More follows.")).toEqual({
      segment: "Great work today, let us take our time!",
      remainder: "More follows.",
    })
  })
})

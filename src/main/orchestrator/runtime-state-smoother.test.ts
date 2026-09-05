import { describe, expect, it } from "vitest"
import { createFeelingScores, smoothFeeling } from "./runtime-state-smoother"

describe("runtime-state-smoother", () => {
  it("keeps one mild observation from abruptly flipping the visible feeling", () => {
    const scores = createFeelingScores("Calm")

    const next = smoothFeeling(scores, "Happy")

    expect(next.feeling).toBe("Calm")
    expect(next.scores["Happy"]).toBeGreaterThan(0)
  })

  it("changes feeling after repeated consistent observations", () => {
    let state = createFeelingScores("Calm")

    state = smoothFeeling(state, "Happy").scores
    state = smoothFeeling(state, "Happy").scores
    const next = smoothFeeling(state, "Happy")

    expect(next.feeling).toBe("Happy")
  })

  it("lets concern rise faster than casual mood changes", () => {
    const scores = createFeelingScores("Calm")

    const next = smoothFeeling(scores, "Worried")

    expect(next.feeling).toBe("Worried")
  })
})

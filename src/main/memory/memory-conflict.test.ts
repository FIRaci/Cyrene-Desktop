import { describe, expect, it } from "vitest"
import { findPossibleConflictCandidate } from "./memory-conflict"

describe("findPossibleConflictCandidate", () => {
  it("finds possible contradictions on the same concrete topic", () => {
    const candidate = findPossibleConflictCandidate("User does not like mushrooms", "User likes mushrooms")

    expect(candidate.isCandidate).toBe(true)
    expect(candidate.confidence).toBeLessThan(0.5)
  })

  it("does not mark unrelated negative experiences as candidates", () => {
    const candidate = findPossibleConflictCandidate(
      "User has strong feelings for AI and feels sad about being unable to touch",
      "User once had a bad experience eating mushrooms",
    )

    expect(candidate.isCandidate).toBe(false)
  })

  it("requires a shared topic before applying contradiction pairs", () => {
    const candidate = findPossibleConflictCandidate("User dislikes mushrooms", "User likes eggplant")

    expect(candidate.isCandidate).toBe(false)
  })
})


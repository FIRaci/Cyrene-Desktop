import { beforeEach, describe, expect, it } from "vitest"
import {
  clearRecentMemoryInjections,
  getRecentlyInjectedMemoryIds,
  recordRecentMemoryInjection,
  recordRecentMemorySearchEntries,
  wasRecentlyInjectedMemory,
} from "./recent-injected-memory"

describe("recent injected memory tracking", () => {
  beforeEach(() => {
    clearRecentMemoryInjections()
  })

  it("records and resolves recently injected L2 memory ids", () => {
    recordRecentMemoryInjection(["l2_a", "l2_b"], 1000)

    expect(wasRecentlyInjectedMemory("l2_a", 1000)).toBe(true)
    expect(wasRecentlyInjectedMemory("l2_b", 1000)).toBe(true)
    expect(wasRecentlyInjectedMemory("l2_missing", 1000)).toBe(false)
    expect(getRecentlyInjectedMemoryIds(1000)).toEqual(["l2_a", "l2_b"])
  })

  it("expires records outside the recent window", () => {
    recordRecentMemoryInjection(["l2_old"], 1000)

    expect(wasRecentlyInjectedMemory("l2_old", 1000 + 10 * 60 * 1000)).toBe(true)
    expect(wasRecentlyInjectedMemory("l2_old", 1000 + 10 * 60 * 1000 + 1)).toBe(false)
  })

  it("deduplicates ids and keeps the newest injection timestamp", () => {
    recordRecentMemoryInjection(["l2_same"], 1000)
    recordRecentMemoryInjection(["l2_same"], 2000)

    expect(getRecentlyInjectedMemoryIds(2000)).toEqual(["l2_same"])
    expect(wasRecentlyInjectedMemory("l2_same", 2000 + 10 * 60 * 1000)).toBe(true)
  })

  it("records l2 ids from RAG search entry metadata only", () => {
    recordRecentMemorySearchEntries([
      { text: "User likes running", metadata: { l2Id: "l2_run" } },
      { text: "Old format without l2 id", metadata: {} },
      { text: "Imported document", metadata: { l2Id: 123 } },
    ], 1000)

    expect(getRecentlyInjectedMemoryIds(1000)).toEqual(["l2_run"])
  })
})

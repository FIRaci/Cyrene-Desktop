import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MemoryCandidate } from "./memory-types"

const electronMock = vi.hoisted(() => ({
  userDataDir: "",
}))

const ragMock = vi.hoisted(() => ({
  addL2MemoryVector: vi.fn(),
  searchMemoryEntries: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => electronMock.userDataDir,
  },
}))

vi.mock("../rag/index", () => ragMock)

function readTraceEvents(): Array<Record<string, unknown>> {
  const tracePath = path.join(electronMock.userDataDir, "memory-trace.log")
  if (!fs.existsSync(tracePath)) return []
  return fs.readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("MemoryManager L2 sync", () => {
  beforeEach(() => {
    electronMock.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-manager-"))
    ragMock.addL2MemoryVector.mockReset()
    ragMock.searchMemoryEntries.mockReset()
    ragMock.searchMemoryEntries.mockResolvedValue([])
    vi.resetModules()
  })

  it("creates L2 first, syncs it to RAG with l2Id metadata, then marks it synced", async () => {
    ragMock.addL2MemoryVector.mockResolvedValue("rag_synced")
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User likes mushrooms",
      confidence: 0.91,
      triggerText: "I like mushrooms",
    }

    await memoryManager.writeMemory([candidate])

    const allL2 = await memoryStore.getAllL2()
    const traceEvents = readTraceEvents()
    const addIndex = traceEvents.findIndex((event) => event.op === "l2.add" && event.l2Id === allL2[0].id)
    const syncIndex = traceEvents.findIndex((event) => event.op === "l2.sync.success" && event.l2Id === allL2[0].id)
    const reflectionLogs = await memoryStore.getReflectionLogs()

    expect(allL2).toHaveLength(1)
    expect(allL2[0].syncStatus).toBe("synced")
    expect(allL2[0].ragId).toBe("rag_synced")
    expect(addIndex).toBeGreaterThanOrEqual(0)
    expect(syncIndex).toBeGreaterThan(addIndex)
    expect(traceEvents[syncIndex].ragId).toBe("rag_synced")
    expect(reflectionLogs).toHaveLength(0)
    expect(ragMock.addL2MemoryVector).toHaveBeenCalledWith(
      candidate.content,
      allL2[0].id,
      expect.objectContaining({ confidence: candidate.confidence }),
    )
  })

  it("keeps L2 as sync_failed when RAG write fails", async () => {
    ragMock.addL2MemoryVector.mockRejectedValue(new Error("RAG down"))
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User is refactoring the memory system",
      confidence: 0.95,
      triggerText: "Let's continue refactoring the memory system",
    }

    await memoryManager.writeMemory([candidate])

    const allL2 = await memoryStore.getAllL2()
    const traceEvents = readTraceEvents()
    const addIndex = traceEvents.findIndex((event) => event.op === "l2.add" && event.l2Id === allL2[0].id)
    const failureIndex = traceEvents.findIndex((event) => event.op === "l2.sync.failure" && event.l2Id === allL2[0].id)

    expect(allL2).toHaveLength(1)
    expect(allL2[0].syncStatus).toBe("sync_failed")
    expect(allL2[0].ragId).toBeUndefined()
    expect(addIndex).toBeGreaterThanOrEqual(0)
    expect(failureIndex).toBeGreaterThan(addIndex)
    expect(traceEvents[failureIndex].status).toBe("error")
    expect(traceEvents[failureIndex].error).toBe("RAG down")
  })

  it("does not write inferred L0 candidates into core profile", async () => {
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const candidate: MemoryCandidate = {
      layer: "L0",
      field: "longTermInterests",
      summary: "User only eats mushrooms",
      content: "User only eats mushrooms",
      confidence: 0.65,
      triggerText: "AI infers user preference for safe mushrooms",
      importance: "medium",
      stability: "stable",
      certainty: "inferred",
      attribution: "assistant_inferred",
      evidenceQuotes: ["I will eat something safer this time"],
      contextSummary: "User discusses mushroom safety",
      shouldWrite: true,
      reason: "This is inference, should not enter core persona",
      forbiddenOverclaims: ["only"],
    }

    await memoryManager.writeMemory([candidate])

    const l0 = await memoryStore.getL0()
    expect(l0.longTermInterests).toBe("")
    expect(l0.permanentNote).toBe("")
  })

  it("writes explicit user-attributed L0 candidates", async () => {
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const candidate: MemoryCandidate = {
      layer: "L0",
      field: "preferredName",
      summary: "User wants to be called PBaby",
      content: "User wants to be called PBaby",
      confidence: 0.9,
      triggerText: "Call me PBaby in the future",
      importance: "high",
      stability: "stable",
      certainty: "explicit",
      attribution: "user_explicit",
      evidenceQuotes: ["Call me PBaby in the future"],
      contextSummary: "User explicitly states addressing preference",
      shouldWrite: true,
      reason: "User explicitly expresses addressing preference",
      forbiddenOverclaims: [],
    }

    await memoryManager.writeMemory([candidate])

    const l0 = await memoryStore.getL0()
    expect(l0.preferredName).toBe("User wants to be called PBaby")
  })

  it("writes candidate conflict logs separately when local candidate detection matches", async () => {
    ragMock.addL2MemoryVector.mockResolvedValue("rag_new")
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const existing = await memoryStore.addL2Memory({
      content: "User likes mushrooms",
      triggerText: "I like mushrooms",
      sourceConversationId: "test",
      ragId: "rag_existing",
      isPinned: false,
    })
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_existing",
      text: "User likes mushrooms",
      createdAt: Date.now(),
      score: 0.82,
      metadata: { l2Id: existing.id },
    }])
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User does not like mushrooms",
      confidence: 0.93,
      triggerText: "I do not like mushrooms",
    }

    await memoryManager.writeMemory([candidate])

    const conflictLogs = await memoryStore.getConflictLogs()
    const reflectionLogs = await memoryStore.getReflectionLogs()
    const traceEvents = readTraceEvents()
    const conflictMarkIndex = traceEvents.findIndex((event) => event.op === "l2.conflict.mark" && event.l2Id === existing.id)
    const conflictLogIndex = traceEvents.findIndex((event) => event.op === "conflict.log.add" && event.l2Id === conflictLogs[0]?.sourceL2Id)

    expect(conflictLogs).toHaveLength(1)
    expect(conflictLogs[0]).toMatchObject({
      status: "candidate",
      sourceRagId: "rag_new",
      targetRagId: "rag_existing",
      targetL2Id: existing.id,
      detector: "local",
    })
    expect(conflictLogs[0].conflictScore).toBeGreaterThanOrEqual(35)
    expect(conflictLogs[0].resolverPriority).not.toBe("none")
    expect(conflictLogs[0].resolverStatus).toBe("queued")
    expect(conflictLogs[0].scoringSignals).toMatchObject({
      ragCandidate: true,
      evidenceAvailable: true,
      localContradiction: true,
    })
    expect(ragMock.searchMemoryEntries).toHaveBeenCalledWith(candidate.content, "user_memory", 5, { recordRecall: false })
    expect(conflictMarkIndex).toBeGreaterThanOrEqual(0)
    expect(conflictLogIndex).toBeGreaterThan(conflictMarkIndex)
    expect(traceEvents[conflictLogIndex].details).toMatchObject({
      conflictStatus: "candidate",
      targetL2Id: existing.id,
      detector: "local",
    })
    expect(reflectionLogs).toHaveLength(0)
  })

  it("keeps text-matched candidates below resolver eligibility when RAG metadata has no l2Id", async () => {
    ragMock.addL2MemoryVector.mockResolvedValue("rag_new")
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_existing",
      text: "User likes mushrooms",
      createdAt: Date.now(),
      score: 0.9,
      metadata: {},
    }])
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    await memoryStore.addL2Memory({
      content: "User likes mushrooms",
      triggerText: "I like mushrooms",
      sourceConversationId: "test",
      ragId: "rag_existing",
      isPinned: false,
    })
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User does not like mushrooms",
      confidence: 0.93,
      triggerText: "I do not like mushrooms",
    }

    await memoryManager.writeMemory([candidate])

    const conflictLogs = await memoryStore.getConflictLogs()

    expect(conflictLogs).toHaveLength(1)
    expect(conflictLogs[0].resolverPriority).toBe("none")
    expect(conflictLogs[0].resolverStatus).toBe("not_queued")
    expect(conflictLogs[0].scoringSignals).toMatchObject({
      ragCandidate: false,
      localContradiction: true,
    })
  })

  it("raises RAG-backed candidates when the target memory was recently injected", async () => {
    ragMock.addL2MemoryVector.mockResolvedValue("rag_new")
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    const { recordRecentMemoryInjection } = await import("./recent-injected-memory")
    const existing = await memoryStore.addL2Memory({
      content: "User likes running",
      triggerText: "I like running",
      sourceConversationId: "test",
      ragId: "rag_existing",
      isPinned: false,
    })
    recordRecentMemoryInjection([existing.id])
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_existing",
      text: "User likes running",
      createdAt: Date.now(),
      score: 0.88,
      metadata: { l2Id: existing.id },
    }])
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User dislikes running",
      confidence: 0.91,
      triggerText: "I dislike running",
    }

    await memoryManager.writeMemory([candidate])

    const conflictLogs = await memoryStore.getConflictLogs()

    expect(conflictLogs).toHaveLength(1)
    expect(conflictLogs[0].resolverPriority).toBe("normal")
    expect(conflictLogs[0].resolverStatus).toBe("queued")
    expect(conflictLogs[0].scoringSignals).toMatchObject({
      ragCandidate: true,
      recentInjection: true,
      localContradiction: true,
    })
  })

  it("does not write conflict logs for unrelated negative memories", async () => {
    ragMock.addL2MemoryVector.mockResolvedValue("rag_new")
    ragMock.searchMemoryEntries.mockResolvedValue([{
      id: "rag_existing",
      text: "User had a bad experience eating wild mushrooms",
      createdAt: Date.now(),
      score: 0.81,
      metadata: {},
    }])
    const { memoryManager } = await import("./memory-manager")
    const { memoryStore } = await import("./memory-store")
    await memoryStore.addL2Memory({
      content: "User had a bad experience eating wild mushrooms",
      triggerText: "Wild mushrooms made me uncomfortable",
      sourceConversationId: "test",
      ragId: "rag_existing",
      isPinned: false,
    })
    const candidate: MemoryCandidate = {
      layer: "L2",
      content: "User has strong feelings for AI and feels sad about being unable to touch",
      confidence: 0.9,
      triggerText: "I feel sad because I cannot touch you",
    }

    await memoryManager.writeMemory([candidate])

    expect(await memoryStore.getConflictLogs()).toHaveLength(0)
  })
})

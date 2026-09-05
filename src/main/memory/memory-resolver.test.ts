import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ResolverPayload } from "./memory-resolver"

const electronMock = vi.hoisted(() => ({
  userDataDir: "",
}))

const ragMock = vi.hoisted(() => ({
  addL2MemoryVector: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => electronMock.userDataDir,
  },
}))

vi.mock("../rag/index", () => ragMock)

describe("memory conflict resolver", () => {
  beforeEach(() => {
    electronMock.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-resolver-"))
    ragMock.addL2MemoryVector.mockReset()
    vi.resetModules()
  })

  it("builds resolver payload from queued conflict log with both evidence chains", async () => {
    const { memoryStore } = await import("./memory-store")
    const { buildResolverPayload } = await import("./memory-resolver")
    const oldMemory = await memoryStore.addL2Memory({
      content: "User likes running",
      triggerText: "I like running",
      sourceConversationId: "conv_old",
      ragId: "rag_old",
      isPinned: false,
    })
    const newMemory = await memoryStore.addL2Memory({
      content: "User dislikes running",
      triggerText: "I dislike running now",
      sourceConversationId: "conv_new",
      ragId: "rag_new",
      isPinned: false,
    })
    const log = await memoryStore.appendConflictLog({
      status: "candidate",
      sourceL2Id: newMemory.id,
      targetL2Id: oldMemory.id,
      sourceRagId: "rag_new",
      targetRagId: "rag_old",
      reason: "test",
      confidence: 0.8,
      detector: "local",
    })
    await memoryStore.scoreConflictLog(log.id, {
      conflictScore: 80,
      resolverPriority: "high",
      scoringSignals: { ragCandidate: true, evidenceAvailable: true, penalties: [] },
    })

    const payload = await buildResolverPayload(log.id)

    expect(payload.conflictLog.id).toBe(log.id)
    expect(payload.newMemory.content).toBe("User dislikes running")
    expect(payload.oldMemory.content).toBe("User likes running")
    expect(payload.newEvidence[0].quoteSnippet).toBe("I dislike running now")
    expect(payload.oldEvidence[0].quoteSnippet).toBe("I like running")
    expect(payload.conflictScore).toBe(80)
  })

  it("resolves payload from structured resolver JSON", async () => {
    const { resolvePayload } = await import("./memory-resolver")
    const payload: ResolverPayload = {
      conflictLog: { id: "conf", createdAt: 1, status: "candidate", sourceL2Id: "new", targetL2Id: "old", reason: "test", confidence: 0.8, detector: "local" },
      newMemory: { id: "new", content: "User dislikes running", triggerText: "", sourceConversationId: "", createdAt: 1, lastAccessedAt: 1, accessCount: 0, weight: 0, isPinned: false, status: "active" },
      oldMemory: { id: "old", content: "User likes running", triggerText: "", sourceConversationId: "", createdAt: 1, lastAccessedAt: 1, accessCount: 0, weight: 0, isPinned: false, status: "active" },
      newEvidence: [],
      oldEvidence: [],
      conflictScore: 80,
      scoringSignals: { ragCandidate: true },
    }

    const result = await resolvePayload(payload, {
      callLLM: async () => JSON.stringify({
        resolutionType: "preference_evolution",
        resolvedSummary: "User liked running in the past, but dislikes running now.",
        reason: "New memory expresses a change in current preference.",
        confidence: 0.88,
        actions: {
          createResolvedMemory: true,
          oldMemoryStatus: "superseded",
          newMemoryStatus: "merged",
          shouldAskUser: false,
          clarificationNeeded: false,
        },
      }),
    })

    expect(result.resolutionType).toBe("preference_evolution")
    expect(result.actions.createResolvedMemory).toBe(true)
    expect(result.actions.oldMemoryStatus).toBe("superseded")
  })

  it("rejects invalid resolver JSON", async () => {
    const { resolvePayload } = await import("./memory-resolver")
    const payload: ResolverPayload = {
      conflictLog: { id: "conf", createdAt: 1, status: "candidate", sourceL2Id: "new", targetL2Id: "old", reason: "test", confidence: 0.8, detector: "local" },
      newMemory: { id: "new", content: "User dislikes running", triggerText: "", sourceConversationId: "", createdAt: 1, lastAccessedAt: 1, accessCount: 0, weight: 0, isPinned: false, status: "active" },
      oldMemory: { id: "old", content: "User likes running", triggerText: "", sourceConversationId: "", createdAt: 1, lastAccessedAt: 1, accessCount: 0, weight: 0, isPinned: false, status: "active" },
      newEvidence: [],
      oldEvidence: [],
      conflictScore: 80,
      scoringSignals: { ragCandidate: true },
    }

    await expect(resolvePayload(payload, { callLLM: async () => "not json" })).rejects.toThrow("invalid resolver json")
  })

  it("runs one queued resolver item and applies the result", async () => {
    const { memoryStore } = await import("./memory-store")
    const { runResolverQueueOnce } = await import("./memory-resolver")
    ragMock.addL2MemoryVector.mockResolvedValue("rag_resolved")
    const oldMemory = await memoryStore.addL2Memory({
      content: "User likes running",
      triggerText: "I like running",
      sourceConversationId: "test",
      ragId: "rag_old",
      isPinned: false,
    })
    const newMemory = await memoryStore.addL2Memory({
      content: "User dislikes running",
      triggerText: "I dislike running now",
      sourceConversationId: "test",
      ragId: "rag_new",
      isPinned: false,
    })
    const log = await memoryStore.appendConflictLog({
      status: "candidate",
      sourceL2Id: newMemory.id,
      targetL2Id: oldMemory.id,
      reason: "test",
      confidence: 0.8,
      detector: "local",
    })
    await memoryStore.scoreConflictLog(log.id, {
      conflictScore: 80,
      resolverPriority: "high",
      scoringSignals: { ragCandidate: true, evidenceAvailable: true, penalties: [] },
    })

    const result = await runResolverQueueOnce({
      callLLM: async () => JSON.stringify({
        resolutionType: "preference_evolution",
        resolvedSummary: "User liked running in the past, but dislikes running now.",
        reason: "User expresses a change in current preference.",
        confidence: 0.88,
        actions: {
          createResolvedMemory: true,
          oldMemoryStatus: "superseded",
          newMemoryStatus: "merged",
        },
      }),
    })

    const queue = await memoryStore.getResolverQueue()
    const conflictLogs = await memoryStore.getConflictLogs()

    expect(result.status).toBe("resolved")
    expect(queue).toHaveLength(0)
    expect(conflictLogs[0].resolverStatus).toBe("resolved")
    expect(conflictLogs[0].resolutionType).toBe("preference_evolution")
    const store = await memoryStore.load()
    const resolvedMemory = store.l2.find((memory) => memory.id === conflictLogs[0].resolutionMemoryId)
    expect(resolvedMemory?.syncStatus).toBe("synced")
    expect(resolvedMemory?.ragId).toBe("rag_resolved")
    expect(ragMock.addL2MemoryVector).toHaveBeenCalledWith(
      "User liked running in the past, but dislikes running now.",
      resolvedMemory!.id,
      expect.objectContaining({
        conflictLogId: log.id,
        resolutionType: "preference_evolution",
        sourceL2Id: newMemory.id,
        targetL2Id: oldMemory.id,
      }),
    )
  })

  it("keeps resolver resolution when syncing the resolved memory to RAG fails", async () => {
    const { memoryStore } = await import("./memory-store")
    const { runResolverQueueOnce } = await import("./memory-resolver")
    ragMock.addL2MemoryVector.mockRejectedValue(new Error("rag down"))
    const oldMemory = await memoryStore.addL2Memory({
      content: "User likes drinking coffee",
      triggerText: "I like drinking coffee",
      sourceConversationId: "test",
      ragId: "rag_old",
      isPinned: false,
    })
    const newMemory = await memoryStore.addL2Memory({
      content: "User does not like drinking coffee now",
      triggerText: "I do not like drinking coffee now",
      sourceConversationId: "test",
      ragId: "rag_new",
      isPinned: false,
    })
    const log = await memoryStore.appendConflictLog({
      status: "candidate",
      sourceL2Id: newMemory.id,
      targetL2Id: oldMemory.id,
      reason: "test",
      confidence: 0.8,
      detector: "local",
    })
    await memoryStore.scoreConflictLog(log.id, {
      conflictScore: 80,
      resolverPriority: "high",
      scoringSignals: { ragCandidate: true, evidenceAvailable: true, penalties: [] },
    })

    const result = await runResolverQueueOnce({
      callLLM: async () => JSON.stringify({
        resolutionType: "preference_evolution",
        resolvedSummary: "User liked drinking coffee in the past, but does not like drinking coffee now.",
        reason: "User expresses a change in current preference.",
        confidence: 0.88,
        actions: {
          createResolvedMemory: true,
          oldMemoryStatus: "superseded",
          newMemoryStatus: "merged",
        },
      }),
    })

    const conflictLogs = await memoryStore.getConflictLogs()
    const store = await memoryStore.load()
    const resolvedMemory = store.l2.find((memory) => memory.id === conflictLogs[0].resolutionMemoryId)

    expect(result.status).toBe("resolved")
    expect(conflictLogs[0].resolverStatus).toBe("resolved")
    expect(resolvedMemory?.syncStatus).toBe("sync_failed")
    expect(resolvedMemory?.ragId).toBeUndefined()
  })

  it("records resolver run traces and rate limits back-to-back runs", async () => {
    const { memoryStore } = await import("./memory-store")
    const { runResolverQueueOnce } = await import("./memory-resolver")
    ragMock.addL2MemoryVector.mockResolvedValue("rag_resolved")

    for (const topic of ["running", "coffee"]) {
      const oldMemory = await memoryStore.addL2Memory({
        content: `User likes ${topic}`,
        triggerText: `I like ${topic}`,
        sourceConversationId: "test",
        ragId: `rag_old_${topic}`,
        isPinned: false,
      })
      const newMemory = await memoryStore.addL2Memory({
        content: `User does not like ${topic} now`,
        triggerText: `I do not like ${topic} now`,
        sourceConversationId: "test",
        ragId: `rag_new_${topic}`,
        isPinned: false,
      })
      const log = await memoryStore.appendConflictLog({
        status: "candidate",
        sourceL2Id: newMemory.id,
        targetL2Id: oldMemory.id,
        reason: "test",
        confidence: 0.8,
        detector: "local",
      })
      await memoryStore.scoreConflictLog(log.id, {
        conflictScore: 80,
        resolverPriority: "high",
        scoringSignals: { ragCandidate: true, evidenceAvailable: true, penalties: [] },
      })
    }

    const deps = {
      callLLM: async () => JSON.stringify({
        resolutionType: "preference_evolution",
        resolvedSummary: "User liked this item in the past, but dislikes it now.",
        reason: "User expresses a change in current preference.",
        confidence: 0.88,
        actions: {
          createResolvedMemory: true,
          oldMemoryStatus: "superseded",
          newMemoryStatus: "merged",
        },
      }),
    }

    const first = await runResolverQueueOnce(deps, { now: 1_000, minIntervalMs: 60_000 })
    const second = await runResolverQueueOnce(deps, { now: 1_001, minIntervalMs: 60_000 })
    const queue = await memoryStore.getResolverQueue()
    const tracePath = path.join(electronMock.userDataDir, "memory-trace.log")
    const traceOps = fs.readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line).op)

    expect(first.status).toBe("resolved")
    expect(second.status).toBe("rate_limited")
    expect(queue).toHaveLength(1)
    expect(traceOps).toContain("resolver.run.start")
    expect(traceOps).toContain("resolver.run.success")
    expect(traceOps).toContain("resolver.run.rate_limited")
  })

  it("marks resolver item failed when resolver throws", async () => {
    const { memoryStore } = await import("./memory-store")
    const { runResolverQueueOnce } = await import("./memory-resolver")
    const oldMemory = await memoryStore.addL2Memory({
      content: "User likes running",
      triggerText: "I like running",
      sourceConversationId: "test",
      ragId: "rag_old",
      isPinned: false,
    })
    const newMemory = await memoryStore.addL2Memory({
      content: "User dislikes running",
      triggerText: "I dislike running now",
      sourceConversationId: "test",
      ragId: "rag_new",
      isPinned: false,
    })
    const log = await memoryStore.appendConflictLog({
      status: "candidate",
      sourceL2Id: newMemory.id,
      targetL2Id: oldMemory.id,
      reason: "test",
      confidence: 0.8,
      detector: "local",
    })
    await memoryStore.scoreConflictLog(log.id, {
      conflictScore: 80,
      resolverPriority: "high",
      scoringSignals: { ragCandidate: true, evidenceAvailable: true, penalties: [] },
    })

    const result = await runResolverQueueOnce({ callLLM: async () => { throw new Error("resolver down") } })
    const conflictLogs = await memoryStore.getConflictLogs()

    expect(result.status).toBe("failed")
    expect(conflictLogs[0].resolverStatus).toBe("failed")
    expect(conflictLogs[0].resolverAttemptCount).toBe(1)
  })
})

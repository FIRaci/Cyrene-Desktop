import { memoryStore } from "./memory-store"
import type { L0WritableField } from "./memory-store"
import { MemoryCandidate, L0_FIELD_DESCRIPTIONS, L2Memory } from "./memory-types"
import { findPossibleConflictCandidate } from "./memory-conflict"
import { scoreMemoryConflict, type ConflictEvidenceLevel } from "./memory-conflict-score"
import { wasRecentlyInjectedMemory } from "./recent-injected-memory"
import { addL2MemoryVector, searchMemoryEntries } from "../rag/index"

type L1Field = "recentGoals" | "recentPreferences"

function preview(content: string, maxLength: number): string {
  return content.slice(0, maxLength)
}

function getL1Field(content: string): L1Field {
  if (/goal|want|plan|aim|intend/i.test(content)) return "recentGoals"
  return "recentPreferences"
}

function hasCorrectionIntent(text: string): boolean {
  return ["not like that", "you remembered wrong", "remembered wrong", "i am not like that now", "not like that now", "that's wrong", "that is wrong"].some((phrase) => text.toLowerCase().includes(phrase))
}

function getImpactScope(memory: L2Memory): "low" | "medium" | "high" {
  if (memory.isPinned) return "high"
  if (memory.status === "active") return "medium"
  return "low"
}

function shouldSkipCandidate(candidate: MemoryCandidate): boolean {
  return candidate.shouldWrite === false || Boolean(candidate.forbiddenOverclaims && candidate.forbiddenOverclaims.length > 0)
}

function canWriteCoreProfile(candidate: MemoryCandidate): boolean {
  return candidate.certainty === "explicit" && candidate.attribution === "user_explicit"
}

export class MemoryManager {
  private async appendToPermanentNote(content: string): Promise<void> {
    const l0 = await memoryStore.getL0()
    const existing = l0.permanentNote || ""
    const updated = existing ? `${existing}；${content}` : content
    await memoryStore.upsertL0Field("permanentNote", updated)
  }

  async writeMemory(candidates: MemoryCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      if (shouldSkipCandidate(candidate)) {
        console.log("[MemoryManager] Candidate marked not to write or over-generalized, skipping")
        continue
      }

      if (candidate.layer === "L0") {
        if (!canWriteCoreProfile(candidate)) {
          console.log("[MemoryManager] L0 candidate is not user explicit fact, skipping auto-write to core persona")
          continue
        }

        // If L0 is pinned by user, skip
        const l0 = await memoryStore.getL0()
        if (l0.isPinned) {
          console.log("[MemoryManager] L0 is pinned, skipping auto-update")
          continue
        }

        // Get valid fields from single source of truth
        const validFields = Object.keys(L0_FIELD_DESCRIPTIONS)

        // Case 1: AI did not output field (theoretically shouldn't happen)
        if (!candidate.field) {
          console.warn("[MemoryManager] L0 candidate missing field, skipping auto-write to core persona")
          continue
        }

        // Case 2: AI output invalid field name (hallucination)
        if (!validFields.includes(candidate.field)) {
          console.warn(`[MemoryManager] AI returned invalid field "${candidate.field}", skipping auto-write to core persona`)
          continue
        }

        // Case 3: Valid field, write directly
        await memoryStore.upsertL0Field(candidate.field as L0WritableField, candidate.content)
        console.log(`[MemoryManager] L0 update field: ${candidate.field} = "${candidate.content.slice(0, 20)}"`)
      } else if (candidate.layer === "L1") {
        const field = getL1Field(candidate.content)
        await memoryStore.replaceL1Field(field, candidate.content)
        console.log(`[MemoryManager] L1 update field: ${field}`)
      } else if (candidate.layer === "L2") {
        await this.writeL2(candidate)
      }
    }
  }

  private async writeL2(candidate: MemoryCandidate): Promise<void> {
    const l2Input: Omit<L2Memory, "id" | "createdAt" | "lastAccessedAt" | "accessCount" | "weight" | "status"> = {
      content: candidate.content,
      triggerText: candidate.triggerText,
      sourceConversationId: "",
      embedding: [],
      isPinned: false,
      syncStatus: "pending_sync",
    }

    const l2 = await memoryStore.addL2Memory(l2Input)

    let ragId: string | undefined
    try {
      ragId = await addL2MemoryVector(candidate.content, l2.id, {
        triggerText: candidate.triggerText,
        confidence: candidate.confidence,
      })
      await memoryStore.markL2SyncStatus(l2.id, "synced", ragId)
    } catch (err) {
      await memoryStore.markL2SyncStatus(l2.id, "sync_failed", undefined, err)
      console.warn("[MemoryManager] L2 written, but RAG sync failed:", err)
      return
    }

    console.log(`[MemoryManager] L2 write: "${preview(candidate.content, 30)}" (l2Id: ${l2.id}, ragId: ${ragId})`)

    // ── Conflict Detection: check if new memory contradicts existing memories ──
    try {
      await this.detectAndMarkConflicts(candidate.content, l2.id, ragId, candidate.triggerText)
    } catch (err) {
      console.warn("[MemoryManager] Conflict detection failed:", err)
    }
  }

  /** Detect if new memory contradicts existing active memories, mark if so */
  private async detectAndMarkConflicts(content: string, newL2Id: string, newRagId: string, triggerText: string): Promise<void> {
    // Search semantically similar existing L2 items
    const allL2 = await memoryStore.getAllL2()
    const activeL2 = allL2.filter((m) => (m.status === "active" || m.status === "aging") && m.ragId && m.ragId !== newRagId)

    // Use RAG entry for vector similarity match, preferring metadata.l2Id for exact L2 location
    const similarEntries = await searchMemoryEntries(content, "user_memory", 5, { recordRecall: false })
    if (similarEntries.length === 0) return

    const entriesByL2Id = new Map<string, (typeof similarEntries)[number]>()
    for (const entry of similarEntries) {
      const l2Id = entry.metadata?.l2Id
      if (typeof l2Id === "string" && l2Id.length > 0) {
        entriesByL2Id.set(l2Id, entry)
      }
    }

    // Find candidates in activeL2 located by RAG, then check for local weak contradiction signals
    for (const existing of activeL2) {
      const metadataMatch = entriesByL2Id.get(existing.id)
      const textMatch = similarEntries.find((entry) => (
        entry.text === existing.content ||
        existing.content.includes(entry.text.slice(0, 20)) ||
        entry.text.includes(existing.content.slice(0, 20))
      ))
      const matchedEntry = metadataMatch ?? textMatch
      if (!matchedEntry) continue

      const candidate = findPossibleConflictCandidate(content, existing.content)
      if (candidate.isCandidate) {
        // Local rules only produce suspected candidates, do not confirm actual conflict
        const marked = await memoryStore.markL2Conflict(existing.id, newRagId)
        if (marked) {
          const log = await memoryStore.appendConflictLog({
            status: "candidate",
            sourceL2Id: newL2Id,
            targetL2Id: existing.id,
            sourceRagId: newRagId,
            targetRagId: existing.ragId,
            reason: candidate.reason ?? "possible local lexical contradiction",
            confidence: candidate.confidence,
            detector: "local",
          })
          const score = scoreMemoryConflict({
            candidateSource: wasRecentlyInjectedMemory(existing.id) ? "recent_injection" : metadataMatch ? "rag" : "local",
            ragScore: metadataMatch ? matchedEntry.score : undefined,
            correctionIntent: hasCorrectionIntent(triggerText),
            recentInjection: wasRecentlyInjectedMemory(existing.id),
            localContradiction: true,
            evidence: await this.getEvidenceLevel(newL2Id, existing.id),
            activeTarget: existing.status !== "archived",
            impactScope: getImpactScope(existing),
          })
          await memoryStore.scoreConflictLog(log.id, score)
          console.log(`[MemoryManager] ⚠️ Found suspected memory conflict candidate: "${preview(existing.content, 30)}" <-> "${preview(content, 30)}"`)
        }
      }
    }
  }

  private async getEvidenceLevel(sourceL2Id: string, targetL2Id: string): Promise<ConflictEvidenceLevel> {
    const [sourceEvidence, targetEvidence] = await Promise.all([
      memoryStore.getEvidenceByMemoryId(sourceL2Id),
      memoryStore.getEvidenceByMemoryId(targetL2Id),
    ])
    if (sourceEvidence.length > 0 && targetEvidence.length > 0) return "both"
    if (sourceEvidence.length > 0 || targetEvidence.length > 0) return "one_side"
    return "none"
  }

  /**
   * Manually triggered L2 weight decay. Currently not mounted in production scheduler;
   * Will be unified by memory-scheduler later.
   */
  async runDecay(): Promise<void> {
    const changed = await memoryStore.decayL2Weights()
    console.log(`[MemoryManager] L2 weight decay complete, updated ${changed} items`)
  }

  async onL2Recalled(ids: string[]): Promise<void> {
    void ids
  }
}

export const memoryManager = new MemoryManager()

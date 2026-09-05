import * as fs from "fs"
import type { L2Memory, MemoryEvidence, MemoryStore } from "./memory-types"

export type MemoryAuditSeverity = "info" | "warning" | "error"

export interface MemoryAuditFinding {
  code:
    | "missing_evidence"
    | "empty_evidence_chain"
    | "absolute_overclaim"
    | "active_conflict_marker"
    | "stale_sync_status"
    | "broken_resolution_link"
  severity: MemoryAuditSeverity
  l2Id?: string
  message: string
  suggestion: string
  details?: Record<string, unknown>
}

export interface MemoryAuditReport {
  filePath: string
  findings: MemoryAuditFinding[]
}

export interface MemoryAuditSummary {
  total: number
  bySeverity: Record<MemoryAuditSeverity, number>
  byCode: Record<string, number>
}

const ABSOLUTE_TERMS = ["only", "always", "never", "definitely", "completely", "absolutely", "forever"]

function hasEvidenceForTerm(term: string, evidence: MemoryEvidence[]): boolean {
  return evidence.some((item) => item.quoteSnippet.toLowerCase().includes(term))
}

function evidenceForMemory(memory: L2Memory, evidenceById: Map<string, MemoryEvidence>): MemoryEvidence[] {
  return (memory.evidenceIds ?? [])
    .map((id) => evidenceById.get(id))
    .filter((item): item is MemoryEvidence => Boolean(item))
}

function hasMissingEvidence(memory: L2Memory, evidenceById: Map<string, MemoryEvidence>): boolean {
  return (memory.evidenceIds ?? []).some((id) => !evidenceById.has(id))
}

function addResolutionLinkFinding(findings: MemoryAuditFinding[], memory: L2Memory, field: "supersededBy" | "mergedInto"): void {
  findings.push({
    code: "broken_resolution_link",
    severity: "warning",
    l2Id: memory.id,
    message: `L2 ${memory.id} has empty ${field}, historical resolution chain is incomplete.`,
    suggestion: "Manually review whether this memory should maintain its current state, or complete/clean up the resolution chain.",
    details: { status: memory.status, field },
  })
}

export function auditMemoryStore(store: MemoryStore): MemoryAuditFinding[] {
  const findings: MemoryAuditFinding[] = []
  const l2 = Array.isArray(store.l2) ? store.l2 : []
  const evidence = Array.isArray(store.evidence) ? store.evidence : []
  const evidenceById = new Map(evidence.map((item) => [item.id, item]))

  for (const memory of l2) {
    const linkedEvidence = evidenceForMemory(memory, evidenceById)

    if ((memory.evidenceIds?.length ?? 0) === 0) {
      findings.push({
        code: "empty_evidence_chain",
        severity: "warning",
        l2Id: memory.id,
        message: `L2 ${memory.id} has no evidenceIds, unable to trace original basis.`,
        suggestion: "Add it to the manual review list; if content is untraceable, recommend downweighting or archiving.",
      })
    } else if (hasMissingEvidence(memory, evidenceById)) {
      findings.push({
        code: "missing_evidence",
        severity: "error",
        l2Id: memory.id,
        message: `L2 ${memory.id} references non-existent evidenceId.`,
        suggestion: "Check memory.json historical migration results; high-level memories missing evidence should not be automatically promoted to core persona.",
        details: { evidenceIds: memory.evidenceIds },
      })
    }

    const overclaimedTerms = ABSOLUTE_TERMS.filter((term) => (
      memory.content.toLowerCase().includes(term) && !hasEvidenceForTerm(term, linkedEvidence)
    ))
    if (overclaimedTerms.length > 0) {
      findings.push({
        code: "absolute_overclaim",
        severity: "warning",
        l2Id: memory.id,
        message: `L2 ${memory.id} contains absolute claims, but original evidence lacks corresponding terms.`,
        suggestion: "Manually review whether the model over-generalized; rewrite to a narrower, more contextual L2 if necessary.",
        details: { terms: overclaimedTerms },
      })
    }

    if ((memory.status === "active" || memory.status === "aging") && (memory.conflictWith?.length ?? 0) > 0) {
      findings.push({
        code: "active_conflict_marker",
        severity: "warning",
        l2Id: memory.id,
        message: `L2 ${memory.id} remains ${memory.status}, but retains conflictWith marker.`,
        suggestion: "Check if corresponding conflict log is resolved; if resolved, clean up legacy conflict marker or adjust status.",
        details: { conflictWith: memory.conflictWith, status: memory.status },
      })
    }

    if (memory.syncStatus === "pending_sync" && !memory.ragId) {
      findings.push({
        code: "stale_sync_status",
        severity: "info",
        l2Id: memory.id,
        message: `L2 ${memory.id} remains in pending_sync without ragId.`,
        suggestion: "Prioritize compensation during next sync task; archive directly if content is stale.",
      })
    }

    if (memory.status === "superseded" && !memory.supersededBy) {
      addResolutionLinkFinding(findings, memory, "supersededBy")
    }
    if (memory.status === "merged" && !memory.mergedInto) {
      addResolutionLinkFinding(findings, memory, "mergedInto")
    }
  }

  return findings
}

export function summarizeMemoryAudit(findings: MemoryAuditFinding[]): MemoryAuditSummary {
  const summary: MemoryAuditSummary = {
    total: findings.length,
    bySeverity: { info: 0, warning: 0, error: 0 },
    byCode: {},
  }

  for (const finding of findings) {
    summary.bySeverity[finding.severity] += 1
    summary.byCode[finding.code] = (summary.byCode[finding.code] ?? 0) + 1
  }

  return summary
}

export function auditMemoryFile(filePath: string): MemoryAuditReport {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as MemoryStore
  return {
    filePath,
    findings: auditMemoryStore(parsed),
  }
}

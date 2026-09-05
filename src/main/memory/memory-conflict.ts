export interface PossibleConflictCandidate {
  isCandidate: boolean
  reason?: string
  confidence: number
}

/** Semantic contradiction keyword pairs: first word indicates positive/affirmative, mapped to negative/denial */
const CONTRADICTION_PAIRS: Array<[string, string[]]> = [
  ["like", ["dislike", "hate", "detest", "no longer like", "does not like", "doesn't like"]],
  ["love", ["do not love", "hate", "doesn't love"]],
  ["want", ["do not want", "don't want", "refuse"]],
  ["is", ["is not", "isn't"]],
  ["can", ["cannot", "can't", "unable to"]],
  ["will", ["will not", "won't"]],
  ["has", ["does not have", "doesn't have", "has no"]],
  ["busy", ["not busy", "free", "idle"]],
]

const STOP_TERMS = new Set([
  "user",
  "one",
  "this",
  "that",
  "self",
  "because",
  "therefore",
  "however",
  "likes",
  "like",
  "dislike",
  "hate",
  "busy",
  "free",
])

function normalize(text: string): string {
  return text.toLowerCase()
}

function extractTopicTerms(text: string): Set<string> {
  const terms = new Set<string>()
  const matches = text.match(/[a-zA-Z0-9]{3,}/g) ?? []
  for (const raw of matches) {
    const term = raw.toLowerCase()
    if (STOP_TERMS.has(term)) continue
    terms.add(term)
  }
  return terms
}

function hasSharedTopic(textA: string, textB: string): boolean {
  const aTerms = extractTopicTerms(textA)
  const bTerms = extractTopicTerms(textB)
  for (const term of aTerms) {
    if (bTerms.has(term)) return true
  }
  return false
}

export function findPossibleConflictCandidate(newContent: string, existingContent: string): PossibleConflictCandidate {
  if (!hasSharedTopic(newContent, existingContent)) {
    return { isCandidate: false, confidence: 0 }
  }

  const a = normalize(newContent)
  const b = normalize(existingContent)
  for (const [positive, negatives] of CONTRADICTION_PAIRS) {
    const aHasPos = a.includes(positive)
    const bHasPos = b.includes(positive)
    const aHasNeg = negatives.some((n) => a.includes(n))
    const bHasNeg = negatives.some((n) => b.includes(n))
    if ((aHasPos && bHasNeg) || (bHasPos && aHasNeg)) {
      return {
        isCandidate: true,
        reason: `possible shared-topic lexical contradiction: ${positive}`,
        confidence: 0.35,
      }
    }
  }

  return { isCandidate: false, confidence: 0 }
}


export type RuntimeFeelingName = "Calm" | "Happy" | "Gentle" | "Excited" | "Coy" | "Worried" | "Sad" | "Touched" | "Shy"

export type FeelingScores = Record<RuntimeFeelingName, number>

const FEELINGS: RuntimeFeelingName[] = ["Calm", "Happy", "Gentle", "Excited", "Coy", "Worried", "Sad", "Touched", "Shy"]
const FAST_RISE = new Set<RuntimeFeelingName>(["Worried", "Sad"])

export function createFeelingScores(initial: RuntimeFeelingName = "Calm"): FeelingScores {
  const scores = Object.fromEntries(FEELINGS.map((feeling) => [feeling, 0])) as FeelingScores
  scores[initial] = 1
  return scores
}

export function smoothFeeling(
  current: FeelingScores,
  observed: string,
): { feeling: RuntimeFeelingName; scores: FeelingScores } {
  const next = { ...current }
  const target = FEELINGS.includes(observed as RuntimeFeelingName)
    ? (observed as RuntimeFeelingName)
    : "Calm"
  const observedWeight = FAST_RISE.has(target) ? 0.62 : 0.3
  const decay = 1 - observedWeight

  for (const feeling of FEELINGS) {
    next[feeling] = (next[feeling] ?? 0) * decay
  }
  next[target] = (next[target] ?? 0) + observedWeight

  let best: RuntimeFeelingName = "Calm"
  for (const feeling of FEELINGS) {
    if (next[feeling] > next[best]) best = feeling
  }

  return { feeling: best, scores: next }
}

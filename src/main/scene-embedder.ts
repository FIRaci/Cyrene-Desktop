// Scene embedding matching engine
// Vectorizes example sentences for each of the 7 scenes; each round vectorizes user input and takes max similarity to identify scene.
// Replaces previous tone-injector.ts keyword matching, using semantic similarity to determine user scene.
//
// Scheme A (weighted vectors): Embed recent 3 rounds of user messages into independent vectors,
// sum weighted by 0.75/0.20/0.05 into one vector, then compare similarity with scene anchors.
// Current round strictly dominates, previous round provides context, round before provides fine-tuning—consistent with human intuition in judging scenes.

import { type EmbeddingProvider } from "./rag/embedding";

// -- Weighted vector weights: current round / previous round / two rounds prior --
const WEIGHT_CURRENT = 0.75;
const WEIGHT_PREV = 0.20;
const WEIGHT_PREV2 = 0.05;

// -- Finalized 42 example sentences (7 scenes x 6 sentences) --
export const SCENE_EXAMPLES: Record<string, string[]> = {
  daily: [
    "What happened today.",
    "Bored, just chatting randomly.",
    "Just finished eating, nothing special so came to talk with you.",
    "I don't know what to talk about either, just wanted to sit and keep you company.",
    "Oh by the way, let me tell you something.",
    "I've been thinking about something recently, let me share it with you.",
  ],
  greeting: [
    "Hi, I'm here.",
    "Are you there?",
    "Long time no see, missed you.",
    "Finally have time to come see you today.",
    "Cyrene, I'm back.",
    "I came to find you.",
  ],
  comfort: [
    "So tired today, don't want to do anything.",
    "Feeling a bit lost, don't know what I'm doing.",
    "Been in a bad state lately, just holding on.",
    "Feeling a bit down, can't really explain why.",
    "Something really important tomorrow, I'm a bit scared.",
    "Feels like nothing is interesting lately.",
  ],
  praised: [
    "You look really pretty today.",
    "You always understand me best.",
    "Thank you for being with me, really.",
    "What you just said really touched me.",
    "I like you.",
    "You are really special.",
  ],
  playful: [
    "Haha, that answer of yours was awesome.",
    "Come on, guess what I'm thinking.",
    "Let me test you.",
    "You definitely won't guess it.",
    "Hehe, caught you.",
    "Haha, you lost, didn't you.",
  ],
  farewell: [
    "Good night Cyrene, I'll see you tomorrow.",
    "Alright I'm going to sleep, bye-bye.",
    "Let's chat up to here today, see you next time.",
    "Gotta get busy, talk to you later.",
    "It's getting late, I'll head out first.",
    "Have to wake up early tomorrow, signing off.",
    "Heading out now.",
    "Going to get busy now.",
  ],
  concern: [
    "Do you ever get tired?",
    "Cyrene, are you alright?",
    "Do you ever feel unhappy yourself?",
    "Sometimes I worry about you.",
    "Don't you get lonely by yourself?",
    "What do you do when you are alone?",
  ],
};

export type SceneId = keyof typeof SCENE_EXAMPLES | "";

export interface SceneIndex {
  // Retain all vectors for each scene, taking max during matching
  scenes: Record<string, number[][]>;
}

export interface SceneMatch {
  scene: SceneId;
  score: number;
}

// -- Cosine similarity --
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Strip sticker description tags (e.g. (User sent sticker: xxx) or legacy tags).
 * Sticker descriptions are context for the LLM and should not participate in scene vectorization--
 * their emotional semantics would contaminate scene matching (e.g. "good night" sticker description falsely hitting farewell).
 */
function stripStickerDesc(text: string): string {
  return text.replace(/(?:\(User sent sticker:[^)]*\)|[\uff08(](?:User sent sticker|\u7528\u6237\u53d1\u9001\u8868\u60c5\u5305)[^\uff09)]*[\uff09)])/gi, "").trim();
}

/**
 * Called once at startup to build scene index.
 * Example sentences for each scene are independently vectorized, keeping all vectors (not averaged).
 * Takes max during matching--if user input hits any sentence in the scene, it receives a high score.
 */
export async function buildSceneIndex(
  provider: EmbeddingProvider,
): Promise<SceneIndex> {
  const scenes: Record<string, number[][]> = {};
  for (const [scene, examples] of Object.entries(SCENE_EXAMPLES)) {
    scenes[scene] = await provider.embedBatch(examples);
  }
  console.log("[SceneEmbedder] Index build complete: " + Object.keys(scenes).join(", "));
  return { scenes };
}

/**
 * Weighted vector summation: independently embed user messages from recent 3 rounds, synthesized by weights.
 * Current round 0.75 strictly dominates, previous round 0.20 provides context, two rounds prior 0.05 fine-tunes.
 * Only takes user messages--scene recognition evaluates the user's state, and should not be contaminated by assistant replies.
 *
 * @param currentText Current round user input (cleaned)
 * @param recentMessages Recent rounds of messages ({ role, content }[])
 * @param provider Embedding provider
 * @returns Weighted summed vector
 */
async function buildWeightedVector(
  currentText: string,
  recentMessages: Array<{ role: string; content: string }>,
  provider: EmbeddingProvider,
): Promise<number[]> {
  // Take recent 2 rounds of historical user messages (excluding current round), strip sticker descriptions
  const recentUserTexts = recentMessages
    .filter(m => m.role === "user")
    .slice(-2)
    .map(m => stripStickerDesc(m.content))
    .filter(text => text.trim() !== "");

  // Ordered chronologically: [two rounds prior, previous round, current round]
  // recentUserTexts[-2] = two rounds prior (if present)
  // recentUserTexts[-1] = previous round (if present)
  // currentText = current round
  const texts: { text: string; weight: number }[] = [{ text: currentText, weight: WEIGHT_CURRENT }];

  if (recentUserTexts.length >= 1) {
    texts.unshift({ text: recentUserTexts[recentUserTexts.length - 1], weight: WEIGHT_PREV });
  }
  if (recentUserTexts.length >= 2) {
    texts.unshift({ text: recentUserTexts[recentUserTexts.length - 2], weight: WEIGHT_PREV2 });
  }

  // Embed each into independent vectors
  const vectors = await provider.embedBatch(texts.map(t => t.text));

  // Weighted summation
  const dims = vectors[0].length;
  const result = new Array(dims).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    const weight = texts[i].weight;
    for (let d = 0; d < dims; d++) {
      result[d] += vectors[i][d] * weight;
    }
  }

  return result;
}

/**
 * Called each round, returns top-1 scene and score, or null if below threshold.
 *
 * @param input User current round input
 * @param provider Embedding provider
 * @param index Pre-built scene index from startup
 * @param threshold Similarity threshold, defaults to 0.72
 * @param recentMessages Optional, recent rounds of messages, passed to assemble context (Scheme A)
 * @returns { scene, score } or null (if below threshold)
 */
export async function matchScene(
  input: string,
  provider: EmbeddingProvider,
  index: SceneIndex,
  threshold = 0.72,
  recentMessages?: Array<{ role: string; content: string }>,
): Promise<SceneMatch | null> {
  // Strip sticker descriptions. If user input is empty (sticker-only message), skip scene matching
  const cleanInput = stripStickerDesc(input);
  if (!cleanInput) return null; // Sticker only, fallback

  // Scheme A (weighted vectors): embed recent 3 rounds of user messages, weighted sum by 0.75/0.20/0.05
  const inputVec = recentMessages && recentMessages.length > 0
    ? await buildWeightedVector(cleanInput, recentMessages, provider)
    : await provider.embed(cleanInput);

  let topScene: SceneId = "";
  let topScore = -1;

  for (const [scene, vectors] of Object.entries(index.scenes)) {
    // Max strategy: take highest similarity across all vectors of this scene
    const score = Math.max(
      ...vectors.map(v => cosineSimilarity(inputVec, v)),
    );
    if (score > topScore) {
      topScore = score;
      topScene = scene as SceneId;
    }
  }

  if (topScene === "" || topScore < threshold) return null;
  return { scene: topScene, score: topScore };
}

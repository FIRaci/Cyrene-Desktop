// Embedding sticker matching engine
// Transforms semantic descriptions into vectors, matching LLM replies via cosine similarity

import { type EmbeddingProvider } from "./rag/embedding";

// ── Cosine Similarity ──
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Types ──

/** Single entry in embedding index */
export interface StickerEmbeddingEntry {
  id: string;
  embedding: number[];
}

// ── Public API ──

/**
 * Builds complete sticker embedding index
 * @param provider  Embedding provider
 * @param builtIn   Built-in sticker descriptions { id -> { phrases } }
 * @param userStickers User sticker metadata { id -> { phrases } }
 * @returns Index array
 */
export async function buildStickerEmbeddingIndex(
  provider: EmbeddingProvider,
  builtIn: Record<string, { phrases: string[] }>,
  userStickers: Record<string, { phrases: string[] }>,
): Promise<StickerEmbeddingEntry[]> {
  const entries: StickerEmbeddingEntry[] = [];

  // Collect all texts requiring embedding conversion
  const allIds: string[] = [];
  const allTexts: string[] = [];

  for (const [id, desc] of Object.entries(builtIn)) {
    allIds.push(id);
    allTexts.push(desc.phrases.join(", "));
  }

  for (const [id, meta] of Object.entries(userStickers)) {
    allIds.push(id);
    allTexts.push(meta.phrases.join(", "));
  }

  if (allTexts.length === 0) return [];

  // Batch embed vectors
  const embeddings = await provider.embedBatch(allTexts);
  for (let i = 0; i < allIds.length; i++) {
    entries.push({ id: allIds[i], embedding: embeddings[i] });
  }

  return entries;
}

/**
 * Matches query text against embedding index
 * @param query     LLM reply content (can include user input)
 * @param provider  Embedding provider
 * @param index     Embedding index
 * @param threshold Similarity threshold 0.3~0.9
 * @returns Matched sticker id and score, returns null below threshold
 */
export async function matchSticker(
  query: string,
  provider: EmbeddingProvider,
  index: StickerEmbeddingEntry[],
  threshold: number,
): Promise<{ id: string; score: number } | null> {
  if (index.length === 0) return null;

  const queryEmbedding = await provider.embed(query);

  let bestId: string | null = null;
  let bestScore = -1;

  for (const entry of index) {
    const score = cosineSimilarity(queryEmbedding, entry.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestId = entry.id;
    }
  }

  if (bestId === null || bestScore < threshold) return null;
  return { id: bestId, score: bestScore };
}
import * as fs from "fs";
import * as path from "path";
import { getEmbeddingProvider, EmbeddingProvider } from "./embedding";

// ── Types ──
export interface MemoryEntry {
  id: string;
  text: string;
  embedding: number[];
  source: string;       // "user_memory" | "worldbook" | "imported_doc"
  weight: number;       // Initial 1.0, +0.1 per recall, x0.95 if unmentioned for 24h
  createdAt: number;    // timestamp
  lastRecalledAt: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;        // Composite score (cosine * weight * decay)
}

export interface VectorSearchOptions {
  importIds?: string[];
  allowedEntryIds?: string[];
}

// ── Cosine Similarity (normalized embeddings, dot product) ──
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

// ── IVF Inverted File Index ──
// Clusters vectors into K clusters with k-means; searches only nearest nprobe clusters.
interface IvfIndex {
  /** Cluster centroids (normalized) */
  centroids: number[][];
  /** Entry indices in cluster (referencing this.entries) */
  clusters: number[][];
  /** Indexed entry count for rebuild determination */
  entryCount: number;
}

function kmeansPlusPlusInit(
  vectors: number[][],
  K: number,
  dim: number,
): number[][] {
  const centroids: number[][] = [];
  // 1. Choose first center randomly
  const firstIdx = Math.floor(Math.random() * vectors.length);
  centroids.push(vectors[firstIdx].slice());

  // 2. Choose remaining centers weighted by squared distance
  for (let c = 1; c < K; c++) {
    const dists = vectors.map((v) => {
      let minDist = Infinity;
      for (const cent of centroids) {
        const sim = cosineSimilarity(v, cent);
        const d = 1 - sim; // Cosine distance = 1 - cos
        if (d < minDist) minDist = d;
      }
      return minDist * minDist;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    if (totalDist <= 0) {
      while (centroids.length < K) {
        centroids.push(vectors[centroids.length % vectors.length].slice());
      }
      break;
    }
    let r = Math.random() * totalDist;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push(vectors[i].slice());
        break;
      }
    }
  }
  return centroids;
}

function buildIvfIndex(
  entries: MemoryEntry[],
  K: number,
  maxIter = 20,
): IvfIndex {
  const vectors = entries.map((e) => e.embedding);
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0 || vectors.length === 0) {
    return { centroids: [], clusters: [], entryCount: entries.length };
  }

  const effectiveK = Math.min(K, vectors.length);
  const clusters: number[][] = Array.from({ length: effectiveK }, () => []);

  // k-means++ initialization
  let centroids = kmeansPlusPlusInit(vectors, effectiveK, dim);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assignment
    for (let i = 0; i < effectiveK; i++) clusters[i] = [];
    let changed = false;

    for (let i = 0; i < vectors.length; i++) {
      let bestIdx = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < effectiveK; c++) {
        const sim = cosineSimilarity(vectors[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = c;
        }
      }
      clusters[bestIdx].push(i);
    }

    // Update centers
    const newCentroids: number[][] = [];
    for (let c = 0; c < effectiveK; c++) {
      const members = clusters[c];
      if (members.length === 0) {
        // Retain previous center for empty cluster
        newCentroids.push(centroids[c].slice());
        continue;
      }
      const sum = new Array(dim).fill(0);
      for (const idx of members) {
        const v = vectors[idx];
        for (let d = 0; d < dim; d++) sum[d] += v[d];
      }
      // Normalize new centers
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += sum[d] * sum[d];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < dim; d++) sum[d] /= norm;
      }
      newCentroids.push(sum);
    }

    // Check convergence
    for (let c = 0; c < effectiveK; c++) {
      const sim = cosineSimilarity(newCentroids[c], centroids[c]);
      if (sim < 0.999) { changed = true; break; }
    }
    centroids = newCentroids;
    if (!changed) break;
  }

  return { centroids, clusters, entryCount: entries.length };
}

// ── JSON Vector Store ──
export class JsonVectorStore {
  private filePath: string;
  private entries: MemoryEntry[] = [];
  private dirty = false;

  /** IVF index, null if unbuilt or needs rebuild */
  private ivf: IvfIndex | null = null;
  /** Search count, triggers lazy rebuild when threshold reached */
  private searchCount = 0;

  constructor(dbPath: string) {
    this.filePath = path.join(dbPath, "memory-store.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        this.entries = JSON.parse(raw) as MemoryEntry[];
      }
    } catch (err) {
      console.warn("[RAG] failed to load vector store:", err);
      this.entries = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), "utf8");
      this.dirty = false;
    } catch (err) {
      console.warn("[RAG] failed to save vector store:", err);
    }
  }

  // ── IVF Index Management ──

  /** Force rebuild IVF index */
  rebuildIndex(): void {
    const n = this.entries.length;
    if (n < 2) {
      this.ivf = null;
      return;
    }
    // K ≈ sqrt(n)/2, max 512, min 2
    const K = Math.max(2, Math.min(512, Math.round(Math.sqrt(n) / 2)));
    const t0 = Date.now();
    this.ivf = buildIvfIndex(this.entries, K);
    console.log(`[RAG] IVF index rebuilt: K=${K}, entries=${n}, took ${Date.now() - t0}ms`);
  }

  /** Check if rebuild is needed after DB change */
  private markIndexDirty(): void {
    this.ivf = null;
  }

  /** Ensure index is available before search (lazy rebuild) */
  private ensureIndex(): void {
    if (this.ivf) return;
    if (this.entries.length >= 2) {
      this.rebuildIndex();
    }
  }

  // ── CRUD ──

  // Add memory (deduplicated)
  async add(
    text: string,
    source: string,
    provider: EmbeddingProvider,
    metadata?: Record<string, unknown>
  ): Promise<MemoryEntry> {
    // Deduplication check
    const existing = await this.search(text, source, provider, 1, 0.95);
    if (existing.length > 0) {
      // Update weight and timestamp
      existing[0].entry.weight = Math.min(existing[0].entry.weight + 0.1, 5.0);
      existing[0].entry.lastRecalledAt = Date.now();
      this.dirty = true;
      this.save();
      return existing[0].entry;
    }

    const embedding = await provider.embed(text);
    const entry: MemoryEntry = {
      id: `${source}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      embedding,
      source,
      weight: 1.0,
      createdAt: Date.now(),
      lastRecalledAt: Date.now(),
      metadata,
    };

    this.entries.push(entry);
    this.dirty = true;
    this.markIndexDirty();
    this.save();
    return entry;
  }

  async addUnique(
    text: string,
    source: string,
    provider: EmbeddingProvider,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryEntry> {
    const embedding = await provider.embed(text);
    return this.addPreparedBatch([{ text, source, embedding, metadata }])[0];
  }

  // Batch add (for imported document chunks)
  async addBatch(
    items: Array<{ text: string; source: string; metadata?: Record<string, unknown> }>,
    provider: EmbeddingProvider,
    options?: { isCancelled?: () => boolean },
  ): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const batchSize = 16;
    for (let start = 0; start < items.length; start += batchSize) {
      if (options?.isCancelled?.()) throw new Error("cancelled");
      const batch = items.slice(start, start + batchSize);
      const embeddings = await provider.embedBatch(batch.map((item) => item.text));
      if (options?.isCancelled?.()) throw new Error("cancelled");
      results.push(...this.addPreparedBatch(batch.map((item, index) => ({ ...item, embedding: embeddings[index] }))));
    }
    return results;
  }

  addPreparedBatch(
    items: Array<{ text: string; source: string; embedding: number[]; metadata?: Record<string, unknown> }>,
  ): MemoryEntry[] {
    const results: MemoryEntry[] = [];

    for (let i = 0; i < items.length; i++) {
      const entry: MemoryEntry = {
        id: `${items[i].source}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        text: items[i].text,
        embedding: items[i].embedding,
        source: items[i].source,
        weight: 1.0,
        createdAt: Date.now(),
        lastRecalledAt: Date.now(),
        metadata: items[i].metadata,
      };
      this.entries.push(entry);
      results.push(entry);
    }

    this.dirty = true;
    this.markIndexDirty();
    this.save();
    return results;
  }

  // Search (accelerated via IVF index)
  async search(
    query: string,
    source?: string,
    provider?: EmbeddingProvider,
    topK = 5,
    minScore = 0.3,
    options: VectorSearchOptions = {},
  ): Promise<SearchResult[]> {
    if (this.entries.length === 0) return [];

    const embeddingProvider = provider ?? getEmbeddingProvider();
    if (!embeddingProvider) return [];

    const queryEmbedding = await embeddingProvider.embed(query);

    // Ensure index is built
    this.ensureIndex();

    const now = Date.now();
    const results: SearchResult[] = [];
    const allowedImportIds = new Set(options.importIds ?? []);
    const allowedEntryIds = options.allowedEntryIds ? new Set(options.allowedEntryIds) : null;
    const shouldKeep = (entry: MemoryEntry) =>
      (!allowedImportIds.size || allowedImportIds.has(String(entry.metadata?.importId ?? ""))) &&
      (!allowedEntryIds || allowedEntryIds.has(entry.id));

    if (this.ivf && !source) {
      // ── IVF Accelerated Path (no source filter) ──
      const K = this.ivf.centroids.length;
      // nprobe: search ~1/8 of clusters (at least 2)
      const nprobe = Math.max(2, Math.round(K / 8));

      // Find nearest nprobe clusters
      const clusterDists: Array<{ idx: number; dist: number }> = [];
      for (let c = 0; c < K; c++) {
        const sim = cosineSimilarity(queryEmbedding, this.ivf.centroids[c]);
        clusterDists.push({ idx: c, dist: 1 - sim });
      }
      clusterDists.sort((a, b) => a.dist - b.dist);
      const probeClusters = new Set(clusterDists.slice(0, nprobe).map((c) => c.idx));

      // Search only within selected clusters
      for (const clusterIdx of probeClusters) {
        for (const entryIdx of this.ivf.clusters[clusterIdx]) {
          const entry = this.entries[entryIdx];
          if (!shouldKeep(entry)) continue;
          const sim = cosineSimilarity(queryEmbedding, entry.embedding);
          const hoursSinceRecall = (now - entry.lastRecalledAt) / (1000 * 60 * 60);
          const decayFactor = Math.pow(0.95, hoursSinceRecall / 24);
          const weightedScore = sim * entry.weight * decayFactor;

          if (weightedScore >= minScore) {
            results.push({ entry, score: weightedScore });
          }
        }
      }
    } else {
      // ── Full Scan Path (when source filter is active or index not ready) ──
      for (const entry of this.entries) {
        if (source && entry.source !== source) continue;
        if (!shouldKeep(entry)) continue;

        const sim = cosineSimilarity(queryEmbedding, entry.embedding);
        // Time decay: x0.95 weight if unmentioned for 24h
        const hoursSinceRecall = (now - entry.lastRecalledAt) / (1000 * 60 * 60);
        const decayFactor = Math.pow(0.95, hoursSinceRecall / 24);
        const weightedScore = sim * entry.weight * decayFactor;

        if (weightedScore >= minScore) {
          results.push({ entry, score: weightedScore });
        }
      }
    }

    // Sort and take topK
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, topK);

    // Update recall timestamp (for topK results only)
    for (const r of top) {
      r.entry.lastRecalledAt = now;
      r.entry.weight = Math.min(r.entry.weight + 0.05, 5.0);
    }
    if (top.length > 0) {
      this.dirty = true;
      this.save();
    }

    return top;
  }

  // Clean up low-weight memories
  prune(minWeight = 0.1): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.weight >= minWeight);
    this.dirty = true;
    this.markIndexDirty();
    this.save();
    return before - this.entries.length;
  }

  deleteEntriesByIds(ids: string[], source?: string): number {
    const idSet = new Set(ids);
    if (idSet.size === 0) return 0;
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => !idSet.has(entry.id) || (source !== undefined && entry.source !== source));
    const deleted = before - this.entries.length;
    if (deleted > 0) {
      this.dirty = true;
      this.markIndexDirty();
      this.save();
    }
    return deleted;
  }

  // Delete imported document
  deleteImportedDoc(importId: string, fileName?: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => {
      if (e.source !== "imported_doc") return true;
      // New format: match by importId
      if (e.metadata?.importId) {
        return e.metadata.importId !== importId;
      }
      // Legacy format: match by fileName
      if (fileName && e.metadata?.fileName === fileName) {
        return false;
      }
      return true;
    });
    const deleted = before - this.entries.length;
    if (deleted > 0) {
      this.dirty = true;
      this.markIndexDirty();
      this.save();
    }
    return deleted;
  }

  hasImportedDocumentChunks(importId: string): boolean {
    return this.entries.some(
      (entry) => entry.source === "imported_doc" && String(entry.metadata?.importId ?? "") === importId,
    );
  }

  // Statistics
  get stats() {
    const sources: Record<string, number> = {};
    for (const e of this.entries) {
      sources[e.source] = (sources[e.source] || 0) + 1;
    }
    return { total: this.entries.length, sources };
  }
}

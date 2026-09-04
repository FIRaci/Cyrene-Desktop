import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { getEmbeddingProvider, resetEmbeddingProvider, EmbeddingProvider, switchEmbeddingModel as switchModel, getCurrentModelDims } from "./embedding";
import { JsonVectorStore } from "./vectorstore";
import type { MemoryEntry } from "./vectorstore";
import { HybridRetriever } from "./retriever";
import { WorldbookManager } from "./worldbook";
export { INJECTION_HEADER, INJECTION_PREAMBLE } from "./worldbook-constants";
import { chunkText } from "./chunk";
import { feedEntityNamesToJieba } from "../memory/entity-graph";
import { isL2LocallyRecallable } from "../memory/memory-types";
import type { DocumentImportControl } from "./file-ingest";

// ── Global RAG instances ──
let store: JsonVectorStore | null = null;
let retriever: HybridRetriever | null = null;
let worldbook: WorldbookManager | null = null;
let provider: EmbeddingProvider | null = null;

function getDataDir(): string {
  return path.join(app.getPath("userData"), "rag-data");
}

// ── Init ──
export async function initRAG(
  ragMode: "auto" | "local" | "cloud" = "auto",
  cloudBaseUrl?: string,
  cloudApiKey?: string,
  embeddingModel?: string
): Promise<void> {
  const dataDir = getDataDir();
  provider = getEmbeddingProvider(ragMode, cloudBaseUrl, cloudApiKey, embeddingModel);
  store = new JsonVectorStore(dataDir);
  // Create the retriever only when an embedding provider is available.
  if (provider) {
    retriever = new HybridRetriever(store, provider);
  }
  worldbook = new WorldbookManager(
    path.join(app.getAppPath(), "prompts", "worldbook"),
    { stateFile: path.join(app.getPath("userData"), "worldbook-state.json") }
  );
  await worldbook.loadFromDirectory();

  // Add known entity names to the tokenizer dictionary to preserve proper nouns.
  await feedEntityNamesToJieba();

  console.log(
    "[RAG] initialized. Mode:", ragMode,
    "Provider:", provider?.name ?? "none",
    "Dims:", provider?.dims ?? "N/A",
    "Memories:", store.stats.total,
    provider ? "" : " [Vector retrieval disabled]"
  );
}

// ── Switch embedding model (hot-swap) ──
export async function switchEmbeddingModel(modelKey: string): Promise<{ ok: boolean; clearedEntries: number; error?: string }> {
  try {
    // Switch the embedding pipeline first
    switchModel(modelKey);
    const newProvider = getEmbeddingProvider("auto", undefined, undefined, modelKey);

    // Report actionable diagnostics when the requested model is unavailable.
    if (!newProvider) {
      try {
        // require to avoid circular import at module load
        const { getModelInstallStatusDetail } = require("./model-status") as typeof import("./model-status");
        const detail = getModelInstallStatusDetail("embedding", modelKey);
        if (detail.existingProjectDir) {
          // Project-side directory exists but is incomplete — explicit warning,
          // do NOT silently fall back to HuggingFace cache.
          console.error(
            `[Cyrene] embedding model "${modelKey}" project directory exists but is incomplete.\n` +
            `  existingProjectDir: ${detail.existingProjectDir}\n` +
            `  requiredFiles:      ${JSON.stringify(detail.requiredFiles)}\n` +
            `  missingFiles:       ${JSON.stringify(detail.missingFiles)}\n` +
            `  HF cache fallback suppressed. Fix the files above, then retry.`,
          );
        } else {
          console.error(
            `[Cyrene] embedding model "${modelKey}" not detected anywhere.\n` +
            `  modelDirCandidates: ${JSON.stringify(detail.modelDirCandidates)}\n` +
            `  subPathCandidates:  ${JSON.stringify(detail.subPathCandidates)}\n` +
            `  requiredFiles:      ${JSON.stringify(detail.requiredFiles)}\n` +
            `  Drop the model files into one of the candidates above.`,
          );
        }
      } catch (diagErr) {
        console.error("[Cyrene] model diagnostic log failed:", diagErr);
      }
      return { ok: false, clearedEntries: 0, error: "Local embedding model not found. Cannot switch." };
    }
    
    const newDims = newProvider.dims;

    // Check existing entries for dimension mismatch
    let clearedEntries = 0;
    if (store) {
      const entries = (store as any).entries as Array<{ embedding: number[] }> | undefined;
      if (entries && entries.length > 0) {
        const oldDims = entries[0].embedding.length;
        if (oldDims !== newDims) {
          // Dimension mismatch — clear the vector store
          const dataDir = getDataDir();
          const storePath = path.join(dataDir, "memory-store.json");
          if (fs.existsSync(storePath)) {
            clearedEntries = entries.length;
            fs.writeFileSync(storePath, "[]", "utf8");
            console.log("[RAG] dimension mismatch (" + oldDims + " → " + newDims + "), cleared " + clearedEntries + " entries");
          }
          // Reload store from the now-empty file
          store = new JsonVectorStore(dataDir);
        }
      }
    }

    // Update provider reference and retriever
    provider = newProvider;
    if (store) {
      retriever = new HybridRetriever(store, provider);
    }

    console.log("[RAG] switched embedding model to", modelKey, "dims:", newDims, "cleared:", clearedEntries);
    return { ok: true, clearedEntries };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[RAG] switch embedding model failed:", message);
    return { ok: false, clearedEntries: 0, error: message };
  }
}

// ── Memory write ──
export async function addMemory(
  text: string,
  source = "user_memory",
  metadata?: Record<string, unknown>
): Promise<string> {
  if (!store || !provider) throw new Error("RAG not initialized");
  const entry = await store.add(text, source, provider, metadata);
  return entry.id;
}

export async function addL2MemoryVector(
  text: string,
  l2Id: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  if (!store || !provider) throw new Error("RAG not initialized");
  if (!l2Id.trim()) throw new Error("l2Id is required");
  const entry = await store.addUnique(text, "user_memory", provider, { ...metadata, l2Id });
  return entry.id;
}

// ── Memory search ──
export async function searchMemory(
  query: string,
  source?: string,
  topK = 5,
  options?: { recordRecall?: boolean }
): Promise<string[]> {
  const results = await searchMemoryEntries(query, source, topK, options);
  return results.map((r) => r.text);
}

export async function searchMemoryEntries(
  query: string,
  source?: string,
  topK = 5,
  options?: { recordRecall?: boolean }
): Promise<Array<{ id: string; text: string; createdAt: number; score: number; metadata?: Record<string, unknown> }>> {
  if (!retriever) return [];
  let allowedEntryIds: string[] | undefined;
  if (source === "user_memory") {
    try {
      const { memoryStore } = await import("../memory/memory-store");
      const memories = await memoryStore.getAllL2();
      const recallableById = new Map(
        memories.filter(isL2LocallyRecallable).map((memory) => [memory.id, memory]),
      );
      allowedEntryIds = getEntriesBySource("user_memory")
        .filter((entry) => {
          const l2Id = entry.metadata?.l2Id;
          if (typeof l2Id !== "string") return false;
          return recallableById.get(l2Id)?.ragId === entry.id;
        })
        .map((entry) => entry.id);
    } catch (err) {
      console.warn("[RAG] failed to resolve recallable user memories:", err);
      return [];
    }
  }
  const results = await retriever.retrieve(query, source, topK, { allowedEntryIds });
  if (options?.recordRecall !== false) {
    await recordUserMemoryRecalls(results);
  }
  return results.map((r) => ({
    id: r.entry.id,
    text: r.entry.text,
    createdAt: r.entry.createdAt,
    score: r.score,
    metadata: r.entry.metadata,
  }));
}

async function recordUserMemoryRecalls(results: Array<{ entry: MemoryEntry }>): Promise<void> {
  const l2Ids = results
    .filter((r) => r.entry.source === "user_memory")
    .map((r) => r.entry.metadata?.l2Id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (l2Ids.length === 0) return;
  try {
    const { memoryStore } = await import("../memory/memory-store");
    for (const l2Id of new Set(l2Ids)) {
      await memoryStore.updateL2RecallStats(l2Id, 1);
    }
  } catch (err) {
    console.warn("[RAG] failed to record user memory recall:", err);
  }
}

// History search with metadata for the recall_history tool.
// Unlike searchMemory, this returns complete entries for sorting and timestamps.
export async function searchHistoryEntries(
  query: string,
  topK = 5
): Promise<Array<{ text: string; createdAt: number; score: number; metadata?: Record<string, unknown> }>> {
  if (!retriever) return [];
  const results = await retriever.retrieve(query, "chat_history", topK);
  return results.map((r) => ({
    text: r.entry.text,
    createdAt: r.entry.createdAt,
    score: r.score,
    metadata: r.entry.metadata,
  }));
}

// Score Worldbook DMAE entries for the current turn.
export function updateWorldbookActivation(userText: string, modelText: string): void {
  if (!worldbook) return;
  worldbook.updateActivation(userText, modelText);
}

// Return active Worldbook DMAE entries after threshold gating.
export function getActiveWorldbookEntries(): string[] {
  if (!worldbook) return [];
  return worldbook.getActiveEntries();
}

// Return one-shot cascade entries without adding them to DMAE state.
export function getCascadeWorldbookEntries(): string[] {
  if (!worldbook) return [];
  return worldbook.getCascadeEntries().map(e => {
    const title = e.id.replace(/^wb_[^_]+_/, "").replace(/_/g, " ");
    return `[${title}]\n${e.content}`;
  });
}

// ── Get permanent worldbook entries ──
export function getPermanentWorldbookEntries(): string[] {
  if (!worldbook) return [];
  return worldbook.getPermanentEntries();
}

// ── Import document ──
export type ImportedDocumentResult = {
  importId: string;
  chunkCount: number;
};

export type ImportedDocumentChunk = {
  text: string;
  score: number;
  fileName?: string;
  chunkIndex?: number;
  importId?: string;
};

export type PreparedDocumentEmbedding = {
  text: string;
  chunkIndex: number;
  embedding: number[];
};

export async function appendPreparedDocumentBatch(
  fileName: string,
  importId: string,
  prepared: PreparedDocumentEmbedding[],
): Promise<void> {
  if (!store) throw new Error("RAG not initialized");
  store.addPreparedBatch(prepared.map((entry) => ({
    text: entry.text,
    embedding: entry.embedding,
    source: "imported_doc",
    metadata: { fileName, chunkIndex: entry.chunkIndex, importId },
  })));
}

export async function importPreparedDocumentForTurn(
  fileName: string,
  prepared: PreparedDocumentEmbedding[],
): Promise<ImportedDocumentResult> {
  if (!store) throw new Error("RAG not initialized");
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 8);
  const importId = `import-${Date.now()}-${id}`;
  await appendPreparedDocumentBatch(fileName, importId, prepared);
  return { importId, chunkCount: prepared.length };
}

export async function importDocumentForTurn(
  text: string,
  fileName: string,
  control?: DocumentImportControl,
): Promise<ImportedDocumentResult> {
  if (!store || !provider) throw new Error("RAG not initialized");
  const chunks = chunkText(text, "doc_" + fileName);
  control?.onProgress?.({ status: "chunking", completedChunks: chunks.length, totalChunks: chunks.length });
  if (control?.isCancelled?.()) throw new Error("cancelled");
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 8);
  const importId = `import-${Date.now()}-${id}`;
  control?.onProgress?.({ status: "embedding", completedChunks: 0, totalChunks: chunks.length });
  await store.addBatch(
    chunks.map((c) => ({ text: c.text, source: "imported_doc", metadata: { fileName, chunkIndex: c.index, importId } })),
    provider,
    { isCancelled: control?.isCancelled },
  );
  return { importId, chunkCount: chunks.length };
}

export async function importDocument(text: string, fileName: string): Promise<number> {
  const result = await importDocumentForTurn(text, fileName);
  return result.chunkCount;
}

export async function searchImportedDocumentChunksForImportIds(
  query: string,
  importIds: string[],
  topK = 6,
): Promise<ImportedDocumentChunk[]> {
  if (!retriever || !query.trim() || importIds.length === 0) return [];
  const results = await retriever.retrieve(query, "imported_doc", topK, { importIds });
  return results.map((result) => ({
    text: result.entry.text,
    score: result.score,
    fileName: typeof result.entry.metadata?.fileName === "string" ? result.entry.metadata.fileName : undefined,
    chunkIndex: typeof result.entry.metadata?.chunkIndex === "number" ? result.entry.metadata.chunkIndex : undefined,
    importId: typeof result.entry.metadata?.importId === "string" ? result.entry.metadata.importId : undefined,
  }));
}

// ── Build memory context (legacy, kept for compatibility) ──
// Legacy single-argument wrapper: model-response scoring is intentionally unavailable.
export async function buildMemoryContext(userInput: string): Promise<string> {
  const parts: string[] = [];

  // 1. Score and collect active Worldbook entries.
  updateWorldbookActivation(userInput, "");
  const wbResults = getActiveWorldbookEntries();
  if (wbResults.length > 0) {
    parts.push("[RELEVANT_BACKGROUND]\n" + wbResults.join("\n\n"));
  }

  // 2. Imported docs
  const docResults = await searchMemory(userInput, "imported_doc", 5);
  if (docResults.length > 0) {
    parts.push("[RELEVANT_DOCUMENT_EXCERPTS]\n" + docResults.map((m) => "- " + m).join("\n"));
  }

  // 3. User memory
  const memResults = await searchMemory(userInput, "user_memory", 3);
  if (memResults.length > 0) {
    parts.push("[USER_MEMORIES]\n" + memResults.map((m) => "- " + m).join("\n"));
  }

  return parts.join("\n\n");
}

// ── Reset ──
export function resetRAG(): void {
  store = null;
  retriever = null;
  worldbook = null;
  provider = null;
  resetEmbeddingProvider();
}

export function getRAGStats() {
  return store?.stats ?? { total: 0, sources: {} };
}

export function isUserMemoryVectorStoreReady(): boolean {
  return store !== null && provider !== null;
}

/**
 * Return shallow copies of vector entries for memory compression and clustering.
 */
export function getEntriesBySource(source: string): Array<{ id: string; text: string; embedding: number[]; createdAt: number; weight: number; metadata?: Record<string, unknown> }> {
  if (!store) return [];
  return ((store as any).entries as MemoryEntry[])
    .filter((e) => e.source === source)
    .map((e) => ({ id: e.id, text: e.text, embedding: e.embedding, createdAt: e.createdAt, weight: e.weight, metadata: e.metadata }));
}

export function deleteUserMemoryVectors(ragIds: string[]): number {
  if (!store) throw new Error("RAG not initialized");
  return store.deleteEntriesByIds(ragIds, "user_memory");
}

export function deleteImportedDoc(importId: string, fileName?: string): number {
  if (!store) throw new Error("RAG not initialized");
  return store.deleteImportedDoc(importId, fileName);
}

export function hasImportedDocumentChunks(importId: string): boolean {
  return store?.hasImportedDocumentChunks(importId) ?? false;
}

// Memory Compression + Reflection Engine
//
// Triggered every 20 rounds:
//   Phase A — Memory Compression: clusters similar L2 entries, merges them into a summary
//   Phase B — Reflection: reviews current L0/L1, suggests updates
//
// Executed in the background via enqueueLLMTask without affecting main chat flow.

import { memoryStore } from "./memory-store";
import type { L0WritableField } from "./memory-store";
import { addL2MemoryVector, deleteUserMemoryVectors, getEntriesBySource } from "../rag/index";
import { cosineSimilarity } from "../rag/vectorstore";
import { L0_FIELD_DESCRIPTIONS } from "./memory-types";
import type { L2Memory } from "./memory-types";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { getAdapterForConfig } from "../orchestrator/vendors";
import { recordUsage } from "../token-usage-store";
import { commitMemoryCompression } from "./memory-compression-transaction";
import { isModelEndpointUsable } from "../../shared/model-endpoint";

// ── LLM Invocation (reuses the same API pattern as MemoryJudge) ──

interface ModelSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  explicitTransport?: "openai" | "anthropic" | "auto";
}

function loadModelSettings(): ModelSettings {
  const defaults = { provider: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKey: "" };
  try {
    const filePath = path.join(app.getPath("userData"), "model-settings.json");
    if (!fs.existsSync(filePath)) return defaults;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    const explicitTransport: ModelSettings["explicitTransport"] =
      parsed.explicitTransport === "openai" || parsed.explicitTransport === "anthropic" || parsed.explicitTransport === "auto"
        ? parsed.explicitTransport
        : undefined;
    return {
      provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider.trim() : defaults.provider,
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : defaults.baseUrl,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : defaults.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
      explicitTransport,
    };
  } catch { return defaults; }
}

async function callLLM(messages: Array<{ role: "system" | "user"; content: string }>, maxTokens = 500): Promise<string> {
  const settings = loadModelSettings();
  if (!isModelEndpointUsable(settings)) throw new Error("No usable model is configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  const cfg = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    explicitTransport: settings.explicitTransport,
  };

  try {
    // Use adapter for provider-agnostic request/response handling
    const adapter = getAdapterForConfig(cfg);
    const http = adapter.buildRequest({
      model: cfg.model,
      messages,
      maxTokens,
      stream: false,
    }, cfg);

    const response = await fetch(http.url, {
      method: "POST",
      signal: controller.signal,
      headers: http.headers,
      body: http.body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = (errorData as { error?: { message?: string } }).error?.message;
      throw new Error(errMsg || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const parsed = adapter.parseResponse(data);

    if (parsed.usage) {
      recordUsage(parsed.usage.input, parsed.usage.output, 1);
    }

    return parsed.text ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ── Utility Functions ──

/** Extract JSON object array from text (tolerant: truncation, markdown fences) */
function extractJsonArray(raw: string): unknown[] | null {
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const start = text.indexOf("[");
  if (start === -1) return null;
  text = text.slice(start);

  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch { /* fall through */ }

  // Truncation rescue: extract complete objects one by one
  const results: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") { i++; continue; }
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    try { const obj = JSON.parse(text.slice(i, j + 1)); if (obj && typeof obj === "object") results.push(obj); } catch { /* skip */ }
    i = j + 1;
  }
  return results.length > 0 ? results : null;
}

// ── Phase A: Memory Compression ──

const SIMILARITY_THRESHOLD = 0.85;
const MIN_GROUP_SIZE = 3;

interface GroupedEntry {
  l2: L2Memory;
  embedding: number[];
}

async function compressMemories(): Promise<number> {
  const allL2 = await memoryStore.getAllL2();
  const activeL2 = allL2.filter((m) => m.status === "active" && !m.isSummary && m.ragId);

  if (activeL2.length < MIN_GROUP_SIZE) {
    console.log("[MemoryCompressor] Insufficient active L2 items, skipping compression");
    return 0;
  }

  // Fetch user_memory entries from RAG to build ragId -> embedding map
  const ragEntries = getEntriesBySource("user_memory");
  const embeddingMap = new Map<string, number[]>();
  for (const re of ragEntries) {
    embeddingMap.set(re.id, re.embedding);
  }

  // Pair each L2 item with embedding
  const withEmbedding: GroupedEntry[] = [];
  for (const l2 of activeL2) {
    if (l2.ragId) {
      const emb = embeddingMap.get(l2.ragId);
      if (emb) withEmbedding.push({ l2, embedding: emb });
    }
  }

  if (withEmbedding.length < MIN_GROUP_SIZE) {
    console.log("[MemoryCompressor] Insufficient items with embedding, skipping compression");
    return 0;
  }

  // Greedy clustering: pick seed, find all entries with similarity >= threshold
  const used = new Set<string>();
  const groups: GroupedEntry[][] = [];

  for (let i = 0; i < withEmbedding.length; i++) {
    if (used.has(withEmbedding[i].l2.id)) continue;

    const group: GroupedEntry[] = [withEmbedding[i]];
    used.add(withEmbedding[i].l2.id);

    for (let j = i + 1; j < withEmbedding.length; j++) {
      if (used.has(withEmbedding[j].l2.id)) continue;
      const sim = cosineSimilarity(withEmbedding[i].embedding, withEmbedding[j].embedding);
      if (sim >= SIMILARITY_THRESHOLD) {
        group.push(withEmbedding[j]);
        used.add(withEmbedding[j].l2.id);
      }
    }

    if (group.length >= MIN_GROUP_SIZE) {
      groups.push(group);
    }
  }

  if (groups.length === 0) {
    console.log("[MemoryCompressor] No compressible groups found");
    return 0;
  }

  console.log(`[MemoryCompressor] Found ${groups.length} compressible groups`);

  // Call LLM for each group to generate summary
  let totalCompressed = 0;
  for (const group of groups) {
    try {
      const texts = group.map((g) => `- ${g.l2.content}`);
      const prompt = [
        "You are a memory summarization assistant. Below is a set of similar user memory entries, please merge them into a concise summary.",
        "Requirements:",
        "- Retain all key information, deduplicate",
        "- Use natural English",
        "- Keep within 100 words",
        "- Output summary text directly without extra explanations",
        "",
        "Memory items:",
        ...texts,
      ].join("\n");

      const summary = await callLLM([
        { role: "system", content: "You are a concise memory summarization assistant." },
        { role: "user", content: prompt },
      ], 300);

      const cleanSummary = summary.replace(/^["「『]|["」』]$/g, "").trim();
      if (!cleanSummary || cleanSummary.length < 5) continue;

      const subEntryIds = group.map((g) => g.l2.id);
      await commitMemoryCompression({
        content: cleanSummary,
        triggerText: group[0].l2.triggerText,
        sourceConversationId: group[0].l2.sourceConversationId,
        sources: group.map((entry) => ({
          id: entry.l2.id,
          ragId: entry.l2.ragId,
          status: entry.l2.status,
        })),
      }, {
        createSummary: (input) => memoryStore.addL2Memory(input),
        addSummaryVector: addL2MemoryVector,
        markSummarySynced: (l2Id, ragId) => memoryStore.markL2SyncStatus(l2Id, "synced", ragId),
        archiveSources: (ids) => memoryStore.archiveL2Batch(ids),
        restoreSources: async (sources) => {
          const byStatus = new Map<L2Memory["status"], string[]>();
          for (const source of sources) {
            byStatus.set(source.status, [...(byStatus.get(source.status) ?? []), source.id]);
          }
          for (const [status, ids] of byStatus) await memoryStore.updateL2Status(ids, status);
        },
        deactivateSummary: (id) => memoryStore.updateL2Status([id], "archived"),
        deleteSummary: (id) => memoryStore.deleteL2(id),
        deleteVectors: (ids) => deleteUserMemoryVectors(ids),
        warn: (message, error) => console.warn(`[MemoryCompressor] ${message}:`, error),
      });

      // Log reflection
      await memoryStore.appendReflectionLog({
        type: "compression",
        summary: `Compressed ${subEntryIds.length} memories into one summary`,
        details: `Original entries: ${texts.join(" | ")}\nSummary: ${cleanSummary}`,
      });

      totalCompressed += subEntryIds.length;
      console.log(`[MemoryCompressor] Compressed ${subEntryIds.length} items -> "${cleanSummary.slice(0, 40)}"`);
    } catch (err) {
      console.warn("[MemoryCompressor] Group compression failed:", err);
    }
  }

  return totalCompressed;
}

// ── Phase B: Reflection (L0/L1 Metacognitive Updates) ──

async function runReflection(): Promise<void> {
  try {
    const l0 = await memoryStore.getL0();
    const l1 = await memoryStore.getL1();

    if (l0.isPinned) {
      console.log("[Reflection] L0 is pinned, skipping update recommendations");
    }

    // Build LLM prompt
    const currentProfile = [
      "Current User Profile:",
      l0.preferredName ? `  Preferred Name: ${l0.preferredName}` : "",
      l0.occupation ? `  Occupation: ${l0.occupation}` : "",
      l0.longTermInterests ? `  Long-term Interests: ${l0.longTermInterests}` : "",
      l0.language ? `  Preferred language: ${l0.language}` : "",
      l0.permanentNote ? `  Permanent Note: ${l0.permanentNote}` : "",
      "",
      "Current Recent State:",
      l1.recentGoals ? `  Recent Goals: ${l1.recentGoals}` : "",
      l1.recentPreferences ? `  Recent Preferences: ${l1.recentPreferences}` : "",
      l1.currentProject ? `  Current Project: ${l1.currentProject}` : "",
      `  Round Count: ${l1.roundCount}`,
    ].filter(Boolean).join("\n");

    const fieldDescriptions = Object.entries(L0_FIELD_DESCRIPTIONS)
      .map(([field, desc]) => `  ${field}：${desc}`)
      .join("\n");

    const prompt = [
      "You are a user profile reflection assistant.",
      "Review long-term interactions with the user and determine if user profile or recent state should be updated.",
      "",
      currentProfile,
      "",
      "Please analyze:",
      "1. Is there information to update L0 fields (stable identity)?",
      `   Available fields:\n${fieldDescriptions}`,
      "2. Is there information to update L1 fields (recent goals/preferences/projects)?",
      "",
      "If no update is needed, return empty array [].",
      "If update is needed, return in JSON array format, each element containing:",
      '{ "layer": "L0"|"L1", "field": "fieldName", "content": "newValue", "confidence": 0.0~1.0 }',
      "",
      "Output JSON only without extra explanations.",
    ].join("\n");

    const raw = await callLLM([
      { role: "system", content: "You are a prudent user profile reflection assistant. Output JSON array only." },
      { role: "user", content: prompt },
    ], 500);

    const parsed = extractJsonArray(raw);
    if (!parsed || parsed.length === 0) {
      console.log("[Reflection] No L0/L1 update suggestions");
      return;
    }

    const validFields = Object.keys(L0_FIELD_DESCRIPTIONS);
    let updateCount = 0;

    for (const item of parsed) {
      const rec = item as Record<string, unknown>;
      const layer = rec.layer;
      const field = rec.field as string | undefined;
      const content = rec.content as string | undefined;
      const confidence = rec.confidence as number | undefined;

      if (!content || !confidence || confidence < 0.6) continue;

      if (layer === "L0" && field && validFields.includes(field) && !l0.isPinned) {
        await memoryStore.upsertL0Field(field as L0WritableField, content.trim());
        await memoryStore.appendReflectionLog({
          type: "l0_update",
          summary: `L0.${field} updated to "${content.slice(0, 30)}" (confidence ${confidence.toFixed(2)})`,
        });
        updateCount++;
        console.log(`[Reflection] L0.${field} updated: "${content.slice(0, 30)}"`);
      } else if (layer === "L1") {
        const l1Field = /goal|want|plan|aim|intend/i.test(content) ? "recentGoals" : "recentPreferences";
        await memoryStore.replaceL1Field(l1Field, content.trim());
        await memoryStore.appendReflectionLog({
          type: "l1_update",
          summary: `L1.${l1Field} updated to "${content.slice(0, 30)}" (confidence ${confidence.toFixed(2)})`,
        });
        updateCount++;
        console.log(`[Reflection] L1.${l1Field} updated: "${content.slice(0, 30)}"`);
      }
    }

    console.log(`[Reflection] Done, updated ${updateCount} fields`);
  } catch (err) {
    console.warn("[Reflection] Execution failed:", err);
  }
}

// ── Public API ──

/**
 * Run memory compression + Reflection.
 * Triggered by scheduleMemoryWrite every 20 rounds.
 */
export async function runReflectionAndCompression(): Promise<void> {
  console.log("[Memory] Starting 20-round Reflection + memory compression...");

  // Phase A: Memory compression
  const compressed = await compressMemories();
  console.log(`[Memory] Compression complete, compressed ${compressed} raw memories in total`);

  // Phase B: Reflection (L0/L1 metacognitive updates)
  await runReflection();

  // Rebuild RAG index on data changes
  try {
    const { JsonVectorStore } = await import("../rag/vectorstore");
    // Lazy rebuild will trigger on next search
    console.log("[Memory] Vector index marked dirty, will auto-rebuild on next search");
  } catch { /* ignore */ }

  console.log("[Memory] Reflection + compression workflow finished");
}

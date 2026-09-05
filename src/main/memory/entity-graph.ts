// Lightweight entity relation graph
//
// Automatically extracts entities (persons, places, preferences, concepts) and relations from conversations,
// supplementing vector search for relational queries like "Who is the friend mentioned by the user".
//
// Stored as a JSON file alongside memory.json.

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { registerJiebaCustomWord, registerJiebaCustomWords } from "../rag/retriever";

// ── Types ──

export interface EntityNode {
  id: string;
  name: string;
  type: "person" | "place" | "concept" | "preference" | "organization";
  aliases: string[];         // Alternative names
  mentionCount: number;
  firstMentionedAt: number;
  lastMentionedAt: number;
}

export interface EntityRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;          // "likes" | "works_at" | "lives_in" | "friend_of" | "owns" | ...
  confidence: number;        // 0.0 ~ 1.0
  strength: number;          // Accumulated mention count
}

interface EntityGraphData {
  entities: EntityNode[];
  relations: EntityRelation[];
}

// ── Simple parser (heuristics using regex without LLM dependency) ──

// Common entity trigger patterns
const ENTITY_PATTERNS: Array<{ type: EntityNode["type"]; patterns: RegExp[] }> = [
  {
    type: "person",
    patterns: [
      /my friend\s+([a-zA-Z0-9_-]{2,20})/gi,
      /colleague\s+([a-zA-Z0-9_-]{2,20})/gi,
      /boss\s+([a-zA-Z0-9_-]{2,20})/gi,
      /named\s+([a-zA-Z0-9_-]{2,20})/gi,
      /([a-zA-Z0-9_-]{2,20})\s+is my friend/gi,
    ],
  },
  {
    type: "place",
    patterns: [
      /lives?\s+in\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /works?\s+in\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /went\s+to\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /traveling\s+to\s+([a-zA-Z0-9\s_-]{2,30})/gi,
    ],
  },
  {
    type: "organization",
    patterns: [
      /at\s+([a-zA-Z0-9\s_-]{2,30})\s+(?:company|team|studio|university|school|institute)/gi,
      /([a-zA-Z0-9\s_-]{2,30})\s+corp(?:oration)?/gi,
      /([a-zA-Z0-9\s_-]{2,30})\s+inc\.?/gi,
    ],
  },
  {
    type: "preference",
    patterns: [
      /likes?\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /loves?\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /favorite\s+([a-zA-Z0-9\s_-]{2,30})/gi,
      /hates?\s+([a-zA-Z0-9\s_-]{2,30})/gi,
    ],
  },
];

/** Heuristically extract entity names from text, returning [type, name] list */
export function extractEntitiesFromText(text: string): Array<{ type: EntityNode["type"]; name: string }> {
  const results: Array<{ type: EntityNode["type"]; name: string }> = [];
  const seen = new Set<string>();

  for (const { type, patterns } of ENTITY_PATTERNS) {
    for (const regex of patterns) {
      const matches = text.matchAll(regex);
      for (const m of matches) {
        const name = m[1]?.trim();
        if (name && name.length >= 2 && name.length <= 10 && !seen.has(`${type}:${name}`)) {
          seen.add(`${type}:${name}`);
          results.push({ type, name });
        }
      }
    }
  }

  return results;
}

// ── Entity Graph Manager ──

const dataDir = () => path.join(app.getPath("userData"));
const getPath = () => path.join(dataDir(), "entity-graph.json");

class EntityGraph {
  private cache: EntityGraphData | null = null;

  load(): EntityGraphData {
    if (this.cache) return this.cache;
    try {
      const filePath = getPath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        this.cache = JSON.parse(raw) as EntityGraphData;
      } else {
        this.cache = { entities: [], relations: [] };
      }
    } catch {
      this.cache = { entities: [], relations: [] };
    }
    return this.cache;
  }

  save(): void {
    if (!this.cache) return;
    const filePath = getPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(this.cache, null, 2), "utf8");
  }

  /** Extract entities from conversation text and ingest into store */
  ingest(text: string): void {
    const data = this.load();
    const extracted = extractEntitiesFromText(text);
    const now = Date.now();
    let hasNewEntity = false;

    for (const { type, name } of extracted) {
      const existing = data.entities.find(
        (e) => e.name === name || e.aliases.includes(name),
      );
      if (existing) {
        existing.mentionCount++;
        existing.lastMentionedAt = now;
      } else {
        data.entities.push({
          id: `ent_${now}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          type,
          aliases: [],
          mentionCount: 1,
          firstMentionedAt: now,
          lastMentionedAt: now,
        });
        hasNewEntity = true;
        // Feed new entity to custom dictionary immediately to prevent split errors
        this.feedSingleName(name);
      }
    }

    if (extracted.length > 0) this.save();
  }

/**
 * Register a name to the custom dictionary.
 */
  private feedSingleName(name: string): void {
    registerJiebaCustomWord(name);
  }

  /** Search entities and relations related to query, returning readable text */
  search(query: string): string {
    const data = this.load();
    if (data.entities.length === 0) return "";

    // Simple keyword match: find entities whose name contains any word in query
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matchedEntities = data.entities.filter((e) =>
      queryTokens.some((t) => e.name.includes(t) || e.aliases.some((a) => a.includes(t))),
    );

    if (matchedEntities.length === 0) return "";

    const lines: string[] = [];
    for (const entity of matchedEntities) {
      const mentions = entity.mentionCount > 1 ? ` (mentioned ${entity.mentionCount} times)` : "";
      lines.push(`· ${entity.name} (${typeLabel(entity.type)})${mentions}`);

      // Find all relations associated with this entity
      const outgoing = data.relations.filter((r) => r.sourceId === entity.id);
      for (const rel of outgoing) {
        const target = data.entities.find((e) => e.id === rel.targetId);
        if (target) {
          lines.push(`  → ${rel.relation} ${target.name}`);
        }
      }

      const incoming = data.relations.filter((r) => r.targetId === entity.id);
      for (const rel of incoming) {
        const source = data.entities.find((e) => e.id === rel.sourceId);
        if (source) {
          lines.push(`  ← ${source.name} ${rel.relation}`);
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : "";
  }

  /** Clear the graph */
  reset(): void {
    this.cache = { entities: [], relations: [] };
    this.save();
  }
}

/** Get all entity names including aliases */
export function getAllEntityNames(): string[] {
  const graph = entityGraph.load();
  const names = new Set<string>();
  for (const e of graph.entities) {
    names.add(e.name);
    for (const a of e.aliases) names.add(a);
  }
  return [...names].filter((n) => n.length >= 2);
}

/**
 * Register all entity names in the entity graph into the custom dictionary.
 */
export async function feedEntityNamesToJieba(): Promise<void> {
  const names = getAllEntityNames();
  if (names.length === 0) return;
  registerJiebaCustomWords(names);
  console.log(`[EntityGraph] Registered ${names.length} entity names to custom dictionary`);
}

function typeLabel(type: EntityNode["type"]): string {
  switch (type) {
    case "person": return "Person";
    case "place": return "Place";
    case "organization": return "Organization";
    case "preference": return "Preference";
    case "concept": return "Concept";
  }
}

export const entityGraph = new EntityGraph();
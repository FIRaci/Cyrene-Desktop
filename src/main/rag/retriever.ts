import { JsonVectorStore, SearchResult } from "./vectorstore";
import { EmbeddingProvider, getEmbeddingProvider } from "./embedding";

// ── Tokenizer (@node-rs/jieba with English fallback) ──
import { Jieba } from "@node-rs/jieba";

const jieba = new Jieba();

interface TokenInfo {
  word: string;
  tag: string;       // POS tag
  isStop: boolean;   // Whether it is a stopword
  isNoun: boolean;   // Whether it is a noun or proper noun
}

// ── Common stopwords ──
const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is",
  "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
  "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", "ours",
  "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should",
  "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs", "them",
  "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we",
  "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
]);

// Function word tags for BM25 downweighting
const STOP_TAGS = new Set(["u", "c", "p", "d", "r", "y", "o", "e", "m", "q", "f"]);
// Noun tags for upweighting
const NOUN_TAGS = new Set(["n", "nr", "ns", "nt", "nz", "ng", "vn", "an"]);

/** Stopword penalty factor */
const STOP_WEIGHT = 0.3;
/** Noun bonus factor */
const NOUN_WEIGHT = 1.3;

export interface RetrieveOptions {
  importIds?: string[];
  allowedEntryIds?: string[];
}

// ── Custom word dictionary (maintained by entity-graph) ──
// Post-processing merges custom words segmented by tokenizer.
const customWords = new Set<string>();

/** Register custom word */
export function registerJiebaCustomWord(word: string): void {
  if (word.length >= 2) customWords.add(word);
}

/** Batch register custom words */
export function registerJiebaCustomWords(words: Iterable<string>): void {
  for (const w of words) {
    if (w.length >= 2) customWords.add(w);
  }
}

/** Post-process: merge consecutive tokens matching custom words */
function mergeCustomWords(tokens: string[]): string[] {
  if (customWords.size === 0 || tokens.length < 2) return tokens;

  // Sort by length descending, matching longer words first
  const sortedWords = [...customWords].sort((a, b) => b.length - a.length);

  // Scan with window matching: merge matching tokens into one word
  const result: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (const word of sortedWords) {
      const wordTokens = word.split("");
      // Check if consecutive tokens from i form word
      let ok = true;
      for (let j = 0; j < wordTokens.length; j++) {
        if (i + j >= tokens.length || tokens[i + j] !== wordTokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        result.push(word);
        i += wordTokens.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push(tokens[i]);
      i++;
    }
  }
  return result;
}

function tokenize(text: string): TokenInfo[] {
  // English/numeric text uses space tokenization
  if (/^[a-zA-Z0-9\s]+$/.test(text)) {
    return text.split(/\s+/).filter(Boolean).map((word) => ({
      word: word.toLowerCase(),
      tag: "eng",
      isStop: false,
      isNoun: false,
    }));
  }

  try {
    // HMM model helps recognize out-of-vocabulary entities;
    // mergeCustomWords handles reassembling split entities.
    const rawCuts = jieba.cut(text, true);
    const mergedCuts = mergeCustomWords(rawCuts);

    // Tag merged tokens individually
    const result: TokenInfo[] = [];
    for (const word of mergedCuts) {
      const tagged = jieba.tag(word, true);
      const first = tagged[0] ?? { word, tag: "x" };
      result.push({
        word: word.toLowerCase(),
        tag: first.tag,
        isStop: STOP_WORDS.has(word) || STOP_TAGS.has(first.tag),
        isNoun: NOUN_TAGS.has(first.tag),
      });
    }
    return result;
  } catch {
    // Fallback to character tokenization on error
    const tokens: TokenInfo[] = [];
    const seg = text.split(/([\u4e00-\u9fff]|[a-zA-Z]+|\d+)/).filter(Boolean);
    for (const s of seg) {
      if (/[\u4e00-\u9fff]/.test(s)) {
        for (const c of s) {
          tokens.push({ word: c, tag: "x", isStop: STOP_WORDS.has(c), isNoun: false });
        }
      } else {
        tokens.push({ word: s.toLowerCase(), tag: "eng", isStop: false, isNoun: false });
      }
    }
    return tokens;
  }
}

function bm25Score(
  queryTokens: TokenInfo[],
  docTokens: TokenInfo[],
  docFreq: Map<string, number>,
  totalDocs: number,
  avgDocLen: number
): number {
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;

  // Document term frequency
  const tf: Map<string, number> = new Map();
  for (const t of docTokens) {
    tf.set(t.word, (tf.get(t.word) || 0) + 1);
  }

  for (const qt of queryTokens) {
    const df = docFreq.get(qt.word) || 0;
    if (df === 0) continue;

    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const termFreq = tf.get(qt.word) || 0;
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (avgDocLen ? docTokens.length / avgDocLen : 1));
    let termScore = idf * (numerator / denominator);

    // Noun bonus: informative carrier, boost weight
    if (qt.isNoun) termScore *= NOUN_WEIGHT;
    // Stopword penalty: lower interference
    if (qt.isStop) termScore *= STOP_WEIGHT;

    score += termScore;
  }

  return score;
}

// ── Hybrid Retriever ──
export class HybridRetriever {
  private store: JsonVectorStore;
  private provider: EmbeddingProvider | null;

  constructor(store: JsonVectorStore, provider?: EmbeddingProvider | null) {
    this.store = store;
    this.provider = provider ?? null;
  }

  async retrieve(
    query: string,
    source?: string,
    topK = 5,
    options: RetrieveOptions = {},
    vectorWeight = 0.7,
    bm25Weight = 0.3
  ): Promise<SearchResult[]> {
    const stats = this.store.stats;
    if (stats.total === 0) return [];

    // If no embedding provider, vector search is unavailable; use BM25 only
    if (!this.provider) {
      const bm25Results = this.bm25Search(query, source, topK, options);
      return bm25Results;
    }

    // 1. Vector retrieval
    const vectorResults = await this.store.search(query, source, this.provider, topK * 3, 0.3, options);

    // 2. BM25 retrieval
    const bm25Results = this.bm25Search(query, source, topK * 3, options);

    // 3. Fusion: weighted sum
    const merged: Map<string, { result: SearchResult; vectorScore: number; bm25Score: number }> = new Map();

    for (const r of vectorResults) {
      merged.set(r.entry.id, { result: r, vectorScore: r.score, bm25Score: 0 });
    }

    for (const r of bm25Results) {
      const existing = merged.get(r.entry.id);
      if (existing) {
        existing.bm25Score = r.score;
      } else {
        merged.set(r.entry.id, { result: r, vectorScore: 0, bm25Score: r.score });
      }
    }

    // Normalize + weight
    const all = Array.from(merged.values());
    const maxV = Math.max(...all.map((m) => m.vectorScore), 1);
    const maxB = Math.max(...all.map((m) => m.bm25Score), 1);

    const scored = all.map((m) => ({
      ...m.result,
      score: (m.vectorScore / maxV) * vectorWeight + (m.bm25Score / maxB) * bm25Weight,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private bm25Search(query: string, source?: string, topK = 15, options: RetrieveOptions = {}): SearchResult[] {
    const entries = this.store["entries"] as Array<{
      id: string; text: string; embedding: number[]; source: string;
      weight: number; createdAt: number; lastRecalledAt: number; metadata?: Record<string, unknown>;
    }>;

    const allowedImportIds = new Set(options.importIds ?? []);
    const allowedEntryIds = options.allowedEntryIds ? new Set(options.allowedEntryIds) : null;
    const docs = (source ? entries.filter((e) => e.source === source) : entries).filter((entry) =>
      (!allowedImportIds.size || allowedImportIds.has(String(entry.metadata?.importId ?? ""))) &&
      (!allowedEntryIds || allowedEntryIds.has(entry.id)),
    );
    if (docs.length === 0) return [];

    const queryTokenInfo = tokenize(query);
    const docTokensList = docs.map((d) => tokenize(d.text));
    const totalDocs = docs.length;
    const avgDocLen = docTokensList.reduce((sum, t) => sum + t.length, 0) / totalDocs;

    // Document frequency
    const docFreq = new Map<string, number>();
    for (const tokens of docTokensList) {
      const seen = new Set<string>();
      for (const t of tokens) {
        if (!seen.has(t.word)) {
          docFreq.set(t.word, (docFreq.get(t.word) || 0) + 1);
          seen.add(t.word);
        }
      }
    }

    const scored = docs.map((doc, i) => {
      // Score considering tokens present in query
      const queryWords = queryTokenInfo.map((t) => t.word);
      const docTokens = docTokensList[i];

      // Calculate BM25 only for terms in query
      const queryWordsSet = new Set(queryWords);
      const relevantDocTokens = docTokens.filter((t) => queryWordsSet.has(t.word));
      
      // If doc matches no query terms, score is 0
      if (relevantDocTokens.length === 0) {
        return {
          entry: {
            id: doc.id,
            text: doc.text,
            embedding: doc.embedding,
            source: doc.source,
            weight: doc.weight,
            createdAt: doc.createdAt,
            lastRecalledAt: doc.lastRecalledAt,
            metadata: doc.metadata,
          },
          score: 0,
        };
      }

      return {
        entry: {
          id: doc.id,
          text: doc.text,
          embedding: doc.embedding,
          source: doc.source,
          weight: doc.weight,
          createdAt: doc.createdAt,
          lastRecalledAt: doc.lastRecalledAt,
          metadata: doc.metadata,
        },
        score: bm25Score(queryTokenInfo, docTokens, docFreq, totalDocs, avgDocLen),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

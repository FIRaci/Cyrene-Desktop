import * as fs from "fs"
import * as path from "path"
import { getAdapterForConfig } from "../orchestrator/vendors"
import type { VendorConfig, ChatMessage } from "../orchestrator/vendors"
import { app } from "electron"
import { MemoryCandidate, L0_FIELD_DESCRIPTIONS, MemoryJudgeTurn } from "./memory-types"
import { recordUsage } from "../token-usage-store"
import { isModelEndpointUsable, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, LOCAL_MODEL_PROVIDER } from "../../shared/model-endpoint"

interface ModelSettings {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  explicitTransport?: "openai" | "anthropic" | "auto"
}

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: LOCAL_MODEL_PROVIDER,
  baseUrl: DEFAULT_OLLAMA_BASE_URL,
  model: DEFAULT_OLLAMA_MODEL,
  apiKey: "",
};

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "model-settings.json")
}

function loadModelSettings(): ModelSettings {
  try {
    const filePath = getSettingsPath()
    if (!fs.existsSync(filePath)) return DEFAULT_MODEL_SETTINGS
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<ModelSettings>
    // explicitTransport taken from top-level (mirror of perProvider[currentProvider])
    const explicitTransport: ModelSettings["explicitTransport"] =
      parsed.explicitTransport === "openai" || parsed.explicitTransport === "anthropic" || parsed.explicitTransport === "auto"
        ? parsed.explicitTransport
        : undefined;
    return {
      provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider.trim() : DEFAULT_MODEL_SETTINGS.provider,
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : DEFAULT_MODEL_SETTINGS.baseUrl,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : DEFAULT_MODEL_SETTINGS.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
      explicitTransport,
    };
  } catch {
    return DEFAULT_MODEL_SETTINGS
  }
}



function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim()
}

function extractJsonArray(raw: string): unknown[] | null {
  // Step 1: Remove markdown code block fences + think blocks
  let text = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim()

  // Step 2: Slice content starting from first [ (doesn't require trailing ] to handle max_tokens truncation)
  const start = text.indexOf('[')
  if (start === -1) return null
  text = text.slice(start)

  // Step 3: Attempt direct parse (for complete arrays)
  try {
    const parsed = JSON.parse(text) as unknown[]
    if (Array.isArray(parsed)) return parsed
  } catch (_) {}

  // Step 4: Truncation rescue — even if trailing ] is missing, extract completed {...} objects one by one.
  // Key: track brace depth to avoid treating internal } as object end.
  const results: unknown[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue }
    // Find matching } — track quotes and nesting depth
    let depth = 0
    let inStr = false
    let esc = false
    let j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break  // Found matching closing brace
      }
    }
    if (depth !== 0) break  // Object was truncated, no subsequent complete objects
    const objStr = text.slice(i, j + 1)
    try {
      const obj = JSON.parse(objStr)
      if (obj && typeof obj === "object") results.push(obj)
    } catch (_) {
      // Single object parse failed, continue searching for next
    }
    i = j + 1
  }

  if (results.length > 0) {
    console.log('[MemoryJudge] Truncation rescue extraction succeeded, count:', results.length)
    return results
  }

  // Step 5: Fix nested double quotes issue (retry for complete array)
  try {
    // Append missing ] to give JSON.parse a chance to succeed
    const fixedText = text.replace(/("content"|"triggerText"):\s*"([\s\S]*?)(?<!\\)"/g,
      (match: string, key: string, value: string) => {
        let k = 0
        const cleaned = value.replace(/"/g, () => k++ % 2 === 0 ? '「' : '」')
        return key + ': "' + cleaned + '"'
      }
    )
    // Try finding last complete object and append ]
    const lastBrace = fixedText.lastIndexOf('}')
    if (lastBrace > 0) {
      const candidate = fixedText.slice(0, lastBrace + 1) + ']'
      const parsed = JSON.parse(candidate) as unknown[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch (_) {}

  return null
}

const ABSOLUTE_TERMS = ["only", "always", "never", "definitely", "completely", "absolutely", "forever"]

function hasUnsupportedAbsolute(summary: string, evidenceQuotes: string[]): boolean {
  return ABSOLUTE_TERMS.some((term) => summary.includes(term) && !evidenceQuotes.some((quote) => quote.includes(term)))
}

function normalizeCandidate(input: unknown): MemoryCandidate | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const layer = record.layer
  const summary = record.summary
  const importance = record.importance
  const stability = record.stability
  const certainty = record.certainty
  const attribution = record.attribution
  const evidenceQuotes = Array.isArray(record.evidenceQuotes) ? record.evidenceQuotes.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
  const contextSummary = record.contextSummary
  const shouldWrite = record.shouldWrite
  const reason = record.reason
  const forbiddenOverclaims = Array.isArray(record.forbiddenOverclaims) ? record.forbiddenOverclaims.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : []
  if (layer !== "L0" && layer !== "L1" && layer !== "L2") return null
  if (typeof summary !== "string" || !summary.trim()) return null
  if (importance !== "low" && importance !== "medium" && importance !== "high") return null
  if (stability !== "one_off" && stability !== "situational" && stability !== "stable") return null
  if (certainty !== "explicit" && certainty !== "inferred" && certainty !== "uncertain") return null
  if (attribution !== "user_explicit" && attribution !== "assistant_inferred" && attribution !== "mixed") return null
  if (shouldWrite !== true) return null
  if (typeof contextSummary !== "string" || !contextSummary.trim()) return null
  if (typeof reason !== "string" || !reason.trim()) return null
  if (evidenceQuotes.length === 0) return null
  if (forbiddenOverclaims.length > 0) return null
  if (hasUnsupportedAbsolute(summary, evidenceQuotes)) return null

  const confidence =
    certainty === "explicit" ? 0.9 :
    certainty === "inferred" ? 0.65 :
    0.4
  return {
    layer,
    field: typeof record.field === 'string' ? record.field : undefined,
    summary: summary.trim(),
    content: summary.trim(),
    confidence,
    triggerText: evidenceQuotes[0],
    importance,
    stability,
    certainty,
    attribution,
    evidenceQuotes,
    contextSummary: contextSummary.trim(),
    shouldWrite,
    reason: reason.trim(),
    forbiddenOverclaims,
  }
}

async function callChatCompletions(
  settings: ModelSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  timeoutMs: number,
  label: string,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Build VendorConfig
  const cfg: VendorConfig = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    explicitTransport: settings.explicitTransport,
  }

  try {
    // Use vendor adapter for multi-transport routing
    const adapter = getAdapterForConfig(cfg)
    const http = adapter.buildRequest({
      model: cfg.model,
      messages: messages as ChatMessage[],
      maxTokens: 800,
      stream: false,
    }, cfg)

    const response = await fetch(http.url, {
      method: "POST",
      signal: controller.signal,
      headers: http.headers,
      body: http.body,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>
      const errMsg = (errorData as { error?: { message?: string } }).error?.message
      throw new Error(errMsg || `Model request failed: HTTP ${response.status}`)
    }

    const data = await response.json()
    const parsed = adapter.parseResponse(data)

    // Record token usage (unified mapping {input, output})
    if (parsed.usage) {
      recordUsage(parsed.usage.input, parsed.usage.output, 1)
    }
    return stripThinkBlocks(parsed.text ?? "")
  } finally {
    clearTimeout(timer)
  }
}

export class MemoryJudge {
  private buildL0FieldPrompt(): string {
    return Object.entries(L0_FIELD_DESCRIPTIONS)
      .map(([field, description]) => `  · ${field}：${description}`)
      .join('\n')
  }
  async judgeRecentTurns(
    turns: MemoryJudgeTurn[],
    conversationId: string,
  ): Promise<MemoryCandidate[]> {
    console.log(`[MemoryJudge] Analyzing recent ${turns.length} dialogue turns...`)

    try {
      const settings = loadModelSettings()
      if (!isModelEndpointUsable(settings)) {
        console.error("[MemoryJudge] Model call skipped: no usable model configuration")
        console.log("[MemoryJudge] No information worth recording in this turn")
        return []
      }

      const systemPrompt = [
        "You are a conservative memory candidate extractor, not a fact arbiter or user profile rewriter.",
        "Your goal is to minimize false memories, not to maximize retention.",
        "",
        "You must only extract candidates that the user explicitly expressed and are genuinely useful for the future.",
        "Never treat inference as established fact; never convert one-off states into long-term preferences; never output for the sake of outputting.",
        "If recent conversations contain nothing worth recording, you must return an empty array [].",
        "",
        "Memory layer definitions:",
        "- L0: Stable user identity or core profile. Only certainty=explicit and attribution=user_explicit may enter L0.",
        "  When identifying L0 information, you must specify which slot in the field property.",
        "  Available field values (strictly use these, do not invent others):",
        this.buildL0FieldPrompt(),
        "",
        "  Important: The value of field must strictly be the English field name listed above,",
        "  for example preferredName, occupation,",
        "  do not use nickname, name, job, etc.",
        "- L1: User recent goals or phase preferences. Only record recent states, not long-term preferences.",
        "- L2: Specific events, experiences, local preferences, emotional context, items under observation.",
        "",
        "Decision principles:",
        "- Better to omit than to record incorrectly.",
        "- Pure casual greetings, chit-chat, emotional venting (no information) -> return empty array [].",
        "- Must be information proactively expressed by the user, not spoken by the AI.",
        "- summary must stay faithful to user original words and context; do not broaden scope.",
        "- If it is only AI advice, consolation, summary, or inference, do not record as user fact.",
        "- Do not convert 'this time', 'just now', or 'in this topic' into long-term preferences.",
        "- Do not automatically use absolute expressions: only, always, never, definitely, completely, absolutely, forever, unless explicitly spoken by the user.",
        "- If summary contains potentially over-generalized terms, must write into forbiddenOverclaims; when forbiddenOverclaims is present, shouldWrite must be false.",
        "",
        "Formatting rules:",
        "- In summary and evidenceQuotes values, do not include raw unescaped double quotes.",
        "- Do not wrap JSON in markdown code blocks, output raw JSON directly.",
        "- The first character of the array must be [, last character must be ].",
        "",
        "Output format is a JSON array without markdown code blocks, direct raw JSON only.",
        "",
        "Each candidate must include these fields:",
        "{",
        "  \"layer\": \"L0\",",
        "  \"field\": \"preferredName\",",
        "  \"summary\": \"Conservative, traceable candidate summary\",",
        "  \"importance\": \"low|medium|high\",",
        "  \"stability\": \"one_off|situational|stable\",",
        "  \"certainty\": \"explicit|inferred|uncertain\",",
        "  \"attribution\": \"user_explicit|assistant_inferred|mixed\",",
        "  \"evidenceQuotes\": [\"User original short quotation, must come from user\"],",
        "  \"contextSummary\": \"Recent multi-turn context summary, within 80 words\",",
        "  \"shouldWrite\": true,",
        "  \"reason\": \"Why it is worth recording, or why not to write\",",
        "  \"forbiddenOverclaims\": []",
        "}",
        "",
        "L1/L2 do not require field.",
        "inferred / uncertain are not permitted in L0; if worth keeping, place in L2, or set shouldWrite=false.",
        "When nothing is worth recording, output: []",
      ].join("\n")

      const transcript = turns.map((turn, index) => [
        `Turn ${index + 1}:`,
        `User: ${turn.userInput}`,
        `AI: ${turn.assistantReply}`,
      ].join("\n")).join("\n\n")

      const userPrompt = [
        `conversationId: ${conversationId}`,
        "Recent conversations:",
        transcript,
      ].join("\n")

      const raw = await callChatCompletions(
        settings,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        30000,
        "MemoryJudge",
      )

      const parsed = extractJsonArray(raw)
      if (!parsed) {
        console.error("[MemoryJudge] JSON parse failed, raw content:\n", raw.slice(0, 200))
        console.log("[MemoryJudge] No information worth recording in this turn")
        return []
      }

      const candidates = parsed
        .map(normalizeCandidate)
        .filter((item): item is MemoryCandidate => item !== null)
        .filter((item) => item.shouldWrite === true)
        .filter((item) => item.layer !== "L0" || (item.certainty === "explicit" && item.attribution === "user_explicit"))

      if (candidates.length === 0) {
        console.log("[MemoryJudge] No information worth recording in this turn")
        return []
      }

      console.log(`[MemoryJudge] Extracted candidates: ${candidates.length} items (after filtering)`)
      console.log(
        `[MemoryJudge] Candidate details: ${candidates.map((item) => item.layer === "L0" && item.field ? `${item.layer}.${item.field}(\"${item.content.slice(0, 20)}\", ${item.confidence.toFixed(2)})` : `${item.layer}(\"${item.content.slice(0, 20)}\", ${item.confidence.toFixed(2)})`).join(" ")}`,
      )
      return candidates
    } catch (error) {
      console.error("[MemoryJudge] LLM call failed:", error)
      console.log("[MemoryJudge] No information worth recording in this turn")
      return []
    }
  }

  async judge(
    userMessage: string,
    assistantMessage: string,
    conversationId: string,
  ): Promise<MemoryCandidate[]> {
    return this.judgeRecentTurns([{ userInput: userMessage, assistantReply: assistantMessage }], conversationId)
  }
}

export const memoryJudge = new MemoryJudge()

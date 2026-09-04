import {
  isModelEndpointUsable,
  modelAuthorizationHeaders,
  type ModelEndpointConfig,
} from "../../shared/model-endpoint";
import { buildVendorUrlByProvider } from "../orchestrator/vendors";

export interface SpeechTranslationOptions {
  timeoutMs?: number;
}

/**
 * Fast, isolated translation helper used strictly to produce ephemeral
 * Mandarin speech payloads from English assistant responses.
 *
 * Contract:
 * - Output is strictly in-memory and MUST NOT be written to chat logs, UI bubbles, or RAG.
 * - If the endpoint is unconfigured or fails, returns the original text safely.
 */
export async function translateEnglishToMandarinSpeech(
  text: string,
  config: ModelEndpointConfig | null | undefined,
  options: SpeechTranslationOptions = {},
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (!config || !isModelEndpointUsable(config)) {
    return trimmed;
  }

  const timeoutMs = options.timeoutMs ?? 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt =
    "You are an internal voice synthesis translation bridge. " +
    "Translate the English text into natural, spoken Mandarin Chinese suitable for voice acting. " +
    "Output ONLY the translated Chinese text with no explanations, notes, or English words.";

  try {
    const url = buildVendorUrlByProvider(config.provider ?? "", config.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...modelAuthorizationHeaders(config),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmed },
        ],
        temperature: 0.2,
        max_tokens: 1000,
        stream: false,
      }),
    });

    if (!response.ok) {
      console.warn(`[SpeechTranslation] Request failed with HTTP ${response.status}`);
      return trimmed;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const translated = data.choices?.[0]?.message?.content?.trim();
    return translated || trimmed;
  } catch (error) {
    console.warn(
      "[SpeechTranslation] Translation failed; falling back to original text:",
      error instanceof Error ? error.message : String(error),
    );
    return trimmed;
  } finally {
    clearTimeout(timer);
  }
}

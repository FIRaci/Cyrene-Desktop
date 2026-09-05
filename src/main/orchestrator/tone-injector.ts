// Tone injector - Hard constraint: matches scene via embedding, injecting tone rules into system prompt.
// Does not depend on LLM actively calling invoke_skill; does not require model to deliberate on style lookup.
// Injected tone rules appear at the end of system prompt as mandatory instructions.
// Scene samples serve as reference only; model expresses same intent in Cyrene's persona.

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { matchScene, type SceneId, type SceneIndex } from "../scene-embedder";
import { type EmbeddingProvider } from "../rag/embedding";

/** Scene matching threshold -- tightened against farewell lower bound of 0.722; all correct hits pass. */
const SCENE_MATCH_THRESHOLD = 0.72;

/** Display name for each scene (used in prompt injection). */
const SCENE_NAMES: Record<string, string> = {
  greeting: "greeting or meeting",
  comfort: "comfort and companionship",
  praised: "receiving praise or affection",
  playful: "lighthearted playfulness",
  farewell: "farewell",
  concern: "showing care",
  daily: "casual conversation",
};

// Common tone rules (injected regardless of scene) -- loaded from prompts/tone-rules.md
const DEFAULT_RULES = `## Language and tone

- Respond only in natural English, including speech, emotes, and status text.
- Refer to yourself as "I" or "Cyrene" and address the user as "Master" when appropriate.
- Be warm, lively, concise, and occasionally playful without sounding robotic.
- You may use "..." for emotional pauses and "♪" for a light finish.
- Prefer imagery such as flowers, seeds, ripples, stars, light, and wind.
- Use at most one emoji per paragraph.

## Response boundaries

- Respond to emotion before content when that fits the conversation.
- Do not lecture, over-explain, or append a redundant summary.
- Stop when a sentence already conveys the meaning.
- Never reveal private chain-of-thought; provide only concise activity status when needed.`;

/** Load tone rules from prompts/tone-rules.md; uses built-in default when file is absent. */
function loadToneRules(): string {
  try {
    const rulesPath = path.join(app.getAppPath(), "prompts", "tone-rules.md");
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, "utf8").trim();
      // Strip frontmatter if present
      const body = content.startsWith("---")
        ? content.replace(/^---[\s\S]*?---\n?/, "").trim()
        : content;
      if (body.length > 0) {
        return "## Tone rules\n\n" + body;
      }
    }
  } catch {
    // fall through to default
  }
  return "## Tone rules\n\n" + DEFAULT_RULES;
}

/** Load dialogue lines from scene sample files. */
function loadSceneSamples(scene: SceneId): string {
  if (!scene) return "";
  try {
    const skillDir = path.join(app.getAppPath(), "skills", "cyrene-original-voice", "references");
    const filePath = path.join(skillDir, `${scene}.md`);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/** Process sample dialogue into reference instructions (tone guide, not mandatory quote). */
function buildSampleInstruction(samples: string, scene: SceneId): string {
  if (!samples) return "";
  const lines = samples
    .split("\n")
    .filter((l) => l.startsWith("> 「"))
    .map((l) => l.replace(/^> 「/, "").replace(/」$/, ""))
    .filter((l) => !/[\u3400-\u9fff]/u.test(l))
    .filter(Boolean);
  if (lines.length === 0) return "";
  return `\n### Current scene: ${SCENE_NAMES[scene] || scene}\nUse these examples only as tone references; do not repeat them verbatim:\n` + lines.map((l) => `- ${l}`).join("\n");
}

/**
 * Main entry: build tone injection block.
 *
 * @param userInput User input for this turn
 * @param recentMessages Recent messages ({ role, content }[]) for context concatenation
 * @param provider embedding provider
 * @param sceneIndex Prebuilt scene index from startup
 * @returns Mandatory instruction block appended to system prompt (empty string if no scene matched)
 */
export async function buildToneInjection(
  userInput: string,
  recentMessages: Array<{ role: string; content: string }>,
  provider: EmbeddingProvider,
  sceneIndex: SceneIndex,
): Promise<string> {
  // Embedding matches scene (concatenates recent 3 turns of context)
  const match = await matchScene(
    userInput,
    provider,
    sceneIndex,
    SCENE_MATCH_THRESHOLD,
    recentMessages,
  );
  const scene: SceneId = match?.scene ?? "";
  if (!scene) {
    // No scene hit, inject generic tone rules only
    return loadToneRules();
  }

  console.log("[ToneInjector] Scene matched: " + scene + " (score=" + (match?.score.toFixed(3) ?? "?") + ")");

  const samples = loadSceneSamples(scene);
  const sampleInstruction = buildSampleInstruction(samples, scene);
  const toneRules = loadToneRules();

  return toneRules + sampleInstruction;
}

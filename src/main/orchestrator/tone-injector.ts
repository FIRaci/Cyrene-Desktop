// 语气注入器 —— 硬约束：embedding 匹配场景，强制注入语气规则到 system prompt。
// 不依赖 LLM 主动调用 invoke_skill，不需要模型判断是否需要查风格。
// 注入的语气规则以「必须遵守」的指令形式出现在 system prompt 末尾。
// 场景样本仅作参考，模型按昔涟的语气表达相同意思。

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { matchScene, type SceneId, type SceneIndex } from "../scene-embedder";
import { type EmbeddingProvider } from "../rag/embedding";

/** 场景匹配阈值——贴着 farewell 最低分 0.722 收紧，所有正确命中都能过。 */
const SCENE_MATCH_THRESHOLD = 0.72;

/** 每个场景的展示名（注入 prompt 时用）。 */
const SCENE_NAMES: Record<string, string> = {
  greeting: "greeting or meeting",
  comfort: "comfort and companionship",
  praised: "receiving praise or affection",
  playful: "lighthearted playfulness",
  farewell: "farewell",
  concern: "showing care",
  daily: "casual conversation",
};

// 通用语气规则（无论哪个场景都注入）—— 从 prompts/tone-rules.md 读取
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

/** 从 prompts/tone-rules.md 加载语气规则，文件不存在时用内置默认值。 */
function loadToneRules(): string {
  try {
    const rulesPath = path.join(app.getAppPath(), "prompts", "tone-rules.md");
    if (fs.existsSync(rulesPath)) {
      const content = fs.readFileSync(rulesPath, "utf8").trim();
      // 去掉 frontmatter（如果有）
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

/** 加载场景样本文件中的台词。 */
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

/** 把样本台词加工成参考指令（非强制引用，而是参照语气）。 */
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
 * 主入口：构建语气注入段。
 *
 * @param userInput 用户本轮输入
 * @param recentMessages 最近几轮消息（{ role, content }[]），用于拼上下文（方案 A）
 * @param provider embedding provider
 * @param sceneIndex 启动时建好的场景索引
 * @returns 注入 system prompt 末尾的不可选指令段（空串表示无匹配场景）
 */
export async function buildToneInjection(
  userInput: string,
  recentMessages: Array<{ role: string; content: string }>,
  provider: EmbeddingProvider,
  sceneIndex: SceneIndex,
): Promise<string> {
  // embedding 匹配场景（拼最近 3 轮上下文）
  const match = await matchScene(
    userInput,
    provider,
    sceneIndex,
    SCENE_MATCH_THRESHOLD,
    recentMessages,
  );
  const scene: SceneId = match?.scene ?? "";
  if (!scene) {
    // 没命中任何场景，只注入通用语气规则
    return loadToneRules();
  }

  console.log("[ToneInjector] Scene matched: " + scene + " (score=" + (match?.score.toFixed(3) ?? "?") + ")");

  const samples = loadSceneSamples(scene);
  const sampleInstruction = buildSampleInstruction(samples, scene);
  const toneRules = loadToneRules();

  return toneRules + sampleInstruction;
}

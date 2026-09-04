// Skill 清单生成 —— 把 enabled skill 拼成注入 system prompt 的清单段。
// 纯函数，不碰 electron/registry。

import type { SkillEntry } from "./types";

/**
 * 歧义识别策略。
 * 不"制造"歧义，而是"识别"用户需求中天然存在的多解读空间。
 * 用户说了模糊风格词（美观/好看/专业）但没给具体要求 → 弹卡片让用户选。
 * 用户说了"你自己决定" → 不弹，直接用默认样式。
 * 用户给了明确细节 → 不弹，直接做。
 */
const AMBIGUITY_POLICY = [
  "",
  "## Ambiguity handling policy",
  "",
  "### When to show an ask_user_choice card",
  "When the user explicitly requests a vague visual quality such as beautiful, polished, professional, colorful, or tidy",
  "without concrete requirements, the request has multiple reasonable interpretations. Use ask_user_choice to select a direction before execution.",
  "",
  "Examples: 'make a beautiful spreadsheet', 'make it professional', or 'create a polished report' all require a style choice when no details are given.",
  "",
  "### When not to show a card",
  "- The user delegates the choice to you: use the default style without asking",
  "- The user mentions no visual style: proceed with the default",
  "- The user gives concrete details: follow them directly",
  "- The request concerns functionality rather than style: execute the functional requirement",
  "",
  "### Tool selection",
  "- Simple spreadsheets or data organization: use write_excel directly; do not invoke the xlsx Skill",
  "- Simple documents, reports, or summaries: use write_word directly; do not invoke the docx Skill",
  "- After a style choice, pass it through the corresponding write_* style argument; do not hand-author XML",
  "- write_excel themes: default / dark / colorful / simple-business / financial",
  "- write_word themes: default / academic / clean / elegant / formal",
  "- For custom colors, pass ARGB hex values through write_excel colors and translate color names to hex",
  "- Consider invoke_skill only for explicit advanced needs such as formulas, financial-format standards, conditional formatting, editing an existing xlsx, headers, footers, tables of contents, or images",
].join("\n");

/**
 * 生成注入 system prompt 的 skill 清单段（拼在人格层之后）。
 * 只含 enabled skill。返回空串表示无可用 skill（调用方据此跳过拼接）。
 */
export function buildSkillCatalog(skills: SkillEntry[]): string {
  const enabled = skills.filter(s => s.enabled);
  if (enabled.length === 0) return "";
  const lines = enabled.map(s => {
    const toolsTag = s.tools && s.tools.length > 0 ? ` [tools: ${s.tools.join(", ")}]` : "";
    const activationTag = s.manifest?.autoInject === true
      ? " [auto-injected; do not call invoke_skill again]"
      : "";
    return `- ${s.id}: ${s.description}${toolsTag}${activationTag}`;
  });
  return [
    "## Available Skills",
    "When a non-auto-injected Skill applies, call invoke_skill(skill_id) for its instructions. Auto-injected Skills already provide their complete rules below.",
    "",
    ...lines,
  ].join("\n") + AMBIGUITY_POLICY;
}

/**
 * 为显式声明 autoInject 的复合 Skill 注入完整规则。
 * 能力可用性已由 SkillRegistry.getEnabled() 过滤；读取失败时安全跳过。
 */
export function buildAutoInjectedSkillContext(
  skills: SkillEntry[],
  getBody: (id: string) => string | null,
): string {
  const blocks = skills
    .filter((skill) => skill.enabled && skill.manifest?.autoInject === true)
    .map((skill) => {
      const body = getBody(skill.id)?.trim();
      return body ? `### ${skill.id}\n${body}` : "";
    })
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return [
    "## Auto-injected Skill instructions",
    "The following Skills passed capability gating. Follow their complete rules directly without calling invoke_skill again.",
    "",
    ...blocks,
  ].join("\n");
}

/**
 * Soul 阶段没有工具能力，只注入 Skill 明确声明的回复策略小节。
 * 其余工具流程仍只属于 TOOL_PHASE，避免模型把工具协议输出成聊天文本。
 */
export function buildAutoInjectedSoulContext(
  skills: SkillEntry[],
  getBody: (id: string) => string | null,
): string {
  const blocks = skills
    .filter((skill) => skill.enabled && skill.manifest?.autoInject === true)
    .map((skill) => {
      const body = getBody(skill.id) ?? "";
      const match = body.match(/^## (?:Soul response strategy|Soul 回复策略)\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
      const section = match?.[1]?.trim();
      return section ? `### ${skill.id}\n${section}` : "";
    })
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return [
    "## Auto-injected Skill response strategies",
    "The following content constrains natural-language responses only. This phase has no tool capability; never output tool names, call markers, or tool protocol text.",
    "",
    ...blocks,
  ].join("\n");
}

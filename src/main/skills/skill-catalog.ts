// Skill catalog generation — compiles enabled skills into catalog section for system prompt injection.
// Pure function, does not touch electron/registry.

import type { SkillEntry } from "./types";

/**
 * Ambiguity resolution strategy.
 * Do not "fabricate" ambiguity, but "recognize" inherent open interpretations in user requests.
 * User provided vague style words (pretty/professional) without specific requirements -> show card for selection.
 * User said "you decide" -> do not show card, use default styling.
 * User provided explicit details -> do not show card, execute directly.
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
 * Generates skill catalog section for system prompt injection (appended after persona layer).
 * Only includes enabled skills. Returns empty string if no skills available (caller skips concatenation).
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
 * Injects full rules for composite Skills explicitly declaring autoInject.
 * Capability availability is pre-filtered by SkillRegistry.getEnabled(); safely skipped on read failure.
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
 * Soul phase has no tool capabilities, only injecting reply strategy sections explicitly declared by the Skill.
 * Remaining tool flows stay strictly in TOOL_PHASE, preventing the model from leaking tool protocols into chat.
 */
export function buildAutoInjectedSoulContext(
  skills: SkillEntry[],
  getBody: (id: string) => string | null,
): string {
  const blocks = skills
    .filter((skill) => skill.enabled && skill.manifest?.autoInject === true)
    .map((skill) => {
      const body = getBody(skill.id) ?? "";
      const match = body.match(/^## Soul response strategy\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
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

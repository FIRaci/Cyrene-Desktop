// Skill meta-tool —— 把 skill 系统暴露给 LLM 的两个工具。
// 不把每个 skill 注册成业务 tool（skill 是指令层），而是用两个 meta-tool：
//   invoke_skill：加载某 skill 的 SKILL.md 正文 + references 清单
//   read_skill_reference：按需读 references 附件（带路径穿越防护）
// 注册进现有 toolRegistry，两处 LLM 路径都从 registry 取，自动生效。

import { toolRegistry } from "../orchestrator/tool-registry";
import { skillRegistry } from "./skill-registry";

const LOG_PREFIX = "[SkillTools]";

// skill 正文 / reference 返回时的字符上限。CyreneAgent 的 FC 循环把 tool 返回值
// 永久留在 conversation 里，超大正文（xlsx 8.5KB、skill-creator 33KB、docx 的
// openxml_encyclopedia 单个 144KB）会顶过推理模型单轮 30s 预算导致连续超时。
// 官方 skill 系统靠宿主 agent（Claude Code 等）的上下文压缩兜底，我们没那层，得自己截断。
const SKILL_BODY_MAX_CHARS = 6000;
const SKILL_REF_MAX_CHARS = 8000;

/** 截断文本到 maxChars，超长时末尾附提示。保留前部（任务路由表/关键规则通常在前）。 */
function truncateForContext(text: string, maxChars: number, hint: string): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) +
    "\n\n[...content truncated; showing the first " + maxChars + " characters. " + hint + "...]";
}

/**
 * 每轮对话的 reference 已读记录（skill_id + ref → true）。
 * FC 循环开始时调 resetReadRefs() 清空。防止模型在同一轮任务里重复读同一文件。
 */
const readRefs = new Set<string>();

/** 每轮 FC 循环开始前调，清空已读记录。由 cyrene-agent.ts 在循环入口调。 */
export function resetReadRefs(): void {
  readRefs.clear();
}

/**
 * 执行纪律提示，拼在 invoke_skill 返回内容末尾。
 * 约束模型"够用即执行、不重复读、不探索式遍历"，避免浪费轮数。
 */
const EXECUTION_DISCIPLINE =
  "\n\n---\n" +
  "[EXECUTION DISCIPLINE — REQUIRED]\n" +
  "1. Read only the minimum references needed, then begin execution.\n" +
  "2. Do not read the same reference twice.\n" +
  "3. Do not explore templates/scripts with list_dir; use the supplied paths.\n" +
  "4. Once information is sufficient, execute instead of continuing research.\n" +
  "5. When turns are limited, prioritize a deliverable over formatting refinements.";

/**
 * 注册 skill 系统的两个 meta-tool 进 toolRegistry。
 * 标 risk:"safe"（只读本地 skill 文件），免权限打扰。
 * initSkills 启动时调一次。
 */
export function registerSkillTools(): void {
  toolRegistry.register({
    id: "invoke_skill",
    name: "Invoke Skill",
    description:
      "Loads detailed instructions for a Skill that applies to the current task. Follow those instructions with the other tools.\n\n" +
      "Use only for a Skill ID in the Available Skills catalog.\n\n" +
      "Argument: skill_id (required). Returns instructions and the available reference-file list.",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "Skill ID from the Available Skills catalog" },
      },
      required: ["skill_id"],
    },
    execute: async (args) => {
      const id = String(args.skill_id || "");
      const skill = skillRegistry.getById(id);
      if (!skill || !skill.enabled || !skillRegistry.isAvailable(id)) {
        const available = skillRegistry.getEnabled().map(s => s.id).join(", ") || "(none)";
        return `[invoke_skill] Skill not found: ${id}. Available Skills: ${available}`;
      }
      const body = skillRegistry.getBody(id);
      if (body === null) {
        return `[invoke_skill] Failed to read Skill instructions: ${id}`;
      }
      const refList = skill.references.length > 0
        ? `\n\nAvailable references (use read_skill_reference when details are needed):\n${skill.references.map(r => "- " + r).join("\n")}`
        : "";
      console.log(LOG_PREFIX, "invoke_skill:", id, "bodyLen=" + body.length);
      const truncatedBody = truncateForContext(
        body,
        SKILL_BODY_MAX_CHARS,
        "Use read_skill_reference for the exact file needed for complete instructions or a specific section",
      );
      return `[Loaded Skill: ${id}]\n${truncatedBody}${refList}${EXECUTION_DISCIPLINE}`;
    },
  });

  toolRegistry.register({
    id: "read_skill_reference",
    name: "Read Skill reference",
    description:
      "Reads a Skill reference when invoke_skill cites references/xxx and its details are needed. Use only a reference listed by invoke_skill. Arguments: skill_id and ref (both required).",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "Skill ID" },
        ref:      { type: "string", description: "Reference filename listed by invoke_skill" },
      },
      required: ["skill_id", "ref"],
    },
    execute: async (args) => {
      const id = String(args.skill_id || "");
      const ref = String(args.ref || "");
      const skill = skillRegistry.getById(id);
      if (!skill || !skill.enabled || !skillRegistry.isAvailable(id)) {
        return `[read_skill_reference] skill not found: ${id}`;
      }
      // 去重：同一轮内同一 reference 不重复返回（内容已在对话历史里，再读浪费轮数+token）
      const readKey = `${id}/${ref}`;
      if (readRefs.has(readKey)) {
        return `[read_skill_reference] "${ref}" was already read this turn. Do not read it again. ` +
          `Other available files: ${skill.references.filter(r => !readRefs.has(`${id}/${r}`)).join(", ") || "(all read)"}`;
      }
      const content = skillRegistry.getReference(id, ref);
      if (content === null) {
        return `[read_skill_reference] Read failed; reference unlisted or missing: ${ref}. Available: ${skill.references.join(", ") || "(none)"}`;
      }
      readRefs.add(readKey);
      console.log(LOG_PREFIX, "read_skill_reference:", id, ref, "len=" + content.length);
      const truncated = truncateForContext(
        content,
        SKILL_REF_MAX_CHARS,
        "Read in sections or specify the exact section needed to retrieve later content",
      );
      return truncated;
    },
  });

  console.log(LOG_PREFIX, "Registered: invoke_skill / read_skill_reference");
}

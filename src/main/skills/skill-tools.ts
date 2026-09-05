// Skill meta-tool — two tools exposing the skill system to the LLM.
// Rather than registering each skill as an individual tool (skills are instruction layers), two meta-tools are used:
//   invoke_skill: loads SKILL.md body + references list for a skill
//   read_skill_reference: reads references attachment on-demand (with path traversal defense)
// Registered into existing toolRegistry, active across all LLM execution paths.

import { toolRegistry } from "../orchestrator/tool-registry";
import { skillRegistry } from "./skill-registry";

const LOG_PREFIX = "[SkillTools]";

// Character limits on skill body / reference return values. CyreneAgent FC loops retain tool
// return values in conversation permanently; giant bodies (xlsx 8.5KB, skill-creator 33KB, docx
// openxml_encyclopedia 144KB) exceed reasoning model 30s timeout budgets.
// Standard skill systems rely on host agent context compression; we truncate directly here.
const SKILL_BODY_MAX_CHARS = 6000;
const SKILL_REF_MAX_CHARS = 8000;

/** Truncates text to maxChars, appending notice on overflow. Retains start (task routing / key rules are usually at front). */
function truncateForContext(text: string, maxChars: number, hint: string): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) +
    "\n\n[...content truncated; showing the first " + maxChars + " characters. " + hint + "...]";
}

/**
 * Per-dialogue reference read log (skill_id + ref -> true).
 * Reset via resetReadRefs() when starting an FC loop, preventing redundant reads in the same round.
 */
const readRefs = new Set<string>();

/** Called before each FC loop begins to clear read records. Invoked by cyrene-agent.ts at loop entry. */
export function resetReadRefs(): void {
  readRefs.clear();
}

/**
 * Execution discipline prompt, appended to invoke_skill output.
 * Constrains model to execute once sufficient, avoid duplicate reads or exploratory sweeps, saving turn budget.
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
 * Registers the two skill system meta-tools into toolRegistry.
 * Marked risk: "safe" (read-only on local skill files) to avoid permission prompts.
 * Invoked once during initSkills startup.
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
      // Deduplication: do not return same reference repeatedly within a round (already in dialogue history)
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

// Skill /command parsing — pure function, does not depend on registry.
// Caller passes known skill id list, matching only listed commands; unknown /commands pass through.

/** parseSlashCommand result. hit=true indicates matching a known skill /command. */
export interface SlashParseResult {
  hit: boolean;
  skillId?: string;
}

/**
 * Parses whether user input is a /skill-id command (and skill is in known list).
 * Pure function. id must be kebab-case (lowercase letters/numbers/hyphens).
 * Syntax mismatch or absent from knownSkillIds -> hit: false (passes through, preserving /help etc.).
 * Skill existence/enabled state is determined by caller checking skillRegistry.
 */
export function parseSlashCommand(text: string, knownSkillIds: string[]): SlashParseResult {
  const m = text.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/);
  if (!m) return { hit: false };
  const id = m[1];
  if (!knownSkillIds.includes(id)) return { hit: false };
  return { hit: true, skillId: id };
}

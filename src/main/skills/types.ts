// Skill system — type definitions.
// id always = directory name (kebab-case), unique external identifier; name is display-only, does not participate in matching.

/** Complete in-memory representation of a skill. */
export interface SkillEntry {
  id: string;            // = directory name, kebab-case, unique external identifier
  name: string;          // frontmatter.name, display-only, does not participate in matching
  description: string;   // Used for prompt injection catalog
  tools?: string[];      // Associated tool ids
  version?: string;      // Semantic version, display-only
  dirPath: string;       // Skill directory absolute path
  bodyPath: string;      // SKILL.md absolute path
  references: string[];  // Filename list under references/ (excluding content)
  enabled: boolean;      // Runtime state, persisted to settings.json
  source: "builtin" | "user";  // Source origin
  manifest?: SkillManifest;
}

export interface SkillManifest {
  id: string;
  version: string;
  defaultEnabled: boolean;
  entry: string;
  dependencies: string[];
  autoInject?: boolean;
  autoPlayPolicy?: string;
  /** Default execution mode when Task Router fast-path hits */
  defaultExecutionMode?: "direct" | "plan";
}

/** frontmatter parse result. */
export interface ParsedSkill {
  name: string;
  description: string;
  tools?: string[];
  version?: string;
  body: string;  // SKILL.md body (after frontmatter)
}

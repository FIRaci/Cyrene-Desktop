import path from "path";
import fs from "fs";
import { describe, it, expect } from "vitest";
import { scanSkills } from "./skill-scanner";
import { SkillRegistry, skillRegistry } from "./skill-registry";
import { toolRegistry } from "../orchestrator/tool-registry";
import { registerSkillTools } from "./skill-tools";

describe("All Project Skills Comprehensive Test Suite", () => {
  const skillsDir = path.resolve(process.cwd(), "skills");

  it("finds the skills root directory and confirms all 9 shipped skills exist", () => {
    expect(fs.existsSync(skillsDir)).toBe(true);
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const expectedSkills = [
      "cyrene-music-companion",
      "cyrene-original-voice",
      "docx",
      "pdf",
      "pptx-generator",
      "self-improving-agent",
      "skill-creator",
      "write-expense-report",
      "xlsx",
    ];

    for (const expected of expectedSkills) {
      expect(entries).toContain(expected);
    }
  });

  it("scans and parses all 9 skills without crashing or returning empty lists", () => {
    const skills = scanSkills(skillsDir, "builtin");
    expect(skills.length).toBe(9);

    for (const skill of skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(typeof skill.description).toBe("string");
      expect(skill.description.length).toBeGreaterThan(10);
      expect(skill.enabled).toBe(true);
      expect(skill.source).toBe("builtin");
    }
  });

  it("registers all 9 skills into SkillRegistry and retrieves their bodies", () => {
    const registry = new SkillRegistry();
    const skills = scanSkills(skillsDir, "builtin");
    for (const s of skills) {
      registry.register(s);
    }

    expect(registry.getAll().length).toBe(9);
    expect(registry.getEnabled().length).toBe(9);

    for (const s of skills) {
      const body = registry.getBody(s.id);
      expect(body, `Body for skill ${s.id} should not be null`).not.toBeNull();
      expect(body!.length).toBeGreaterThan(20);
    }
  });

  it("verifies invoke_skill loads instructions for every single skill", async () => {
    const skills = scanSkills(skillsDir, "builtin");
    for (const s of skills) {
      skillRegistry.register(s);
    }

    // Register skill tools
    registerSkillTools();

    const invokeTool = toolRegistry.getById("invoke_skill");
    expect(invokeTool).toBeDefined();

    for (const s of skills) {
      const result = await invokeTool!.execute({ skill_id: s.id });
      expect(typeof result).toBe("string");
      expect(result).toContain(`[Loaded Skill: ${s.id}]`);
      expect(result).toContain("[EXECUTION DISCIPLINE — REQUIRED]");
    }
  });

  it("verifies read_skill_reference works for skills that have references", async () => {
    const skills = scanSkills(skillsDir, "builtin");
    for (const s of skills) {
      skillRegistry.register(s);
    }

    const skillsWithRefs = skills.filter((s) => s.references.length > 0);
    expect(skillsWithRefs.length).toBeGreaterThan(0);

    const readRefTool = toolRegistry.getById("read_skill_reference");
    expect(readRefTool).toBeDefined();

    for (const s of skillsWithRefs) {
      for (const ref of s.references.slice(0, 3)) {
        const result = await readRefTool!.execute({ skill_id: s.id, ref });
        expect(typeof result).toBe("string");
        expect(result).not.toContain("[read_skill_reference] Reference file not found");
        expect(result.length).toBeGreaterThan(10);
      }
    }
  });

  it("verifies cyrene-original-voice has all standard scene reference templates", () => {
    const voiceSkillDir = path.join(skillsDir, "cyrene-original-voice", "references");
    expect(fs.existsSync(voiceSkillDir)).toBe(true);

    const requiredScenes = [
      "boundary.md",
      "comfort.md",
      "concern.md",
      "encourage.md",
      "farewell.md",
      "gratitude.md",
      "greeting.md",
      "playful.md",
      "praised.md",
    ];

    for (const scene of requiredScenes) {
      const scenePath = path.join(voiceSkillDir, scene);
      expect(fs.existsSync(scenePath), `Scene file ${scene} must exist`).toBe(true);
      const content = fs.readFileSync(scenePath, "utf8");
      expect(content.length).toBeGreaterThan(30);
    }
  });
});

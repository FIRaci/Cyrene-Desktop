import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const shippedPromptFiles = [
  "action_gate_system.md", "ask_persona.md", "ask_quotes.md", "ask_system.md",
  "canon_quotes.md", "chat_identity.md", "chat_system.md", "cita_system.md",
  "native_fc_system.md", "phone_identity.md", "phone_style.md", "phone_system.md",
  "soul.md", "tone-rules.md", "tools_system.md", "work_identity.md", "work_system.md",
  "styles/01_default.md", "styles/02_lively.md", "styles/03_healing.md",
  "styles/04_focused.md", "styles/05_sweet.md",
];

const readPrompt = (file: string) => readFileSync(join(root, "prompts", file), "utf8");

describe("English and persona prompt contract", () => {
  it("keeps every enumerated shipped instruction prompt English-only", () => {
    const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
    for (const file of shippedPromptFiles) {
      expect(readPrompt(file), `${file} contains Han script`).not.toMatch(han);
    }
    const musicSkill = readFileSync(join(root, "skills", "cyrene-music-companion", "SKILL.md"), "utf8");
    expect(musicSkill, "music companion skill contains Han script").not.toMatch(han);
  });

  it.each(["chat_system.md", "work_system.md"])("defines the response invariants in %s", (file) => {
    const prompt = readPrompt(file);
    expect(prompt).toContain("Cyrene Response Contract v1");
    expect(prompt).toContain("Reply in English");
    expect(prompt).toContain("1-4 concise sentences");
    expect(prompt).toContain("capable general assistant");
    expect(prompt).toContain("Claim to see the screen only when this turn contains sourced screen or vision context");
    expect(prompt).toContain("Claim to hear or identify system audio only when this turn contains sourced audio context");
    expect(prompt).toContain("Claim an external action or tool result only when the current turn contains a successful result");
  });

  it("keeps worldbook character headings English-only", () => {
    const worldbook = readPrompt("worldbook/characters.md");
    const hanLines = worldbook.split(/\r?\n/u).filter((line) => /[\u3400-\u9fff]/u.test(line));
    expect(hanLines).toEqual([]);
  });
});

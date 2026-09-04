import { describe, it, expect } from "vitest";
import { buildAutoInjectedSkillContext, buildAutoInjectedSoulContext, buildSkillCatalog } from "./skill-catalog";
import type { SkillEntry } from "./types";

function e(id: string, desc: string, tools?: string[], enabled = true): SkillEntry {
  return {
    id, name: id, description: desc, tools,
    dirPath: "/x", bodyPath: "/x", references: [],
    enabled, source: "builtin",
  };
}

describe("buildSkillCatalog", () => {
  it("returns empty string when skills list is empty", () => {
    expect(buildSkillCatalog([])).toBe("");
  });

  it("returns empty string when all skills are disabled", () => {
    expect(buildSkillCatalog([e("a", "x", undefined, false)])).toBe("");
  });

  it("includes heading, id: description and tools tag", () => {
    const out = buildSkillCatalog([e("write-expense-report", "Generate expense report", ["query_expense", "write_excel"])]);
    expect(out).toContain("Available Skills");
    expect(out).toContain("invoke_skill");
    expect(out).toContain("- write-expense-report: Generate expense report");
    expect(out).toContain("[tools: query_expense, write_excel]");
  });

  it("omits tools tag when tools field is undefined", () => {
    const out = buildSkillCatalog([e("plain", "Instruction only")]);
    expect(out).toContain("- plain: Instruction only");
    expect(out).not.toContain("[tools:");
  });

  it("omits tools tag when tools array is empty", () => {
    const out = buildSkillCatalog([e("a", "x", [])]);
    expect(out).toContain("- a: x");
    expect(out).not.toContain("[tools:");
  });

  it("excludes disabled skills from catalog", () => {
    const out = buildSkillCatalog([e("a", "x"), e("b", "y", undefined, false)]);
    expect(out).toContain("- a: x");
    expect(out).not.toContain("- b:");
  });

  it("distinguishes auto-injected skills from skills that require invoke_skill", () => {
    const music = e("cyrene-music-companion", "Music companion");
    music.manifest = {
      id: music.id,
      version: "1.0.0",
      defaultEnabled: true,
      entry: "index.ts",
      dependencies: [],
      autoInject: true,
    };

    const out = buildSkillCatalog([music]);

    expect(out).toContain("auto-injected");
    expect(out).toContain("do not call invoke_skill again");
  });
});

describe("buildAutoInjectedSkillContext", () => {
  it("injects the full body only for enabled autoInject skills", () => {
    const music = e("cyrene-music-companion", "Music companion");
    music.manifest = {
      id: music.id,
      version: "1.0.0",
      defaultEnabled: true,
      entry: "index.ts",
      dependencies: [],
      autoInject: true,
    };
    const ordinary = e("ordinary", "Ordinary skill");

    const out = buildAutoInjectedSkillContext([music, ordinary], (id) =>
      id === music.id ? "Use only real music tool results." : "Should not inject",
    );

    expect(out).toContain("cyrene-music-companion");
    expect(out).toContain("Use only real music tool results.");
    expect(out).not.toContain("Should not inject");
  });

  it("does not inject a disabled autoInject skill", () => {
    const music = e("cyrene-music-companion", "Music companion", undefined, false);
    music.manifest = {
      id: music.id,
      version: "1.0.0",
      defaultEnabled: true,
      entry: "index.ts",
      dependencies: [],
      autoInject: true,
    };

    expect(buildAutoInjectedSkillContext([music], () => "Body")).toBe("");
  });
});

describe("buildAutoInjectedSoulContext", () => {
  it("injects only the Soul reply section and excludes tool instructions", () => {
    const music = e("cyrene-music-companion", "Music companion");
    music.manifest = {
      id: music.id,
      version: "1.0.0",
      defaultEnabled: true,
      entry: "index.ts",
      dependencies: [],
      autoInject: true,
    };
    const body = [
      "# Music companion",
      "## Soul response strategy",
      "When user is bored, propose listening to music naturally.",
      "## Tool invocation policy",
      "Call music_get_daily_recommendations.",
    ].join("\n");

    const out = buildAutoInjectedSoulContext([music], () => body);

    expect(out).toContain("When user is bored, propose listening to music naturally.");
    expect(out).not.toContain("music_get_daily_recommendations");
  });

  it("reads a Soul reply section that ends at end-of-file", () => {
    const music = e("cyrene-music-companion", "Music companion");
    music.manifest = {
      id: music.id,
      version: "1.0.0",
      defaultEnabled: true,
      entry: "index.ts",
      dependencies: [],
      autoInject: true,
    };

    const out = buildAutoInjectedSoulContext(
      [music],
      () => "# Music companion\n## Soul response strategy\nWhen user is bored, propose listening to music.",
    );

    expect(out).toContain("When user is bored, propose listening to music.");
  });
});

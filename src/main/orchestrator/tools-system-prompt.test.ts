import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

describe("tools_system prompt truthfulness fallback", () => {
  it("requires real tool calls and the daily recommendation card chain", () => {
    const prompt = fs.readFileSync(path.join(process.cwd(), "prompts", "tools_system.md"), "utf8");

    expect(prompt).toContain("You cannot just reply");
    expect(prompt).toContain("Only when the corresponding tool appears in the currently available tools directory");
    expect(prompt).toContain("music_get_daily_recommendations");
    expect(prompt).toContain("music_present_tracks");
    expect(prompt).toContain("do not use memory to fill in the blanks");
  });

  it("does not request a duplicate card when daily recommendations already include presentation", () => {
    const prompt = fs.readFileSync(path.join(process.cwd(), "prompts", "tools_system.md"), "utf8");
    const skill = fs.readFileSync(
      path.join(process.cwd(), "skills", "cyrene-music-companion", "SKILL.md"),
      "utf8",
    );

    expect(prompt).toContain("`presentation.presented` is true");
    expect(skill).toContain("`presentation.presented` is true");
    expect(skill).toContain("do not call `music_present_tracks` again");
  });
});

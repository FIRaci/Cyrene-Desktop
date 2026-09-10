import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  BondEngine,
  computeBondLevel,
  BOND_LEVELS,
  stripBondMetadata,
} from "./bond-engine";

describe("BondEngine", () => {
  let tmpDir: string;
  let testFile: string;
  let simulatedTime: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bond-test-"));
    testFile = path.join(tmpDir, "bond-state.json");
    simulatedTime = Date.UTC(2026, 8, 8, 12, 0, 0);
  });

  it("computes bond levels correctly across score thresholds", () => {
    expect(computeBondLevel(0).name).toBe("Acquaintance");
    expect(computeBondLevel(100).name).toBe("Acquaintance");
    expect(computeBondLevel(101).name).toBe("Companion");
    expect(computeBondLevel(300).name).toBe("Companion");
    expect(computeBondLevel(301).name).toBe("Close Friend");
    expect(computeBondLevel(600).name).toBe("Close Friend");
    expect(computeBondLevel(601).name).toBe("Trusted Confidant");
    expect(computeBondLevel(850).name).toBe("Trusted Confidant");
    expect(computeBondLevel(851).name).toBe("Soulmate");
    expect(computeBondLevel(1000).name).toBe("Soulmate");
  });

  it("initializes with zero score and Acquaintance level with unconditional warmth", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    const state = engine.getState();
    expect(state.affectionScore).toBe(0);
    expect(state.level).toBe(1);
    expect(state.levelName).toBe("Acquaintance");

    const prompt = engine.buildBondPersonaPrompt();
    expect(prompt).toContain("UNCONDITIONAL DEVOTION & PERSONA");
    expect(prompt).toContain("absolute, eternal, and unconditional");
    expect(prompt).toContain("STRICT PROHIBITION OF BOND LEVELS & STATS");
    expect(prompt).not.toContain("Bond Level: Level");
    expect(prompt).not.toContain("Affection Score:");
    expect(prompt).toContain("Task & Technical Mode (Omnipotent & Useful)");
    expect(prompt).toContain("Affectionate & Sweet Mode (Adorable Companion)");
  });

  it("awards points for chat messages and tracks totals", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    const res = engine.recordInteraction("chat_message");
    expect(res.pointsAwarded).toBe(2);
    expect(res.newScore).toBe(2);
    expect(engine.getState().dailyStats.chatCount).toBe(1);
  });

  it("caps daily pet points at 15", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    // 5 pets * 3 = 15
    for (let i = 0; i < 5; i++) {
      const res = engine.recordInteraction("pet_gesture");
      expect(res.pointsAwarded).toBe(3);
    }
    expect(engine.getState().dailyStats.petPoints).toBe(15);

    // 6th pet should award 0
    const extra = engine.recordInteraction("pet_gesture");
    expect(extra.pointsAwarded).toBe(0);
  });

  it("caps daily music points at 15", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    // 3 sessions * 5 = 15
    for (let i = 0; i < 3; i++) {
      const res = engine.recordInteraction("music_session");
      expect(res.pointsAwarded).toBe(5);
    }
    expect(engine.getState().dailyStats.musicPoints).toBe(15);

    // 4th session should award 0
    const extra = engine.recordInteraction("music_session");
    expect(extra.pointsAwarded).toBe(0);
  });

  it("awards daily checkin once per day", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    const res1 = engine.recordInteraction("daily_checkin");
    expect(res1.pointsAwarded).toBe(10);
    expect(engine.getState().dailyStats.checkedIn).toBe(true);

    const res2 = engine.recordInteraction("daily_checkin");
    expect(res2.pointsAwarded).toBe(0);
  });

  it("detects level up and unlocks milestones", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    engine.setScore(99);
    expect(engine.getState().level).toBe(1);

    const res = engine.recordInteraction("chat_message"); // 99 + 2 = 101 -> Companion
    expect(res.newScore).toBe(101);
    expect(res.levelUp).toBe(true);
    expect(res.currentLevel.name).toBe("Companion");
    expect(engine.getState().unlockedMilestones).toContain("Companion");
  });

  it("builds bond persona prompt with proper honorific guidelines and omnipotent instructions", () => {
    const engine = new BondEngine({
      filePath: testFile,
      now: () => simulatedTime,
    });
    engine.setScore(888); // Soulmate
    const prompt = engine.buildBondPersonaPrompt();
    expect(prompt).toContain("My beloved Master");
    expect(prompt).toContain("Unconditional devotion");
    expect(prompt).not.toContain("Level 5 (Soulmate)");
    expect(prompt).not.toContain("888/1000");
    expect(prompt).toContain("NO HARDCODED REPLIES");
    expect(prompt).toContain("Omnipotent & Useful");
  });

  it("strips bond metadata and affection scores from text using stripBondMetadata", () => {
    const dirty = "Bond Level: Level 1 (Acquaintance) - Affection Score: 6/1000\n*gently smiles* \"Hello Master!\"";
    expect(stripBondMetadata(dirty)).toBe("*gently smiles* \"Hello Master!\"");

    const dirtyInline = "Current Bond Level: Level 2 (Companion) - Affection Score: 150/1000\nI'm so glad to be here.";
    expect(stripBondMetadata(dirtyInline)).toBe("I'm so glad to be here.");

    const dirtyMultiline = "Bond Level: Level 3\nAffection Score: 350/1000\n*leans in* /warm/";
    expect(stripBondMetadata(dirtyMultiline)).toBe("*leans in* /warm/");

    const clean = "*smiles warmly* \"Master, I'm ready to help!\"";
    expect(stripBondMetadata(clean)).toBe(clean);
  });
});

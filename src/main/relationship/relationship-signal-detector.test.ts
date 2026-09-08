import { describe, it, expect } from "vitest";
import {
  compactText,
  detectUserMood,
  deriveSignal,
  summarizeDate,
} from "./relationship-signal-detector";
import { RelationshipLogEntry } from "./relationship-log-types";

describe("relationship-signal-detector", () => {
  it("compacts text properly", () => {
    expect(compactText("   hello    world   ")).toBe("hello world");
    const long = "a".repeat(150);
    expect(compactText(long, 50).length).toBe(53); // 50 + "..."
  });

  it("detects user moods accurately", () => {
    expect(detectUserMood("I feel so tired and exhausted")).toBe("tired");
    expect(detectUserMood("Please stop, no cards or annoying popups")).toBe(
      "clear boundary"
    );
    expect(detectUserMood("I am so stressed and panicking")).toBe("anxious");
    expect(detectUserMood("I am feeling down and crying")).toBe("down");
    expect(detectUserMood("I am so happy and love it")).toBe("happy");
    expect(detectUserMood("What is the weather today?")).toBe("unknown");
  });

  it("derives appropriate signals and care cues", () => {
    const boundary = deriveSignal("stop it", "clear boundary");
    expect(boundary.relationshipSignal).toContain("preference for low disturbance");
    expect(boundary.importantMoment).toBeDefined();

    const tired = deriveSignal("so tired", "tired");
    expect(tired.relationshipSignal).toContain("signs of fatigue");

    const anxious = deriveSignal("so stressed", "anxious");
    expect(anxious.relationshipSignal).toContain("under stress");

    const down = deriveSignal("sad", "down");
    expect(down.relationshipSignal).toContain("mood is low");

    const happy = deriveSignal("yay", "happy");
    expect(happy.relationshipSignal).toContain("positive");

    const unknown = deriveSignal("hello Cyrene", "unknown");
    expect(unknown.relationshipSignal).toContain("no obvious emotional peaks");
  });

  it("summarizes daily entries correctly", () => {
    const entries: RelationshipLogEntry[] = [
      {
        id: "1",
        date: "2026-09-08",
        createdAt: 1000,
        userText: "I am tired",
        assistantText: "Rest well Master",
        cyreneFeeling: "caring",
        channel: "desktop",
        userMood: "tired",
        relationshipSignal: "fatigued",
        nextCareCue: "Keep questions minimal",
      },
    ];
    const summary = summarizeDate("2026-09-08", entries);
    expect(summary.date).toBe("2026-09-08");
    expect(summary.summary).toContain("tired");
    expect(summary.nextCareCue).toBe("Keep questions minimal");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  EpisodicStore,
  detectEpisodicEventFromText,
} from "./episodic-store";

describe("EpisodicStore", () => {
  let tmpDir: string;
  let testFile: string;
  let simulatedTime: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "episodic-test-"));
    testFile = path.join(tmpDir, "episodic-memory.json");
    simulatedTime = Date.UTC(2026, 8, 8, 12, 0, 0);
  });

  it("adds and lists episodic events with pending status", () => {
    const store = new EpisodicStore({
      filePath: testFile,
      now: () => simulatedTime,
    });

    const ev = store.addEvent({
      summary: "Big project presentation tomorrow morning",
      category: "work",
      emotion: "anxious",
    });

    expect(ev.id).toBeDefined();
    expect(ev.summary).toBe("Big project presentation tomorrow morning");
    expect(ev.status).toBe("pending");
    expect(ev.category).toBe("work");
    expect(ev.emotion).toBe("anxious");

    const pending = store.listPendingEvents();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(ev.id);
  });

  it("resolves an event with optional resolution note", () => {
    const store = new EpisodicStore({
      filePath: testFile,
      now: () => simulatedTime,
    });

    const ev = store.addEvent({
      summary: "Dentist appointment",
      category: "health",
      emotion: "anxious",
    });

    const resolved = store.resolveEvent(ev.id, "Finished with no cavities!");
    expect(resolved).toBe(true);

    expect(store.listPendingEvents().length).toBe(0);
    const all = store.listEvents();
    expect(all[0].status).toBe("resolved");
    expect(all[0].resolutionNote).toBe("Finished with no cavities!");
  });

  it("builds pending events prompt within 4-day threshold", () => {
    const store = new EpisodicStore({
      filePath: testFile,
      now: () => simulatedTime,
    });

    store.addEvent({
      summary: "Keynote speech at tech conference",
      category: "work",
      emotion: "excited",
    });

    const prompt = store.buildPendingEventsPrompt();
    expect(prompt).toContain("[EPISODIC MEMORY CUES]");
    expect(prompt).toContain("Keynote speech at tech conference");
    expect(prompt).toContain("work/excited");
  });

  it("detects episodic moments from natural user speech", () => {
    const detected1 = detectEpisodicEventFromText(
      "Tomorrow I have an important presentation with the director and I feel nervous.",
    );
    expect(detected1).not.toBeNull();
    expect(detected1?.emotion).toBe("anxious");
    expect(detected1?.category).toBe("work");

    const detected2 = detectEpisodicEventFromText(
      "I have to go to the dentist clinic for my checkup.",
    );
    expect(detected2).not.toBeNull();
    expect(detected2?.category).toBe("health");

    const detected3 = detectEpisodicEventFromText("Hello there");
    expect(detected3).toBeNull();
  });
});

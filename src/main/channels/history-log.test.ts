// channels/history-log unit tests
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock electron
const HISTORY_TMP = fs.mkdtempSync(path.join(os.tmpdir(), `cyrene-history-test-${process.pid}-`));
fs.mkdirSync(HISTORY_TMP, { recursive: true });

afterAll(() => {
  fs.rmSync(HISTORY_TMP, { recursive: true, force: true });
});

vi.mock("electron", () => ({
  app: {
    getPath: () => HISTORY_TMP,
  },
}));

import { appendHistory, loadRecentHistory } from "./history-log";

describe("channels/history-log", () => {
  beforeEach(() => {
    // Clean test directory
    const dir = path.join(HISTORY_TMP, "channels", "history");
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  });

  it("loadRecentHistory: non-existent session -> empty array", () => {
    const r = loadRecentHistory("channel:feishu:notexist", 16);
    expect(r).toEqual([]);
  });

  it("appendHistory + loadRecentHistory round-trip", () => {
    const sid = "channel:feishu:abc123";
    appendHistory(sid, "user", "Hello");
    appendHistory(sid, "assistant", "Hello! How can I help you?");

    const history = loadRecentHistory(sid, 16);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Hello");
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toBe("Hello! How can I help you?");
  });

  it("loadRecentHistory: limit truncation (only retrieves recent N items)", () => {
    const sid = "channel:feishu:limit-test";
    for (let i = 0; i < 10; i++) {
      appendHistory(sid, "user", `question_${i}`);
      appendHistory(sid, "assistant", `answer_${i}`);
    }
    // 20 items written, only retrieve last 4
    const history = loadRecentHistory(sid, 4);
    expect(history).toHaveLength(4);
    // In chronological order:
    // Round 8: user="question_8", assistant="answer_8"
    // Round 9: user="question_9", assistant="answer_9"
    expect(history[0].content).toBe("question_8");
    expect(history[1].content).toBe("answer_8");
    expect(history[2].content).toBe("question_9");
    expect(history[3].content).toBe("answer_9");
  });

  it("appendHistory: empty sessionId or content does not persist", () => {
    appendHistory("", "user", "hello");
    appendHistory("channel:feishu:x", "user", "");
    const history = loadRecentHistory("channel:feishu:x", 16);
    expect(history).toEqual([]);
  });

  it("multiple session isolation: different sessionIds produce separate files", () => {
    appendHistory("channel:feishu:userA", "user", "User A statement");
    appendHistory("channel:feishu:userB", "user", "User B statement");

    const a = loadRecentHistory("channel:feishu:userA", 16);
    const b = loadRecentHistory("channel:feishu:userB", 16);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toBe("User A statement");
    expect(b[0].content).toBe("User B statement");
  });

  it("automatically truncates when exceeding MAX_FILE_LINES (retaining newest items)", () => {
    const sid = "channel:feishu:trunc";
    // Write 250 items (> MAX_FILE_LINES 200)
    for (let i = 0; i < 250; i++) {
      appendHistory(sid, "user", `msg${i}`);
    }
    const history = loadRecentHistory(sid, 250);
    expect(history.length).toBeLessThanOrEqual(200);
    expect(history[history.length - 1].content).toBe("msg249");
    expect(history[0].content).toBe("msg50");
  });
});

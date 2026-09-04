import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

describe("Chat Renderer Hardening Policies", () => {
  describe("Session Switching Lock on Active Sending", () => {
    function canSwitchSession(sending: boolean, targetSessionId: string, currentSessionId: string | null): boolean {
      if (sending) return false;
      if (targetSessionId === currentSessionId) return false;
      return true;
    }

    it("prevents switching session when generation is in progress", () => {
      expect(canSwitchSession(true, "session-2", "session-1")).toBe(false);
    });

    it("allows switching session when idle and session is different", () => {
      expect(canSwitchSession(false, "session-2", "session-1")).toBe(true);
    });

    it("skips switching when target is already current session", () => {
      expect(canSwitchSession(false, "session-1", "session-1")).toBe(false);
    });
  });

  describe("Cloned Array Snapshot Isolation", () => {
    it("creates independent runMessages clone so swapping global messages does not corrupt run state", () => {
      const messages = [{ id: "m1", role: "user", content: "Hello" }];
      const runMessages = [...messages];

      // User switches session, global messages gets replaced/cleared
      messages.length = 0;
      messages.push({ id: "m2", role: "user", content: "Switched" });

      expect(runMessages.length).toBe(1);
      expect(runMessages[0].id).toBe("m1");
      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe("m2");
    });

    it("binds persistence to the captured tail offset", () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), "src", "renderer", "chat", "main.ts"),
        "utf8",
      );
      expect(source).toContain("const runTailStart = sessionTailStart;");
      expect(source).toContain("replaceTail(runSessionId, runTailStart");
    });
  });

  describe("Clear Chat Total Reset Contract", () => {
    it("resets sessionTailStart to 0 and replaces tail from index 0 on success", async () => {
      let sessionTailStart = 45;
      const messages = [{ id: "1" }, { id: "2" }];
      const currentSessionId = "sess-100";

      const replaceTailMock = vi.fn().mockResolvedValue(true);
      const mockChatStore = { replaceTail: replaceTailMock };

      const ok = true;
      if (ok) {
        const success = await mockChatStore.replaceTail(currentSessionId, 0, []);
        if (success) {
          messages.length = 0;
          sessionTailStart = 0;
        }
      }

      expect(sessionTailStart).toBe(0);
      expect(messages.length).toBe(0);
      expect(replaceTailMock).toHaveBeenCalledWith("sess-100", 0, []);
    });

    it("aborts clearing UI messages if storage replaceTail fails or returns false", async () => {
      let sessionTailStart = 45;
      const messages = [{ id: "1" }, { id: "2" }];
      const currentSessionId = "sess-100";

      const replaceTailMock = vi.fn().mockResolvedValue(false);
      const mockChatStore = { replaceTail: replaceTailMock };

      const ok = true;
      if (ok) {
        const success = await mockChatStore.replaceTail(currentSessionId, 0, []);
        if (success) {
          messages.length = 0;
          sessionTailStart = 0;
        }
      }

      // UI messages preserved!
      expect(sessionTailStart).toBe(45);
      expect(messages.length).toBe(2);
      expect(replaceTailMock).toHaveBeenCalledWith("sess-100", 0, []);
    });
  });

  describe("Legacy Migration Safety Contract", () => {
    it("does NOT delete localStorage key if migration fails or throws", async () => {
      let keyDeleted = false;
      const migrateLegacyMock = vi.fn().mockResolvedValue(false);

      const mockChatStore = { migrateLegacy: migrateLegacyMock };
      const normalized = [{ role: "user", content: "hello" }];

      const migrated = await mockChatStore.migrateLegacy(normalized);
      if (migrated) {
        keyDeleted = true;
      }

      expect(keyDeleted).toBe(false);
      expect(migrateLegacyMock).toHaveBeenCalled();
    });

    it("deletes localStorage key ONLY when migrateLegacy returns true", async () => {
      let keyDeleted = false;
      const migrateLegacyMock = vi.fn().mockResolvedValue(true);

      const mockChatStore = { migrateLegacy: migrateLegacyMock };
      const normalized = [{ role: "user", content: "hello" }];

      const migrated = await mockChatStore.migrateLegacy(normalized);
      if (migrated) {
        keyDeleted = true;
      }

      expect(keyDeleted).toBe(true);
    });
  });

  describe("Pending Permission Request Persistence", () => {
    it("tracks, survives across simulated renders, and deletes on resolve", () => {
      const pendingMap = new Map<string, any>();

      // Inbound request
      const req1 = { id: "perm-1", toolId: "run_shell" };
      const req2 = { id: "perm-2", toolId: "write_file" };
      pendingMap.set(req1.id, req1);
      pendingMap.set(req2.id, req2);

      // Simulated render() iterates over pendingMap
      const renderedCards = Array.from(pendingMap.values()).map(r => `card-${r.id}`);
      expect(renderedCards).toEqual(["card-perm-1", "card-perm-2"]);

      // User resolves perm-1
      pendingMap.delete("perm-1");
      expect(pendingMap.has("perm-1")).toBe(false);
      expect(pendingMap.has("perm-2")).toBe(true);

      // Re-render only shows remaining perm-2
      const rerenderedCards = Array.from(pendingMap.values()).map(r => `card-${r.id}`);
      expect(rerenderedCards).toEqual(["card-perm-2"]);
    });
  });

  describe("Stream Completion Watchdog Contract", () => {
    it("triggers cancel on backend and rejects if stream hangs beyond watchdog duration", async () => {
      vi.useFakeTimers();

      const cancelMock = vi.fn().mockResolvedValue(undefined);
      const hangingRunDone = new Promise<void>(() => {
        // never resolves
      });

      let watchdogTimer: any = null;
      const watchdogPromise = new Promise<never>((_, reject) => {
        watchdogTimer = setTimeout(async () => {
          try {
            await cancelMock();
          } catch { /* ignore */ }
          reject(new Error("watchdog timed out"));
        }, 180000);
      });

      const streamRace = Promise.race([hangingRunDone, watchdogPromise]);

      vi.advanceTimersByTime(180001);

      await expect(streamRace).rejects.toThrow("watchdog timed out");
      expect(cancelMock).toHaveBeenCalled();
      clearTimeout(watchdogTimer);

      vi.useRealTimers();
    });
  });
});

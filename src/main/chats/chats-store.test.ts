import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  userDataDir: "",
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronMock.userDataDir,
  },
  shell: {
    openPath: vi.fn(),
  },
}));

describe("chats store", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-chats-store-"));
  });

  it("includes messageCount in paged session metadata", async () => {
    const { createSession, getSessionPage, initialize } = await import("./chats-store");
    initialize();

    const session = createSession({
      initialMessages: [
        { id: "1", role: "user", content: "one", at: 1 },
        { id: "2", role: "model", content: "two", at: 2 },
        { id: "3", role: "user", content: "three", at: 3 },
      ],
    });

    const page = getSessionPage(session.id, null, 2);

    expect(page?.messages).toHaveLength(2);
    expect(page?.session.messageCount).toBe(3);
  });

  it("persists and indexes a session purpose", async () => {
    let store = await import("./chats-store");
    store.initialize();

    const created = store.createSession({
      title: "Cyrene's proactive message",
      purpose: "proactive-chat",
    });

    expect(store.listSessions()).toContainEqual(expect.objectContaining({
      id: created.id,
      purpose: "proactive-chat",
    }));

    vi.resetModules();
    store = await import("./chats-store");
    store.initialize();

    expect(store.getSessionByPurpose("proactive-chat")?.id).toBe(created.id);
    expect(store.getSession(created.id)?.purpose).toBe("proactive-chat");
  });

  it("returns one proactive session for repeated singleton requests", async () => {
    const store = await import("./chats-store");
    store.initialize();

    const sessions = await Promise.all(Array.from({ length: 8 }, async () => (
      store.getOrCreateSessionByPurpose("proactive-chat", { title: "Cyrene's proactive message" })
    )));

    expect(new Set(sessions.map((session) => session.id)).size).toBe(1);
    expect(store.listSessions().filter((session) => session.purpose === "proactive-chat")).toHaveLength(1);

    store.appendMessage(sessions[0].id, { id: "p1", role: "model", content: "Proactive greeting", at: 1 });
    expect(store.getSession(sessions[0].id)?.title).toBe("Cyrene's proactive message");
  });

  it("recreates the proactive singleton after it is deleted", async () => {
    const store = await import("./chats-store");
    store.initialize();

    const first = store.getOrCreateSessionByPurpose("proactive-chat", { title: "Cyrene's proactive message" });
    expect(store.deleteSession(first.id)).toBe(true);

    const second = store.getOrCreateSessionByPurpose("proactive-chat", { title: "Cyrene's proactive message" });
    expect(second.id).not.toBe(first.id);
    expect(store.getSessionByPurpose("proactive-chat")?.id).toBe(second.id);
  });

  it("strictly deduplicates messages with the same ID or identical content in quick succession", async () => {
    const store = await import("./chats-store");
    store.initialize();

    const session = store.createSession({ title: "Deduplication Test" });

    // 1. Same ID deduplication
    store.appendMessage(session.id, { id: "turn-1", role: "user", content: "Hello", at: 1000 });
    store.appendMessage(session.id, { id: "turn-1", role: "user", content: "Hello updated", at: 1001 });

    let current = store.getSession(session.id);
    expect(current?.messages).toHaveLength(1);
    expect(current?.messages[0].content).toBe("Hello updated");

    // 2. Race condition content deduplication
    store.appendMessage(session.id, { id: "asst-1", role: "model", content: "Ehehe~ I am Cyrene!", at: 2000 });
    // Accidental second append with different ID but same role & content within 5 seconds
    store.appendMessage(session.id, { id: "asst-duplicate", role: "model", content: "Ehehe~ I am Cyrene!", at: 2500 });

    current = store.getSession(session.id);
    expect(current?.messages).toHaveLength(2);
    expect(current?.messages.filter((m) => m.role === "model")).toHaveLength(1);
  });
});

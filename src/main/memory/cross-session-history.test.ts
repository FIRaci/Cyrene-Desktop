import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPastSessionHighlights,
  buildCrossSessionSummary,
  searchChatHistory,
} from "./cross-session-history";
import * as chatsStore from "../chats/chats-store";

vi.mock("../chats/chats-store", () => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
}));

describe("cross-session-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out currentSessionId and extracts highlights from other sessions", () => {
    vi.mocked(chatsStore.listSessions).mockReturnValue([
      {
        id: "sess-current",
        title: "Current Chat",
        identityId: null,
        createdAt: 1000,
        updatedAt: 1000,
        messageCount: 5,
      },
      {
        id: "sess-past-1",
        title: "Auth Refactoring",
        identityId: null,
        createdAt: 900,
        updatedAt: 950,
        messageCount: 4,
      },
      {
        id: "sess-empty",
        title: "Empty Chat",
        identityId: null,
        createdAt: 800,
        updatedAt: 800,
        messageCount: 0,
      },
    ]);

    vi.mocked(chatsStore.getSession).mockImplementation((id: string) => {
      if (id === "sess-past-1") {
        return {
          id: "sess-past-1",
          title: "Auth Refactoring",
          identityId: null,
          createdAt: 900,
          updatedAt: 950,
          schemaVersion: 1,
          messages: [
            { id: "m1", role: "user", content: "Let's fix the JWT token issue", at: 910 },
            { id: "m2", role: "model", content: "I'll update the auth middleware now", at: 920 },
          ],
        };
      }
      return null;
    });

    const highlights = getPastSessionHighlights("sess-current");
    expect(highlights.length).toBe(1);
    expect(highlights[0].sessionId).toBe("sess-past-1");
    expect(highlights[0].title).toBe("Auth Refactoring");
    expect(highlights[0].recentDialogue.length).toBe(2);

    const summary = buildCrossSessionSummary("sess-current");
    expect(summary).toContain("[Cross-Session Shared Memories & Past Conversations]");
    expect(summary).toContain("Auth Refactoring");
    expect(summary).toContain("JWT token issue");
    expect(summary).toContain("Seamless Continuity");
  });

  it("returns empty string if no other sessions exist", () => {
    vi.mocked(chatsStore.listSessions).mockReturnValue([
      { id: "sess-only", title: "Only", identityId: null, createdAt: 1, updatedAt: 1, messageCount: 2 },
    ]);
    const summary = buildCrossSessionSummary("sess-only");
    expect(summary).toBe("");
  });

  it("searches chat history across sessions", () => {
    vi.mocked(chatsStore.listSessions).mockReturnValue([
      { id: "s1", title: "Trip to Hanoi", identityId: null, createdAt: 100, updatedAt: 200, messageCount: 2 },
    ]);
    vi.mocked(chatsStore.getSession).mockReturnValue({
      id: "s1",
      title: "Trip to Hanoi",
      identityId: null,
      createdAt: 100,
      updatedAt: 200,
      schemaVersion: 1,
      messages: [
        { id: "m1", role: "user", content: "Can you recommend cafes in Hoan Kiem?", at: 150 },
        { id: "m2", role: "model", content: "Sure Master! Cafe Dinh is historic.", at: 160 },
      ],
    });

    const results = searchChatHistory("Hoan Kiem");
    expect(results.length).toBe(1);
    expect(results[0].sessionTitle).toBe("Trip to Hanoi");
    expect(results[0].content).toContain("Hoan Kiem");

    const empty = searchChatHistory("NonexistentKeyword");
    expect(empty.length).toBe(0);
  });
});

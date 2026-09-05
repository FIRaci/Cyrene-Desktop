import { describe, expect, it } from "vitest";
import { compileSocialContextBlock } from "./context";
import { rankSocialAtoms } from "./retrieval";
import { createSocialAtomStore } from "./store";
import type { SocialAtom } from "./types";

function atom(
  id: string,
  content: string,
  overrides: Partial<SocialAtom> = {},
): SocialAtom {
  return {
    id,
    conversationId: "chat-a",
    type: "long_term",
    content,
    evidenceTurnId: `turn-${id}`,
    evidenceQuote: content,
    createdAt: Date.parse("2026-07-20T00:00:00Z"),
    status: "active",
    ...overrides,
  };
}

describe("social atom store", () => {
  it("isolates conversations and filters expired or inactive atoms", () => {
    const store = createSocialAtomStore();
    store.replaceForTest([
      atom("a", "User likes the seaside"),
      atom("b", "Another conversation", { conversationId: "chat-b" }),
      atom("c", "Already expired", { expiresAt: 10 }),
      atom("d", "Already corrected", { status: "superseded" }),
    ]);

    expect(store.listActive("chat-a", 20).map((item) => item.id)).toEqual(["a"]);
    expect(store.listActive("chat-b", 20).map((item) => item.id)).toEqual(["b"]);
  });

  it("adds a correction atom and marks its target superseded", () => {
    const store = createSocialAtomStore();
    store.replaceForTest([atom("old", "User lives in Shanghai")]);

    store.applyOperations("chat-a", [{
      operation: "supersede",
      atom: atom("new", "User already moved to Hangzhou", {
        evidenceTurnId: "user-2",
        evidenceQuote: "I moved to Hangzhou",
      }),
      targetAtomId: "old",
    }], 100);

    expect(store.getById("old")?.status).toBe("superseded");
    expect(store.getById("old")?.supersededByAtomId).toBe("new");
    expect(store.listActive("chat-a", 100).map((item) => item.id)).toEqual(["new"]);
  });

  it("resolves only an active open loop without creating a new atom", () => {
    const store = createSocialAtomStore();
    store.replaceForTest([
      atom("loop", "User has not answered if free this weekend", {
        type: "open_loop",
        evidenceTurnId: "assistant-1",
        evidenceQuote: "Are you free this weekend",
        expiresAt: 500,
      }),
    ]);

    store.applyOperations("chat-a", [{
      operation: "resolve",
      targetAtomId: "loop",
      evidenceTurnId: "user-2",
      evidenceQuote: "free on weekends",
    }], 100);

    expect(store.getById("loop")?.status).toBe("resolved");
    expect(store.listActive("chat-a", 100)).toEqual([]);
  });

  it("deduplicates retry writes by stable evidence turn and normalized content", () => {
    const store = createSocialAtomStore();
    const first = atom("first", "User likes the seaside", {
      evidenceTurnId: "user-1",
      evidenceQuote: "I like the seaside",
    });
    const retry = { ...first, id: "retry" };

    store.applyOperations("chat-a", [{ operation: "add", atom: first }], 100);
    store.applyOperations("chat-a", [{ operation: "add", atom: retry }], 100);

    expect(store.listActive("chat-a", 100).map((item) => item.id)).toEqual(["first"]);
  });
});

describe("social atom retrieval", () => {
  it("uses lexical relevance with recency decay and returns at most five active atoms", () => {
    const now = Date.parse("2026-07-24T00:00:00Z");
    const atoms = [
      atom("old-cat", "User likes cats and raised an orange cat", { createdAt: now - 60 * 86_400_000 }),
      atom("new-cat", "User just adopted a ragdoll cat", { createdAt: now - 86_400_000 }),
      atom("sea", "User likes walking by the seaside", { createdAt: now - 1_000 }),
      ...Array.from({ length: 6 }, (_, index) => (
        atom(`extra-${index}`, `User mentioned cat matter ${index}`, { createdAt: now - index * 1_000 })
      )),
    ];

    const ranked = rankSocialAtoms("want to chat about my cat", atoms, { now, limit: 5 });

    expect(ranked).toHaveLength(5);
    expect(ranked[0].id).not.toBe("old-cat");
    expect(ranked.some((item) => item.id === "sea")).toBe(false);
  });

  it("returns no unrelated facts but can surface a recent open loop", () => {
    const now = 1_000_000;
    const ranked = rankSocialAtoms("good evening", [
      atom("fact", "User likes diving", { createdAt: now - 1_000 }),
      atom("loop", "User has not answered if ate today", {
        type: "open_loop",
        createdAt: now - 1_000,
        expiresAt: now + 1_000,
      }),
    ], { now, limit: 5 });

    expect(ranked.map((item) => item.id)).toEqual(["loop"]);
  });
});

describe("social context compiler", () => {
  it("omits an empty block", () => {
    expect(compileSocialContextBlock([])).toBe("");
  });

  it("separates relevant past from open loops and instructs Soul to use it naturally", () => {
    const block = compileSocialContextBlock([
      atom("fact", "User likes the seaside"),
      atom("loop", "User has not replied whether they are free this weekend", { type: "open_loop" }),
    ]);

    expect(block).toContain("Relevant history:");
    expect(block).toContain("Open threads:");
    expect(block).toContain("User likes the seaside");
    expect(block).toContain("Do not repeat this context");
    expect(block).not.toContain("evidenceTurnId");
  });
});

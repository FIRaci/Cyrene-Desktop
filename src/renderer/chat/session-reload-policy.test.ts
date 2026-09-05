import { describe, expect, it } from "vitest";
import { decideReloadCurrentSession } from "./session-reload-policy";

describe("decideReloadCurrentSession", () => {
  it("reloads when session has new external changes and not sending", () => {
    expect(decideReloadCurrentSession({
      purpose: "proactive-chat", updatedAt: 200, seenAt: 100, sending: false,
    })).toBe("reload");

    expect(decideReloadCurrentSession({
      purpose: undefined, updatedAt: 200, seenAt: 100, sending: false,
    })).toBe("reload");
  });

  it("skips when updatedAt has not increased", () => {
    expect(decideReloadCurrentSession({
      purpose: "proactive-chat", updatedAt: 100, seenAt: 100, sending: false,
    })).toBe("skip");

    expect(decideReloadCurrentSession({
      purpose: undefined, updatedAt: 100, seenAt: 100, sending: false,
    })).toBe("skip");
  });

  it("skips when updatedAt regresses", () => {
    expect(decideReloadCurrentSession({
      purpose: "proactive-chat", updatedAt: 50, seenAt: 100, sending: false,
    })).toBe("skip");

    expect(decideReloadCurrentSession({
      purpose: undefined, updatedAt: 50, seenAt: 100, sending: false,
    })).toBe("skip");
  });

  it("defers when session receives external changes while sending", () => {
    expect(decideReloadCurrentSession({
      purpose: "proactive-chat", updatedAt: 200, seenAt: 100, sending: true,
    })).toBe("defer");

    expect(decideReloadCurrentSession({
      purpose: undefined, updatedAt: 200, seenAt: 100, sending: true,
    })).toBe("defer");
  });
});

// dispatcher unit tests: sessionId hash + rate limiting
import { describe, it, expect } from "vitest";
import { makeSessionId, lookupOriginalSender } from "./dispatcher";

describe("channels/dispatcher", () => {
  it("makeSessionId: same channel + same sender -> same sessionId", () => {
    const a = makeSessionId("feishu", "ou_abc123");
    const b = makeSessionId("feishu", "ou_abc123");
    expect(a).toBe(b);
  });

  it("makeSessionId: different channels produce different sessionIds", () => {
    const f = makeSessionId("feishu", "user-x");
    const w = makeSessionId("wechat", "user-x");
    expect(f).not.toBe(w);
  });

  it("makeSessionId: produces 16-character hash + prefix", () => {
    const s = makeSessionId("feishu", "ou_abc");
    // Format: channel:<channel>:<16 hex>
    expect(s).toMatch(/^channel:feishu:[0-9a-f]{16}$/);
  });

  it("makeSessionId: different senders produce different sessionIds", () => {
    const a = makeSessionId("feishu", "ou_aaa");
    const b = makeSessionId("feishu", "ou_bbb");
    expect(a).not.toBe(b);
  });

  it("lookupOriginalSender: returns null for unknown sessionId", () => {
    expect(lookupOriginalSender("channel:feishu:0000000000000000")).toBeNull();
  });
});
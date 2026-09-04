import { describe, expect, it } from "vitest";
import { isTrustedMainFrameSender } from "./trusted-renderer";

function fixture(url = "file:///app/renderer/settings/index.html") {
  const frame = { url };
  const webContents = { id: 7, mainFrame: frame, isDestroyed: () => false };
  const owner = { webContents, isDestroyed: () => false };
  return { frame, webContents, owner, event: { sender: webContents, senderFrame: frame } };
}

describe("trusted renderer main-frame policy", () => {
  it("accepts only the live owner's exact main document (query/hash ignored)", () => {
    const f = fixture("file:///app/renderer/settings/index.html?x=1#models");
    expect(isTrustedMainFrameSender(f.event, f.owner, "file:///app/renderer/settings/index.html")).toBe(true);
  });

  it("denies missing owners, destroyed owners and destroyed web contents", () => {
    const f = fixture();
    expect(isTrustedMainFrameSender(f.event, null, f.frame.url)).toBe(false);
    expect(isTrustedMainFrameSender(f.event, { ...f.owner, isDestroyed: () => true }, f.frame.url)).toBe(false);
    expect(isTrustedMainFrameSender(f.event, { ...f.owner, webContents: { ...f.webContents, isDestroyed: () => true } }, f.frame.url)).toBe(false);
  });

  it("denies wrong windows, child frames, stale frames and wrong documents", () => {
    const f = fixture();
    const wrongSender = { ...f.webContents, mainFrame: f.frame };
    expect(isTrustedMainFrameSender({ sender: wrongSender, senderFrame: f.frame }, f.owner, f.frame.url)).toBe(false);
    expect(isTrustedMainFrameSender({ sender: f.webContents, senderFrame: { url: f.frame.url } }, f.owner, f.frame.url)).toBe(false);
    const replacement = { url: f.frame.url };
    const reloaded = { id: 7, mainFrame: replacement, isDestroyed: () => false };
    expect(isTrustedMainFrameSender({ sender: reloaded, senderFrame: f.frame }, { webContents: reloaded, isDestroyed: () => false }, f.frame.url)).toBe(false);
    expect(isTrustedMainFrameSender(f.event, f.owner, "file:///app/renderer/chat/index.html")).toBe(false);
  });
});

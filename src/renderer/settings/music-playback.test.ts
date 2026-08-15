import { describe, expect, it, vi } from "vitest";
import { requestTrackPlayback } from "./music-playback";

describe("requestTrackPlayback", () => {
  it("calls the formal music preload API and reports a dispatched request precisely", async () => {
    const playTrack = vi.fn().mockResolvedValue({
      ok: true,
      data: { state: "dispatched", resourceType: "song", resourceId: "123" },
    });

    const result = await requestTrackPlayback({ playTrack }, { id: "123", name: "Song" });

    expect(playTrack).toHaveBeenCalledWith("123");
    expect(result).toEqual({ kind: "ok", message: "Sent playback request to NetEase Cloud Music: Song" });
  });

  it("explains when the NetEase desktop client is unavailable", async () => {
    const playTrack = vi.fn().mockResolvedValue({
      ok: true,
      data: { state: "client_unavailable", resourceType: "song", resourceId: "123" },
    });

    const result = await requestTrackPlayback({ playTrack }, { id: "123", name: "Song" });

    expect(result.kind).toBe("err");
    expect(result.message).toContain("requires NetEase Cloud Music desktop client");
  });

  it("reports the MCP browser fallback without claiming desktop dispatch", async () => {
    const playTrack = vi.fn().mockResolvedValue({
      ok: true,
      data: { state: "web_fallback", resourceType: "song", resourceId: "123" },
    });

    const result = await requestTrackPlayback({ playTrack }, { id: "123", name: "Song" });

    expect(result).toEqual({ kind: "ok", message: "NetEase desktop client unavailable, opened in browser: Song" });
  });
});

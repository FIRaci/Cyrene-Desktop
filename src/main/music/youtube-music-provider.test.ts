import { describe, it, expect, vi, beforeEach } from "vitest";
import { YouTubeMusicProvider } from "./youtube-music-provider";

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: { openExternal },
}));

describe("YouTubeMusicProvider", () => {
  beforeEach(() => {
    openExternal.mockReset();
  });

  it("returns daily curated tracks", async () => {
    const provider = new YouTubeMusicProvider();
    const tracks = await provider.getDailyRecommendations();
    expect(tracks.length).toBeGreaterThanOrEqual(4);
    expect(tracks[0]).toHaveProperty("id");
    expect(tracks[0]).toHaveProperty("name");
    expect(tracks[0].artists).toBeDefined();
  });

  it("handles empty search keyword", async () => {
    const provider = new YouTubeMusicProvider();
    const tracks = await provider.searchTracks("   ");
    expect(tracks).toEqual([]);
  });

  it("dispatches track playback to YouTube Music URL", async () => {
    const provider = new YouTubeMusicProvider();
    const result = await provider.playTrack("jfKfPfyJRdk");
    expect(result.state).toBe("dispatched");
    expect(result.resourceType).toBe("song");
    expect(result.resourceId).toBe("jfKfPfyJRdk");
    expect(openExternal).toHaveBeenCalledWith("https://music.youtube.com/watch?v=jfKfPfyJRdk");
  });

  it("dispatches playlist playback to YouTube Music playlist URL", async () => {
    const provider = new YouTubeMusicProvider();
    const result = await provider.playPlaylist("PLrAl6s_Zf5t1n-y7i_aBw5e4eZ5a");
    expect(result.state).toBe("dispatched");
    expect(result.resourceType).toBe("playlist");
    expect(result.resourceId).toBe("PLrAl6s_Zf5t1n-y7i_aBw5e4eZ5a");
    expect(openExternal).toHaveBeenCalledWith("https://music.youtube.com/playlist?list=PLrAl6s_Zf5t1n-y7i_aBw5e4eZ5a");
  });
});

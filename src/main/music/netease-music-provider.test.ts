import { describe, expect, it, vi } from "vitest";
import { NeteaseMusicProvider } from "./netease-music-provider";

function clientReturning(value: unknown) {
  return { callDataTool: vi.fn().mockResolvedValue(value) };
}

describe("NeteaseMusicProvider MCP playback", () => {
  it("plays a track through cloud_music_play with the upstream schema", async () => {
    const client = clientReturning("\u5df2\u53d1\u9001\u64ad\u653e\u6307\u4ee4: song 255667");
    const provider = new NeteaseMusicProvider(client as never);

    await expect(provider.playTrack("255667")).resolves.toEqual({
      state: "dispatched",
      resourceType: "song",
      resourceId: "255667",
    });
    expect(client.callDataTool).toHaveBeenCalledWith("cloud_music_play", {
      id: "255667",
      type: "song",
    });
  });

  it("normalizes the upstream browser fallback without claiming client dispatch", async () => {
    const client = clientReturning(
      "\u26a0\ufe0f \u672a\u68c0\u6d4b\u5230\u5ba2\u6237\u7aef\uff0c\u5df2\u5728\u6d4f\u89c8\u5668\u4e2d\u64ad\u653e: https://music.163.com/#/playlist?id=456",
    );
    const provider = new NeteaseMusicProvider(client as never);

    await expect(provider.playPlaylist("456")).resolves.toEqual({
      state: "web_fallback",
      resourceType: "playlist",
      resourceId: "456",
    });
  });

  it.each([
    ["\u64ad\u653e\u5931\u8d25: access denied", "E_PLAYBACK_DISPATCH_FAILED"],
    ["upstream returned unrecognized content", "E_PLAYBACK_RESULT_UNKNOWN"],
  ])("rejects a failed or unknown upstream result: %s", async (raw, code) => {
    const provider = new NeteaseMusicProvider(clientReturning(raw) as never);
    await expect(provider.playTrack("123")).rejects.toMatchObject({ code });
  });
});

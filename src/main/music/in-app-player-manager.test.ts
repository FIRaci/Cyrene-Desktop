import { describe, it, expect, vi, beforeEach } from "vitest";
import { InAppPlayerManager } from "./in-app-player-manager";

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: { openExternal },
}));

describe("InAppPlayerManager", () => {
  let player: InAppPlayerManager;

  beforeEach(() => {
    openExternal.mockReset();
    player = new InAppPlayerManager();
  });

  it("initializes with default state", () => {
    const state = player.getState();
    expect(state.status).toBe("stopped");
    expect(state.playbackSpeed).toBe(1.0);
    expect(state.volume).toBe(100);
  });

  it("updates speed within valid bounds", async () => {
    await player.setSpeed(2.0);
    expect(player.getState().playbackSpeed).toBe(2.0);

    await player.setSpeed(1.5);
    expect(player.getState().playbackSpeed).toBe(1.5);

    // Clamps out of bounds
    await player.setSpeed(10.0);
    expect(player.getState().playbackSpeed).toBe(4.0);

    await player.setSpeed(0.1);
    expect(player.getState().playbackSpeed).toBe(0.25);
  });

  it("updates volume within valid bounds (0 - 100)", async () => {
    await player.setVolume(50);
    expect(player.getState().volume).toBe(50);

    await player.setVolume(150);
    expect(player.getState().volume).toBe(100);

    await player.setVolume(-20);
    expect(player.getState().volume).toBe(0);
  });

  it("handles play with fallback to external browser when BrowserWindow is absent", async () => {
    const res = await player.play("jfKfPfyJRdk", "Lofi Beats", "Lofi Girl");
    expect(res.ok).toBe(true);
    expect(res.state).toBe("external_browser");
    expect(openExternal).toHaveBeenCalledWith("https://music.youtube.com/watch?v=jfKfPfyJRdk");
  });

  it("handles stop gracefully", async () => {
    const stopped = await player.stop();
    expect(stopped).toBe(true);
    expect(player.getState().status).toBe("stopped");
  });
});

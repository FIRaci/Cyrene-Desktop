import { describe, expect, it, vi } from "vitest";
import { LIVE2D_ACTIONS, findAction } from "../../../shared/live2d-actions";
import { IPC } from "../../../shared/ipc-channels";
import { createPlayLive2DActionHandler, createPlayLive2DActionTool } from "./play-live2d-action";

function makeDeps() {
  return {
    sendToLive2DWindow: vi.fn(),
  };
}

describe("play-live2d-action handler", () => {
  it("emits IPC with a resolved motion target for a valid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "\u7728\u7728\u773c" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: true });
    expect(deps.sendToLive2DWindow).toHaveBeenCalledTimes(1);
    const [channel, payload] = deps.sendToLive2DWindow.mock.calls[0];
    expect(channel).toBe(IPC.LIVE2D_PLAY_ACTION);
    expect(payload).toEqual({
      kind: "motion",
      group: "\u52a8\u4f5c#6",
      motionName: "Wink~",
    });
  });

  it("resolves model-facing English aliases to internal asset targets", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);

    expect(JSON.parse(await handler({ name: "wink" }, undefined))).toMatchObject({ ok: true });
    expect(deps.sendToLive2DWindow).toHaveBeenCalledWith(IPC.LIVE2D_PLAY_ACTION, {
      kind: "motion",
      group: "\u52a8\u4f5c#6",
      motionName: "Wink~",
    });
  });

  it("emits IPC with a resolved expression target for a valid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "\u6234\u58a8\u955c" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: true });
    expect(deps.sendToLive2DWindow.mock.calls[0][1]).toEqual({
      kind: "expression",
      name: "\u58a8\u955c",
    });
  });

  it("returns unknown_action and never sends IPC for an invalid alias", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "\u6325\u624b" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: false, error: "unknown_action" });
    expect(Array.isArray((JSON.parse(result) as { available: string[] }).available)).toBe(true);
    expect((JSON.parse(result) as { available: string[] }).available.length).toBe(LIVE2D_ACTIONS.length);
    expect(deps.sendToLive2DWindow).not.toHaveBeenCalled();
  });

  it("returns unknown_action when name is missing or not a string", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);

    expect(JSON.parse(await handler({}, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(JSON.parse(await handler({ name: "" }, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(JSON.parse(await handler({ name: 123 }, undefined))).toMatchObject({ ok: false, error: "unknown_action" });
    expect(deps.sendToLive2DWindow).not.toHaveBeenCalled();
  });

  it("swallows IPC failures and returns ipc_failed", async () => {
    const deps = { sendToLive2DWindow: vi.fn(() => { throw new Error("ipc boom"); }) };
    const handler = createPlayLive2DActionHandler(deps);
    const result = await handler({ name: "\u7b11\u4e00\u7b11" }, undefined);

    expect(JSON.parse(result)).toMatchObject({ ok: false, error: "ipc_failed" });
  });

  it("returns only English aliases in the model-facing available list", async () => {
    const deps = makeDeps();
    const handler = createPlayLive2DActionHandler(deps);
    const result = JSON.parse(await handler({ name: "\u6325\u624b" }, undefined)) as { available: string[] };
    expect(result.available).toContain("wink");
    expect(result.available).toContain("sunglasses");
    expect(result.available.join(" ")).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("exposes an English-only tool contract", () => {
    const tool = createPlayLive2DActionTool(makeDeps());
    const contract = `${tool.name}\n${tool.description}\n${tool.inputSchema.properties.name.description}`;

    expect(contract).toContain("Available actions:");
    expect(contract).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("findAction is consistent with catalog (sanity)", () => {
    for (const a of LIVE2D_ACTIONS) {
      expect(findAction(a.alias)?.alias).toBe(a.alias);
    }
  });
});

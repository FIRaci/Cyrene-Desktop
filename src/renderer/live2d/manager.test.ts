import { describe, expect, it, vi } from "vitest";

/**
 * Mock pixi-live2d-display before importing manager.ts so we don't have to
 * boot a real WebGL context in the test runner.
 */
vi.mock("pixi-live2d-display/cubism4", () => {
  return {
    Live2DModel: class {
      static from = vi.fn();
      motion = vi.fn(async () => true);
      expression = vi.fn(async () => true);
      internalModel = { motionManager: { definitions: { "\u52a8\u4f5c#6": [{}, {}, {}, {}] } } };
    },
  };
});

vi.mock("pixi.js", () => {
  return {
    Application: class {
      renderer = { resize: vi.fn(), gl: { drawingBufferWidth: 200, drawingBufferHeight: 100 } };
      stage = { children: [] as unknown[], addChild: vi.fn((child: unknown) => { this.stage.children.push(child); }) };
      ticker = { started: true, stop: vi.fn(() => { this.ticker.started = false; }), start: vi.fn(() => { this.ticker.started = true; }) };
      render = vi.fn();
      destroy = vi.fn();
    },
    Renderer: class {},
    utils: { TextureCache: { a: {}, b: {} } },
  };
});

// Minimal stub canvas; we never read pixels in these tests.
const fakeCanvas = {} as HTMLCanvasElement;

describe("Live2DManager.playAction", () => {
  it("is a no-op when the model is not loaded", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    // init() will try to load the real model — we never call it, so model stays null
    await mgr.playAction({ kind: "expression", name: "\u58a8\u955c" });
    // No assertion needed beyond "did not throw"
  });

  it("deduplicates concurrent initialization so only one model is loaded", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { devicePixelRatio: 1, innerWidth: 100, innerHeight: 100 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const model = {
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 100, height: 100,
      destroy: vi.fn(), motion: vi.fn(), expression: vi.fn(), internalModel: { motionManager: { definitions: {} } },
    };
    vi.mocked(Live2DModel.from).mockResolvedValue(model as never);
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });

    await Promise.all([mgr.init(), mgr.init()]);

    expect(Live2DModel.from).toHaveBeenCalledTimes(1);
    mgr.dispose();
    vi.unstubAllGlobals();
  });

  it("reports resource metrics for app, model, ticker, and texture cache", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("window", { devicePixelRatio: 2, innerWidth: 100, innerHeight: 100 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const model = {
      anchor: { set: vi.fn() }, scale: { set: vi.fn() }, width: 100, height: 100,
      destroy: vi.fn(), motion: vi.fn(), expression: vi.fn(), internalModel: { motionManager: { definitions: {} } },
    };
    vi.mocked(Live2DModel.from).mockResolvedValue(model as never);
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });

    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: false,
      modelLoaded: false,
      disposed: false,
    });

    await mgr.init();

    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: true,
      modelLoaded: true,
      disposed: false,
      tickerStarted: true,
      stageChildren: 1,
    });

    mgr.dispose();
    expect(mgr.getResourceMetrics()).toMatchObject({
      appActive: false,
      modelLoaded: false,
      disposed: true,
    });
    vi.unstubAllGlobals();
  });

  it("calls model.expression for an expression target", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    // Inject a fake model directly
    (mgr as unknown as { model: unknown }).model = {
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    await mgr.playAction({ kind: "expression", name: "\u58a8\u955c" });
    const model = (mgr as unknown as { model: { expression: ReturnType<typeof vi.fn> } }).model;
    expect(model.expression).toHaveBeenCalledWith("\u58a8\u955c");
  });

  it("resolves motionName to the right index in the right group", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    const motionMock = vi.fn(async () => true);
    (mgr as unknown as { model: unknown }).model = {
      motion: motionMock,
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: { "\u52a8\u4f5c#6": [{ Name: "\u52a8\u4f5c\u56de\u6b63" }, { Name: "Wink~" }, { Name: "\u6211\u53ef\u7231\u5427~" }, { Name: "\u7b11\u4e00\u7b11\u5427~" }] } } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };
    // Inject the motionIndexMap that loadModel() would normally build from the JSON.
    (mgr as unknown as { motionIndexMap: Map<string, Map<string, number>> }).motionIndexMap = new Map([
      ["\u52a8\u4f5c#6", new Map([
        ["\u52a8\u4f5c\u56de\u6b63", 0],
        ["Wink~", 1],
        ["\u6211\u53ef\u7231\u5427~", 2],
        ["\u7b11\u4e00\u7b11\u5427~", 3],
      ])],
    ]);

    await mgr.playAction({ kind: "motion", group: "\u52a8\u4f5c#6", motionName: "Wink~" });
    expect(motionMock).toHaveBeenCalledWith("\u52a8\u4f5c#6", 1);

    await mgr.playAction({ kind: "motion", group: "\u52a8\u4f5c#6", motionName: "\u7b11\u4e00\u7b11\u5427~" });
    expect(motionMock).toHaveBeenLastCalledWith("\u52a8\u4f5c#6", 3);
  });

  it("falls back to expression() when motionName is not in the group", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    const motionMock = vi.fn(async () => false);
    const expressionMock = vi.fn(async () => true);
    (mgr as unknown as { model: unknown }).model = {
      motion: motionMock,
      expression: expressionMock,
      internalModel: { motionManager: { definitions: { "\u52a8\u4f5c#6": [{ Name: "\u52a8\u4f5c\u56de\u6b63" }] } } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    await mgr.playAction({ kind: "motion", group: "\u52a8\u4f5c#6", motionName: "Wink~" });
    expect(expressionMock).toHaveBeenCalledWith("Wink~");
  });

  it("swallows model errors and logs a warning", async () => {
    const { Live2DManager } = await import("./manager");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 100, height: 100, modelPath: "/x" });
    (mgr as unknown as { model: unknown }).model = {
      motion: vi.fn(async () => { throw new Error("boom"); }),
      expression: vi.fn(async () => { throw new Error("boom"); }),
      internalModel: { motionManager: { definitions: {} } },
      scale: { set: vi.fn() },
      anchor: { set: vi.fn() },
      x: 0, y: 0, width: 100, height: 100,
      destroy: vi.fn(),
    };

    await mgr.playAction({ kind: "expression", name: "X" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("dynamically updates --cyrene-top and --pet-zoom CSS variables on resize and zoom", async () => {
    const cssVars = new Map<string, string>();
    vi.stubGlobal("document", {
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => cssVars.set(k, v),
          getPropertyValue: (k: string) => cssVars.get(k) ?? "",
        },
      },
    });

    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 400, height: 500, modelPath: "/x" });
    (mgr as unknown as { app: unknown }).app = { renderer: { resize: vi.fn() } };
    const model = {
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      width: 400,
      height: 480,
      x: 200,
      y: 250,
      destroy: vi.fn(),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
      transform: { worldTransform: { apply: vi.fn() } },
    };
    (mgr as unknown as { model: unknown }).model = model;

    // Normal zoom 1.0 (window 400x500, model.y = 250)
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 500 });
    mgr.resize(400, 500);
    expect(cssVars.get("--cyrene-top")).toBe("209px");
    expect(cssVars.get("--cyrene-feet")).toBe("418px");
    expect(cssVars.get("--cyrene-bottom")).toBe("461px");
    expect(cssVars.get("--pet-zoom")).toBe("1");

    // Zoomed in 1.5x (window 600x750, model.y = 375, model.height = 720)
    vi.stubGlobal("window", { innerWidth: 600, innerHeight: 750 });
    model.height = 720;
    model.y = 375;
    mgr.applyZoom(1.5);
    expect(cssVars.get("--cyrene-top")).toBe("314px");
    expect(cssVars.get("--cyrene-feet")).toBe("627px");
    expect(cssVars.get("--pet-zoom")).toBe("1.5");

    // Zoomed out 0.6x (window 240x300, model.y = 150, model.height = 288)
    vi.stubGlobal("window", { innerWidth: 240, innerHeight: 300 });
    model.height = 288;
    model.y = 150;
    mgr.applyZoom(0.6);
    expect(cssVars.get("--cyrene-top")).toBe("126px");
    expect(cssVars.get("--cyrene-feet")).toBe("251px");
    expect(cssVars.get("--pet-zoom")).toBe("0.6");

    vi.unstubAllGlobals();
  });

  it("prefers Live2D drawable bounds for head flower or bangs when available", async () => {
    const { Live2DManager } = await import("./manager");
    const mgr = new Live2DManager({ canvas: fakeCanvas, width: 400, height: 500, modelPath: "/x" });

    const localTransformApply = vi.fn((pt: { x: number; y: number }, out: { x: number; y: number }) => {
      out.x = pt.x;
      out.y = pt.y;
    });
    const worldTransformApply = vi.fn((pt: { x: number; y: number }, out: { x: number; y: number }) => {
      out.x = pt.x;
      out.y = pt.y + 100; // Shift to screen space: 105 + 100 = 205
    });

    const model = {
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      width: 400,
      height: 480,
      x: 200,
      y: 250,
      destroy: vi.fn(),
      internalModel: {
        hitAreas: {
          "表情回正花": { index: 15 },
        },
        getDrawableBounds: vi.fn(() => ({ x: 190, y: 105, width: 20, height: 20 })),
        localTransform: { apply: localTransformApply },
      },
      transform: {
        worldTransform: { apply: worldTransformApply },
      },
    };
    (mgr as unknown as { model: unknown }).model = model;

    const headTop = mgr.resolveCyreneHeadTop();
    expect(headTop).toBe(205);
  });
});


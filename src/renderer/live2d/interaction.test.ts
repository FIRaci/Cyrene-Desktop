import { describe, expect, it, vi } from "vitest";
import { InteractionController, type HitAreaDef } from "./interaction";

class FakeCanvas {
  private readonly listeners = new Map<string, EventListener>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as EventListener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  dispatch(type: string, event: Partial<PointerEvent>): void {
    this.listeners.get(type)?.(event as PointerEvent);
  }
}

const head: HitAreaDef = {
  name: "Head",
  id: "HitAreaHead",
  group: "TapHead",
  motionName: "pat",
  motionIndex: 0,
};

describe("InteractionController modifier handling", () => {
  it("keeps a normal click as a Live2D head-pat interaction", async () => {
    const canvas = new FakeCanvas();
    const onTrigger = vi.fn();
    const model = {
      hitTest: vi.fn(() => ["Head"]),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => false),
      internalModel: { motionManager: { definitions: { TapHead: [{}] } } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onTrigger });

    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, altKey: false });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, altKey: false });
    expect(model.motion).toHaveBeenCalledWith("TapHead", 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(onTrigger).toHaveBeenCalledWith(head);
  });

  it("does not fire a head-pat while Alt is reserved for window dragging", async () => {
    const canvas = new FakeCanvas();
    const model = {
      hitTest: vi.fn(() => ["Head"]),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => false),
      internalModel: { motionManager: { definitions: { TapHead: [{}] } } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head]);

    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, altKey: true });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, altKey: true });
    await Promise.resolve();

    expect(model.hitTest).not.toHaveBeenCalled();
    expect(model.motion).not.toHaveBeenCalled();
  });

  it("keeps Alt-drag suppressed when Alt is released before pointerup", async () => {
    const canvas = new FakeCanvas();
    const onPetting = vi.fn();
    const model = {
      hitTest: vi.fn(() => []),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onPetting });
    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, altKey: true });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, altKey: false });
    await Promise.resolve();
    expect(model.hitTest).not.toHaveBeenCalled();
    expect(onPetting).not.toHaveBeenCalled();
  });

  it("triggers friendly petting reaction on normal click when no hit-area is matched", async () => {
    const canvas = new FakeCanvas();
    const onPetting = vi.fn();
    const model = {
      hitTest: vi.fn(() => []),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: { "\u52a8\u4f5c#6": [{ Name: "\u7b11\u4e00\u7b11\u5427~" }, { Name: "Wink~" }, { Name: "\u6211\u53ef\u7231\u5427~" }] } } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onPetting });

    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, altKey: false });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, altKey: false });
    await Promise.resolve();

    expect(model.hitTest).toHaveBeenCalledWith(10, 10);
    expect(onPetting).toHaveBeenCalled();
  });

  it("triggers onHeadPat when user rubs/strokes the head region", async () => {
    const canvas = new FakeCanvas();
    (canvas as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 300;
    (canvas as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 400;

    const onHeadPat = vi.fn();
    const model = {
      hitTest: vi.fn(() => []),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onHeadPat });

    // Pointer down at upper head area (y = 80 <= 400 * 0.55 = 220)
    canvas.dispatch("pointerdown", { clientX: 100, clientY: 80, altKey: false });

    // Stroke back and forth on head
    canvas.dispatch("pointermove", { clientX: 130, clientY: 82, altKey: false });
    canvas.dispatch("pointermove", { clientX: 90, clientY: 81, altKey: false });
    canvas.dispatch("pointermove", { clientX: 135, clientY: 83, altKey: false });

    expect(onHeadPat).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate onHeadPat or call onPetting during continuous hold", async () => {
    const canvas = new FakeCanvas();
    (canvas as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 300;
    (canvas as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 400;

    const onHeadPat = vi.fn();
    const onPetting = vi.fn();
    const model = {
      hitTest: vi.fn(() => []),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], {
      onHeadPat,
      onPetting,
    });

    // Pointer down at upper head area
    canvas.dispatch("pointerdown", { clientX: 100, clientY: 80, altKey: false });

    // Continuous rubbing stroke
    canvas.dispatch("pointermove", { clientX: 135, clientY: 82, altKey: false });
    canvas.dispatch("pointermove", { clientX: 85, clientY: 81, altKey: false });
    canvas.dispatch("pointermove", { clientX: 140, clientY: 83, altKey: false });

    // More movement while still holding down
    canvas.dispatch("pointermove", { clientX: 80, clientY: 80, altKey: false });
    canvas.dispatch("pointermove", { clientX: 145, clientY: 80, altKey: false });

    // Release
    canvas.dispatch("pointerup", { clientX: 145, clientY: 80, altKey: false });

    // Must be called exactly once, and onPetting must not be invoked
    expect(onHeadPat).toHaveBeenCalledTimes(1);
    expect(onPetting).not.toHaveBeenCalled();
  });

  it("ignores right-click (button === 2) so context menu does not trigger petting or hit gestures", async () => {
    const canvas = new FakeCanvas();
    const onPetting = vi.fn();
    const onTrigger = vi.fn();
    const model = {
      hitTest: vi.fn(() => ["Head"]),
      motion: vi.fn(async () => true),
      expression: vi.fn(async () => true),
      internalModel: { motionManager: { definitions: {} } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onPetting, onTrigger });

    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, button: 2, altKey: false });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, button: 2, altKey: false });
    await Promise.resolve();

    expect(model.hitTest).not.toHaveBeenCalled();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(onPetting).not.toHaveBeenCalled();
  });
});

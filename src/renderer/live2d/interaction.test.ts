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
      internalModel: { motionManager: { definitions: { "动作#6": [{ Name: "笑一笑吧~" }, { Name: "Wink~" }, { Name: "我可爱吧~" }] } } },
    };
    new InteractionController(canvas as unknown as HTMLCanvasElement, model as never, [head], { onPetting });

    canvas.dispatch("pointerdown", { clientX: 10, clientY: 10, altKey: false });
    canvas.dispatch("pointerup", { clientX: 10, clientY: 10, altKey: false });
    await Promise.resolve();

    expect(model.hitTest).toHaveBeenCalledWith(10, 10);
    expect(onPetting).toHaveBeenCalled();
  });
});

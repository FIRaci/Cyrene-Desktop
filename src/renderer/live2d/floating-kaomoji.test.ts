import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FloatingKaomojiController } from "./floating-kaomoji";

function createFakeElement(tag: string): any {
  const children: any[] = [];
  const classList = new Set<string>();
  const style: Record<string, any> = {
    setProperty: vi.fn(),
    left: "",
    top: "",
  };
  let _className = "";
  const el: any = {
    tagName: tag,
    textContent: "",
    children,
    get className() {
      return _className;
    },
    set className(val: string) {
      _className = val;
      classList.clear();
      val.split(/\s+/).filter(Boolean).forEach((c) => classList.add(c));
    },
    classList: {
      add: (c: string) => classList.add(c),
      contains: (c: string) => classList.has(c),
    },
    style,
    appendChild: (child: any) => {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    removeChild: (child: any) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    remove: () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    parentNode: null,
  };
  return el;
}

describe("FloatingKaomojiController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFakeElement(tag),
      getElementById: () => null,
      body: createFakeElement("body"),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("spawns kaomoji particles into the container", () => {
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    const el = controller.spawn("(｡♥‿♥｡)", 100, 200);
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("(｡♥‿♥｡)");
    expect(el?.classList.contains("pet-kaomoji")).toBe(true);
    expect(container.children.length).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(container.children.length).toBe(0);

    controller.dispose();
  });

  it("spawns burst of kaomoji particles over time", () => {
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    controller.spawnBurst(3, 150, 250);
    vi.advanceTimersByTime(0);
    expect(container.children.length).toBe(1);

    vi.advanceTimersByTime(200);
    expect(container.children.length).toBe(2);

    vi.advanceTimersByTime(200);
    expect(container.children.length).toBe(3);

    controller.dispose();
  });

  it("does not spawn after being disposed", () => {
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);
    controller.dispose();

    const el = controller.spawn("test");
    expect(el).toBeNull();
  });

  it("keeps kaomoji coordinates strictly within window boundaries and clear of edges", () => {
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 500 });
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    for (let i = 0; i < 20; i++) {
      const leftEl = controller.spawn("(੭ु´͈ ᐜ `͈)੭ु⁾⁾", 50, 200);
      const leftX = parseInt(leftEl?.style.left || "0", 10);
      expect(leftX).toBeGreaterThanOrEqual(81);
      expect(leftX).toBeLessThanOrEqual(140);

      const rightEl = controller.spawn("(੭ु´͈ ᐜ `͈)੭ु⁾⁾", 350, 200);
      const rightX = parseInt(rightEl?.style.left || "0", 10);
      expect(rightX).toBeGreaterThanOrEqual(265);
      expect(rightX).toBeLessThanOrEqual(319);
    }

    controller.dispose();
  });

  it("spawns specialized music and idle mood kaomojis", () => {
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    const musicEl = controller.spawnMusic();
    expect(musicEl).not.toBeNull();
    expect(musicEl?.classList.contains("pet-kaomoji")).toBe(true);

    const swingEl = controller.spawnIdle("swing");
    expect(swingEl).not.toBeNull();

    const winkEl = controller.spawnIdle("wink");
    expect(winkEl).not.toBeNull();

    const smileEl = controller.spawnIdle("smile");
    expect(smileEl).not.toBeNull();

    expect(container.children.length).toBe(4);
    controller.dispose();
  });
});

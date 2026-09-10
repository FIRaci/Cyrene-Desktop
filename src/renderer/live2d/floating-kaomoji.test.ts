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
    FloatingKaomojiController.globalLastSpawnTimestamp = 0;
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFakeElement(tag),
      getElementById: () => null,
      body: createFakeElement("body"),
    });
  });

  afterEach(() => {
    FloatingKaomojiController.globalLastSpawnTimestamp = 0;
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

  it("debounces rapid successive spawn calls within MIN_SPAWN_INTERVAL_MS", () => {
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    const first = controller.spawn("(｡♥‿♥｡)", 100, 200);
    expect(first).not.toBeNull();

    // Immediate second call should be blocked by cooldown
    const second = controller.spawn("(≧◡≦) ♡", 100, 200);
    expect(second).toBeNull();
    expect(container.children.length).toBe(1);

    // After MIN_SPAWN_INTERVAL_MS, spawning is allowed again
    vi.advanceTimersByTime(FloatingKaomojiController.MIN_SPAWN_INTERVAL_MS + 10);
    const third = controller.spawn("(≧◡≦) ♡", 100, 200);
    expect(third).not.toBeNull();
    // Exactly 1 visible particle since previous was removed by 1900ms timer and DOM cleanup
    expect(container.children.length).toBe(1);

    controller.dispose();
  });

  it("enforces global debounce across different FloatingKaomojiController instances", () => {
    const container1 = createFakeElement("div");
    const container2 = createFakeElement("div");
    const c1 = new FloatingKaomojiController(container1);
    const c2 = new FloatingKaomojiController(container2);
    c1.resetCooldown();

    const first = c1.spawn("(｡♥‿♥｡)", 100, 200);
    expect(first).not.toBeNull();

    // c2 should be blocked even though it is a separate instance
    const second = c2.spawn("(≧◡≦) ♡", 100, 200);
    expect(second).toBeNull();

    c1.dispose();
    c2.dispose();
  });

  it("keeps kaomoji coordinates strictly within window boundaries and clear of edges", () => {
    vi.stubGlobal("window", { innerWidth: 400, innerHeight: 500 });
    const container = createFakeElement("div");
    const controller = new FloatingKaomojiController(container);

    for (let i = 0; i < 20; i++) {
      controller.resetCooldown();
      const leftEl = controller.spawn("(੭ु´͈ ᐜ `͈)੭ु⁾⁾", 50, 200);
      const leftX = parseInt(leftEl?.style.left || "0", 10);
      expect(leftX).toBeGreaterThanOrEqual(81);
      expect(leftX).toBeLessThanOrEqual(140);

      controller.resetCooldown();
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

    controller.resetCooldown();
    const swingEl = controller.spawnIdle("swing");
    expect(swingEl).not.toBeNull();

    controller.resetCooldown();
    const winkEl = controller.spawnIdle("wink");
    expect(winkEl).not.toBeNull();

    controller.resetCooldown();
    const smileEl = controller.spawnIdle("smile");
    expect(smileEl).not.toBeNull();

    // Exactly 1 visible particle because stale particles are cleaned up on each new non-forced spawn
    expect(container.children.length).toBe(1);
    controller.dispose();
  });
});

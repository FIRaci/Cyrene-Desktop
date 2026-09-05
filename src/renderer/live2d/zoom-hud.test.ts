import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PetZoomHudController } from "./zoom-hud";

function createFakeElement(tag: string): any {
  const children: any[] = [];
  const classList = new Set<string>();
  const attributes = new Map<string, string>();
  const queriedMap = new Map<string, any>();

  const el: any = {
    tagName: tag,
    id: "",
    textContent: "",
    children,
    classList: {
      add: (c: string) => classList.add(c),
      remove: (c: string) => classList.delete(c),
      contains: (c: string) => classList.has(c),
    },
    setAttribute: (name: string, val: string) => attributes.set(name, val),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    querySelector: (sel: string) => {
      if (queriedMap.has(sel)) return queriedMap.get(sel);
      const child = createFakeElement(sel.includes("span") ? "span" : "div");
      queriedMap.set(sel, child);
      return child;
    },
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
    parentNode: null,
  };
  return el;
}

describe("PetZoomHudController", () => {
  let body: any;

  beforeEach(() => {
    body = createFakeElement("body");
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFakeElement(tag),
      body,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts to DOM and displays formatted percentage", () => {
    const hud = new PetZoomHudController(body);
    expect(hud.isVisible()).toBe(false);

    hud.show(1.2);
    expect(hud.isVisible()).toBe(true);

    const textEl = (hud as any).textElement;
    expect(textEl.textContent).toBe("120%");

    // Advances timer to auto fade
    vi.advanceTimersByTime(1200);
    expect(hud.isVisible()).toBe(false);

    hud.dispose();
    expect(body.children.length).toBe(0);
  });

  it("resets fade timer on rapid consecutive zoom updates", () => {
    const hud = new PetZoomHudController(body);

    hud.show(1.0);
    expect(hud.isVisible()).toBe(true);

    // 600ms passed
    vi.advanceTimersByTime(600);
    expect(hud.isVisible()).toBe(true);

    // Next zoom update
    hud.show(1.1);
    expect(hud.isVisible()).toBe(true);
    expect((hud as any).textElement.textContent).toBe("110%");

    // Another 600ms passed (total 1200ms from start, but timer was reset)
    vi.advanceTimersByTime(600);
    expect(hud.isVisible()).toBe(true);

    // Another 600ms passed (reaches new 1200ms threshold)
    vi.advanceTimersByTime(600);
    expect(hud.isVisible()).toBe(false);

    hud.dispose();
  });

  it("handles min and max zoom limits correctly", () => {
    const hud = new PetZoomHudController(body);

    hud.show(0.5);
    expect((hud as any).textElement.textContent).toBe("50%");

    hud.show(2.0);
    expect((hud as any).textElement.textContent).toBe("200%");

    hud.dispose();
  });
});

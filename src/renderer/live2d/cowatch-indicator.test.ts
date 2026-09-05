import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PetCoWatchIndicator } from "./cowatch-indicator";

function createFakeElement(tag: string): any {
  const children: any[] = [];
  const classList = new Set<string>();
  const attributes = new Map<string, string>();
  const listeners = new Map<string, ((...args: any[]) => void)[]>();

  const el: any = {
    tagName: tag,
    id: "",
    get className() {
      return Array.from(classList).join(" ");
    },
    set className(val: string) {
      classList.clear();
      val.split(/\s+/).filter(Boolean).forEach((c) => classList.add(c));
    },
    title: "",
    textContent: "",
    innerHTML: "",
    children,
    style: { display: "" },
    offsetWidth: 100,
    classList: {
      add: (c: string) => classList.add(c),
      remove: (c: string) => classList.delete(c),
      contains: (c: string) => classList.has(c),
    },
    setAttribute: (name: string, val: string) => attributes.set(name, val),
    getAttribute: (name: string) => attributes.get(name) ?? null,
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
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    },
    addEventListener: (event: string, cb: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    },
    trigger: (event: string, ...args: any[]) => {
      listeners.get(event)?.forEach((cb) => cb(...args));
    },
    querySelector: (sel: string) => {
      const search = (node: any): any => {
        if (sel.startsWith("#") && node.id === sel.slice(1)) return node;
        if (sel.startsWith(".") && node.classList.contains(sel.slice(1))) return node;
        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(el);
    },
    parentNode: null,
  };
  return el;
}

describe("PetCoWatchIndicator", () => {
  let body: any;

  beforeEach(() => {
    body = createFakeElement("body");
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFakeElement(tag),
      body,
    });
    vi.stubGlobal("window", {
      cyrene: {
        toggleCoWatch: vi.fn().mockResolvedValue(true),
        getCoWatchState: vi.fn().mockResolvedValue({ active: false, status: "idle" }),
        onCoWatchStateChanged: vi.fn().mockReturnValue(() => {}),
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("mounts badge to container with initial hidden state", () => {
    const indicator = new PetCoWatchIndicator(body);
    const badge = body.querySelector("#pet-cowatch-badge");

    expect(badge).not.toBeNull();
    expect(indicator.isVisible()).toBe(false);

    indicator.dispose();
  });

  it("shows badge and updates icon and text on active state", () => {
    const indicator = new PetCoWatchIndicator(body);

    indicator.update({ active: true, status: "idle" });
    expect(indicator.isVisible()).toBe(true);

    const icon = body.querySelector(".pet-cowatch-badge__icon");
    const text = body.querySelector(".pet-cowatch-badge__text");
    expect(icon?.innerHTML).toContain("pet-cowatch-icon--idle");
    expect(icon?.innerHTML).toContain("<svg");
    expect(text?.textContent).toBe("Co-Watching");

    indicator.dispose();
  });

  it("updates to capturing state when capture starts", () => {
    const indicator = new PetCoWatchIndicator(body);

    indicator.update({ active: true, status: "capturing" });
    expect(indicator.isVisible()).toBe(true);

    const badge = body.querySelector("#pet-cowatch-badge");
    const icon = body.querySelector(".pet-cowatch-badge__icon");
    const text = body.querySelector(".pet-cowatch-badge__text");

    expect(badge?.classList.contains("status-capturing")).toBe(true);
    expect(icon?.innerHTML).toContain("pet-cowatch-icon--capturing");
    expect(text?.textContent).toBe("Capturing...");

    indicator.dispose();
  });

  it("updates to analyzing state when thinking", () => {
    const indicator = new PetCoWatchIndicator(body);

    indicator.update({ active: true, status: "analyzing" });
    const icon = body.querySelector(".pet-cowatch-badge__icon");
    const text = body.querySelector(".pet-cowatch-badge__text");

    expect(icon?.innerHTML).toContain("pet-cowatch-icon--analyzing");
    expect(text?.textContent).toBe("Thinking...");

    indicator.dispose();
  });

  it("updates to reacting and error states", () => {
    const indicator = new PetCoWatchIndicator(body);

    indicator.update({ active: true, status: "reacting" });
    let icon = body.querySelector(".pet-cowatch-badge__icon");
    let text = body.querySelector(".pet-cowatch-badge__text");
    expect(icon?.innerHTML).toContain("pet-cowatch-icon--reacting");
    expect(text?.textContent).toBe("Observing");

    indicator.update({ active: true, status: "error", errorMessage: "Failed to connect" });
    icon = body.querySelector(".pet-cowatch-badge__icon");
    text = body.querySelector(".pet-cowatch-badge__text");
    expect(icon?.innerHTML).toContain("pet-cowatch-icon--error");
    expect(text?.textContent).toBe("Observation Issue");

    indicator.dispose();
  });

  it("hides badge when active becomes false", () => {
    const indicator = new PetCoWatchIndicator(body);

    indicator.update({ active: true, status: "idle" });
    expect(indicator.isVisible()).toBe(true);

    indicator.update({ active: false, status: "idle" });
    expect(indicator.isVisible()).toBe(false);

    vi.advanceTimersByTime(400);
    const badge = body.querySelector("#pet-cowatch-badge");
    expect(badge.style.display).toBe("none");

    indicator.dispose();
  });

  it("disposes cleanly and removes badge element from DOM", () => {
    const indicator = new PetCoWatchIndicator(body);
    indicator.dispose();

    expect(body.querySelector("#pet-cowatch-badge")).toBeNull();
  });
});

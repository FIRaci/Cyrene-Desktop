import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock document and DOM elements for Node environment
class MockElement {
  id: string = "";
  className: string = "";
  innerHTML: string = "";
  textContent: string = "";
  value: string = "";
  placeholder: string = "";
  disabled: boolean = false;
  style: Record<string, string> = {};
  classList = {
    add: vi.fn((cls: string) => {
      if (!this.className.includes(cls)) this.className += ` ${cls}`;
    }),
    remove: vi.fn((cls: string) => {
      this.className = this.className.replace(new RegExp(`\\b${cls}\\b`, "g"), "").trim();
    }),
    contains: vi.fn((cls: string) => this.className.includes(cls)),
  };
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  addEventListener(event: string, handler: (...args: unknown[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event: string, handler: (...args: unknown[]) => void) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
  }

  dispatchEvent(event: { type: string; [key: string]: unknown }) {
    const list = this.listeners[event.type] || [];
    for (const handler of list) {
      handler(event);
    }
  }

  focus = vi.fn();
  select = vi.fn();

  querySelector(sel: string): MockElement | null {
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      return elementsById[id] || null;
    }
    return null;
  }
}

let elementsById: Record<string, MockElement> = {};
let bodyChildren: MockElement[] = [];

beforeEach(() => {
  elementsById = {
    "cy-modal-icon": new MockElement(),
    "cy-modal-title": new MockElement(),
    "cy-modal-message": new MockElement(),
    "cy-modal-input": new MockElement(),
    "cy-modal-cancel": new MockElement(),
    "cy-modal-confirm": new MockElement(),
  };
  bodyChildren = [];

  (globalThis as unknown as { document: unknown }).document = {
    getElementById: vi.fn((id: string) => elementsById[id] || null),
    createElement: vi.fn((_tag: string) => {
      const el = new MockElement();
      return el;
    }),
    body: {
      appendChild: vi.fn((el: MockElement) => {
        bodyChildren.push(el);
        if (el.id) elementsById[el.id] = el;
      }),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("modal system", () => {
  it("shows confirmation and resolves true when confirmed", async () => {
    const { showConfirm } = await import("./modal");

    const confirmPromise = showConfirm({
      title: "Test Confirm",
      message: "Are you sure?",
      confirmText: "Yes",
      cancelText: "No",
    });

    const titleEl = elementsById["cy-modal-title"];
    const msgEl = elementsById["cy-modal-message"];
    const confirmBtn = elementsById["cy-modal-confirm"];

    expect(titleEl.textContent).toBe("Test Confirm");
    expect(msgEl.textContent).toBe("Are you sure?");
    expect(confirmBtn.textContent).toBe("Yes");

    // Click confirm
    confirmBtn.dispatchEvent({ type: "click", preventDefault: vi.fn() });

    const result = await confirmPromise;
    expect(result).toBe(true);
  });

  it("shows confirmation and resolves false when cancelled", async () => {
    const { showConfirm } = await import("./modal");

    const confirmPromise = showConfirm("Simple message");

    const titleEl = elementsById["cy-modal-title"];
    const cancelBtn = elementsById["cy-modal-cancel"];

    expect(titleEl.textContent).toBe("Confirmation");

    // Click cancel
    cancelBtn.dispatchEvent({ type: "click", preventDefault: vi.fn() });

    const result = await confirmPromise;
    expect(result).toBe(false);
  });

  it("shows alert and hides cancel button", async () => {
    const { showAlert } = await import("./modal");

    const alertPromise = showAlert("Operation complete");

    const cancelBtn = elementsById["cy-modal-cancel"];
    const confirmBtn = elementsById["cy-modal-confirm"];

    expect(cancelBtn.style.display).toBe("none");
    expect(confirmBtn.textContent).toBe("OK");

    // Click confirm (OK)
    confirmBtn.dispatchEvent({ type: "click", preventDefault: vi.fn() });

    await alertPromise;
  });

  it("shows prompt and returns user input value", async () => {
    const { showPrompt } = await import("./modal");

    const promptPromise = showPrompt({
      title: "Rename Session",
      message: "Enter new name:",
      defaultValue: "Original Name",
    });

    const inputEl = elementsById["cy-modal-input"];
    const confirmBtn = elementsById["cy-modal-confirm"];

    expect(inputEl.value).toBe("Original Name");

    // User types new text
    inputEl.value = "Updated Name";
    confirmBtn.dispatchEvent({ type: "click", preventDefault: vi.fn() });

    const result = await promptPromise;
    expect(result).toBe("Updated Name");
  });
});

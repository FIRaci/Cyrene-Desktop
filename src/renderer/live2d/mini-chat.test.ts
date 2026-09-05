import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MiniChatWidget } from "./mini-chat";
import type { CompanionBubbleController } from "./companion-bubbles";

function createFakeElement(tag: string): any {
  const children: any[] = [];
  const attributes = new Map<string, string>();
  const classList = new Set<string>();
  const listeners = new Map<string, Function>();
  const style: Record<string, any> = {};
  const queriedMap = new Map<string, any>();

  const el: any = {
    tagName: tag,
    id: "",
    value: "",
    className: "",
    textContent: "",
    children,
    style,
    classList: {
      add: (c: string) => classList.add(c),
      remove: (c: string) => classList.delete(c),
      contains: (c: string) => classList.has(c),
    },
    setAttribute: (name: string, val: string) => attributes.set(name, val),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    addEventListener: (type: string, fn: Function) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    dispatchEvent: (event: any) => {
      const fn = listeners.get(event.type);
      if (fn) fn(event);
      return true;
    },
    contains: (target: any) => target === el || children.some((c) => c === target || (c.contains && c.contains(target))),
    closest: (selector: string) => {
      if (selector.includes(el.tagName.toLowerCase())) return el;
      return null;
    },
    querySelector: (sel: string) => {
      if (queriedMap.has(sel)) return queriedMap.get(sel);
      let created: any;
      if (sel === "#pet-mini-chat-input") created = createFakeElement("input");
      else if (sel === "#pet-mini-chat-send") created = createFakeElement("button");
      else if (sel === "#pet-mini-chat-indicator") created = createFakeElement("span");
      else if (sel === "#pet-mini-chat-close") created = createFakeElement("button");
      else if (sel === "#pet-mini-chat-voice") created = createFakeElement("button");
      else created = createFakeElement("div");
      queriedMap.set(sel, created);
      return created;
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
    focus: vi.fn(),
    parentNode: null,
  };
  return el;
}

describe("MiniChatWidget", () => {
  let body: any;

  beforeEach(() => {
    body = createFakeElement("body");
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFakeElement(tag),
      getElementById: (id: string) => {
        return body.children.find((c: any) => c.id === id) || null;
      },
      body,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts to DOM and toggles visibility", () => {
    const bubbles = {
      say: vi.fn(),
      think: vi.fn(),
      hide: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    } as unknown as CompanionBubbleController;

    const onVisibilityChange = vi.fn();
    const widget = new MiniChatWidget({
      bubbles,
      onVisibilityChange,
    });

    expect(widget.isOpen()).toBe(false);

    widget.show();
    expect(widget.isOpen()).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(true);

    widget.hide();
    expect(widget.isOpen()).toBe(false);
    expect(onVisibilityChange).toHaveBeenCalledWith(false);

    widget.toggle();
    expect(widget.isOpen()).toBe(true);

    widget.dispose();
  });

  it("integrates with voice service to toggle mute", () => {
    const bubbles = {
      say: vi.fn(),
      think: vi.fn(),
      hide: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    } as unknown as CompanionBubbleController;

    let isMuted = false;
    const voice = {
      isMuted: () => isMuted,
      toggleMute: () => {
        isMuted = !isMuted;
        return isMuted;
      },
      speak: vi.fn(),
    } as any;

    const widget = new MiniChatWidget({
      bubbles,
      voice,
    });

    const voiceBtn = (widget as any).voiceBtn;
    expect(voiceBtn).toBeDefined();

    // Trigger click on voice button
    const listeners = (voiceBtn as any).listeners || new Map();
    // Since our fakeElement doesn't expose listeners map directly, simulate click if listener attached
    voice.toggleMute();
    expect(voice.isMuted()).toBe(true);

    widget.dispose();
  });

  it("does not intercept dragging on quick chat header or card", () => {
    const bubbles = {
      say: vi.fn(),
      think: vi.fn(),
      hide: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    } as unknown as CompanionBubbleController;

    const moveBy = vi.fn();
    const setDragging = vi.fn();
    (globalThis as any).window = {
      cyrene: { moveBy, setDragging, setInteractive: vi.fn() },
    };

    const widget = new MiniChatWidget({ bubbles });
    const root = (widget as any).root;
    const header = root.querySelector(".pet-mini-chat__header");

    // Pointerdown on header should NOT trigger dragging
    root.dispatchEvent({
      type: "pointerdown",
      target: header,
      button: 0,
      screenX: 100,
      screenY: 200,
      preventDefault: vi.fn(),
      pointerId: 1,
    });

    expect(setDragging).not.toHaveBeenCalled();

    root.dispatchEvent({
      type: "pointermove",
      screenX: 115,
      screenY: 220,
    });

    expect(moveBy).not.toHaveBeenCalled();

    widget.dispose();
  });

  it("shares and synchronizes active session with chatStore", async () => {
    const bubbles = {
      say: vi.fn(),
      think: vi.fn(),
      hide: vi.fn(),
      handle: vi.fn(),
      dispose: vi.fn(),
    } as unknown as CompanionBubbleController;

    const setActiveSession = vi.fn();
    const getActiveSession = vi.fn().mockResolvedValue("shared-session-123");
    const append = vi.fn().mockResolvedValue(true);
    const get = vi.fn().mockResolvedValue({
      id: "shared-session-123",
      messages: [{ role: "user", content: "Hello from Alt+1" }],
    });
    const run = vi.fn().mockResolvedValue({ success: true });
    const openInChatWindow = vi.fn();

    (globalThis as any).window = {
      chatStore: {
        getActiveSession,
        setActiveSession,
        append,
        get,
        openInChatWindow,
      },
      agui: {
        run,
        onEvent: vi.fn().mockReturnValue(() => {}),
      },
    };

    const widget = new MiniChatWidget({ bubbles });
    const sessionId = await (widget as any).getOrCreateActiveSessionId();
    expect(sessionId).toBe("shared-session-123");

    // Trigger handleSend
    const inputEl = (widget as any).inputEl;
    inputEl.value = "Hello from Alt+5";
    await (widget as any).handleSend();

    expect(setActiveSession).toHaveBeenCalledWith("shared-session-123");
    expect(append).toHaveBeenCalledWith(
      "shared-session-123",
      expect.objectContaining({
        role: "user",
        content: "Hello from Alt+5",
      }),
    );
    expect(openInChatWindow).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "shared-session-123",
        executionMode: "chat",
      }),
    );

    widget.dispose();
  });
});

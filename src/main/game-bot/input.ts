// input — keyboard and mouse control (@nut-tree-fork/nut-js).
// High-risk operation: controls user mouse and keyboard. Used solely by game-bot engine behind permission gateway.
//
// Note: nut.js is a native module requiring electron-rebuild.
// If native module errors occur, koffi + user32 SendInput serves as fallback.

import { mouse, Point, keyboard, Key } from "@nut-tree-fork/nut-js";

/** Special key name -> nut.js Key. Single letters (A-Z) parsed dynamically. */
const KEY_MAP: Record<string, Key> = {
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Escape: Key.Escape, Esc: Key.Escape, Enter: Key.Enter, Return: Key.Enter,
  Space: Key.Space, Tab: Key.Tab, Backspace: Key.Backspace, Delete: Key.Delete,
  Alt: Key.LeftAlt, Ctrl: Key.LeftControl, Control: Key.LeftControl, Shift: Key.LeftShift,
  Win: Key.LeftSuper, Meta: Key.LeftSuper,
};

/** Key name -> Key. Supports F1-12 / Escape / Enter / modifiers / letters A-Z. Returns null if unknown. */
function resolveKey(name: string): Key | null {
  const upper = name.trim();
  if (KEY_MAP[upper] !== undefined) return KEY_MAP[upper];
  if (/^[A-Z]$/.test(upper)) {
    const k = (Key as unknown as Record<string, Key>)[upper];
    return k ?? null;
  }
  return null;
}

/** Moves to (x,y) and clicks left mouse button once. */
export async function click(x: number, y: number): Promise<void> {
  await mouse.setPosition(new Point(x, y));
  await mouse.leftClick();
}

/** Clicks screen center. */
export async function clickCenter(width: number, height: number): Promise<void> {
  await click(Math.floor(width / 2), Math.floor(height / 2));
}

/** Presses key combo. combo shaped like "F4" / "Alt+F4" / "Escape" / "V". */
export async function keyPress(combo: string): Promise<void> {
  const parts = combo.split("+").map(s => s.trim());
  const keys = parts.map(resolveKey).filter((k): k is Key => k !== null);
  if (keys.length === 0) {
    console.warn("[GameBot] Unknown key combination; skipping:", combo);
    return;
  }
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...keys.slice().reverse());
}

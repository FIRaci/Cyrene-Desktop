// Todo list store - Persistence layer behind todo_write tool.
//
// Design:
// - Holds current TodoState in memory, persists to userData/current-todos.json on each setTodos
// - Listener pattern: other main process modules (index.ts) subscribe to changes and forward CUSTOM events to renderer
// - loadTodos() at launch restores previous unfinished tasks from disk (persists across restarts)
//
// Non-goals:
// - No multi-list / multi-session isolation (a single active list suffices for current product)
// - No historical versions (overwrite writes, simple and stable)

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority?: TodoPriority;
}

export interface TodoState {
  todos: TodoItem[];
  updatedAt: number;
}

const EMPTY_STATE: TodoState = { todos: [], updatedAt: 0 };

let current: TodoState = { ...EMPTY_STATE };
let listeners: Array<(s: TodoState) => void> = [];
let loaded = false;

function todoFilePath(): string {
  return path.join(app.getPath("userData"), "current-todos.json");
}

function persist(): void {
  try {
    fs.writeFileSync(todoFilePath(), JSON.stringify(current, null, 2), "utf8");
  } catch (e) {
    console.warn("[TodoStore] persist failed:", e);
  }
}

/** Call once at startup to restore unfinished tasks from disk. */
export function loadTodos(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(todoFilePath(), "utf8");
    const parsed = JSON.parse(raw) as TodoState;
    if (parsed && Array.isArray(parsed.todos)) {
      current = parsed;
      console.log("[TodoStore] Restored " + current.todos.length + " unfinished tasks");
    }
  } catch {
    current = { ...EMPTY_STATE };
  }
}

/** Full overwrite write (called by todo_write tool). Returns updated state. */
export function setTodos(todos: TodoItem[]): TodoState {
  // Lightweight validation: discard items missing required fields
  const valid = todos.filter(t => t && typeof t.id === "string" && typeof t.content === "string");
  current = { todos: valid, updatedAt: Date.now() };
  persist();
  for (const l of listeners) {
    try { l(current); } catch (e) { console.warn("[TodoStore] listener error:", e); }
  }
  return current;
}

export function getTodos(): TodoState {
  return current;
}

export function clearTodos(): void {
  current = { todos: [], updatedAt: Date.now() };
  persist();
  for (const l of listeners) {
    try { l(current); } catch (e) { console.warn("[TodoStore] listener error:", e); }
  }
}

/** Subscribe to changes. Returns unsubscribe function. */
export function onTodosChange(cb: (s: TodoState) => void): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter(l => l !== cb); };
}

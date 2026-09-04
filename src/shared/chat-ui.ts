// Shared presentation helpers for chat session lists in Settings and Chat.
//
// Keep only presentation types, constants, and pure functions here. Each entry
// point builds its own DOM and interactions, while sharing time and label rules.

export interface ChatSessionMetaUI {
  id: string;
  title: string;
  identityId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  purpose?: "proactive-chat";
}

// Default identity label until identity-specific presentation is available.

// Compact relative time: now, minutes, today/yesterday, days, or a date.
export function formatChatRelativeTime(at: number): string {
  const now = Date.now();
  const diff = now - at;
  if (diff < 0) {
    // If the clock moved backwards, fall back to an absolute time.
    const d = new Date(at);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (diff < 60_000) return "Just now";
  if (diff < 60 * 60_000) return Math.floor(diff / 60_000) + " min ago";

  const target = new Date(at);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.floor((startOfDay(today) - startOfDay(target)) / (24 * 3600 * 1000));

  const hh = String(target.getHours()).padStart(2, "0");
  const mm = String(target.getMinutes()).padStart(2, "0");
  if (dayDiff === 0) return `Today ${hh}:${mm}`;
  if (dayDiff === 1) return `Yesterday ${hh}:${mm}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;

  const sameYear = target.getFullYear() === today.getFullYear();
  const md = `${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  return sameYear ? md : `${target.getFullYear()}-${md}`;
}

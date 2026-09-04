import type { SocialAtom } from "./types";

export function compileSocialContextBlock(atoms: readonly SocialAtom[]): string {
  if (atoms.length === 0) return "";
  const past = atoms.filter((atom) => atom.type !== "open_loop").slice(0, 5);
  const openLoops = atoms.filter((atom) => atom.type === "open_loop").slice(0, 5);
  const lines = [
    "[AVAILABLE CONVERSATION CONTEXT]",
    "Use this naturally only when genuinely relevant. Do not repeat this context or emphasize that you have memory.",
  ];
  if (past.length > 0) {
    lines.push("Relevant history:", ...past.map((atom) => `- ${atom.content}`));
  }
  if (openLoops.length > 0) {
    lines.push("Open threads:", ...openLoops.map((atom) => `- ${atom.content}`));
  }
  return lines.join("\n");
}


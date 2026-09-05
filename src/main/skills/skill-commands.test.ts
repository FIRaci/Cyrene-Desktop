import { describe, it, expect } from "vitest";
import { parseSlashCommand } from "./skill-commands";

const KNOWN = ["write-expense-report", "code-review"];

describe("parseSlashCommand", () => {
  it("returns id when matching known /skill-id", () => {
    expect(parseSlashCommand("/write-expense-report", KNOWN)).toEqual({ hit: true, skillId: "write-expense-report" });
  });

  it("recognizes match even with remaining text", () => {
    expect(parseSlashCommand("/write-expense-report generate for this month", KNOWN)).toEqual({ hit: true, skillId: "write-expense-report" });
  });

  it("passes through unknown /commands not in known skill list", () => {
    expect(parseSlashCommand("/help", KNOWN)).toEqual({ hit: false });
    expect(parseSlashCommand("/unknown-skill", KNOWN)).toEqual({ hit: false });
  });

  it("passes through regular text", () => {
    expect(parseSlashCommand("help me track expenses", KNOWN)).toEqual({ hit: false });
  });

  it("passes through non-kebab-case / prefixes (path traversal/uppercase protection)", () => {
    expect(parseSlashCommand("/../etc/passwd", KNOWN)).toEqual({ hit: false });
    expect(parseSlashCommand("/Write_Expense", KNOWN)).toEqual({ hit: false });
  });

  it("does not match / with leading whitespace", () => {
    expect(parseSlashCommand("/ something", KNOWN)).toEqual({ hit: false });
  });

  it("does not match //x or /id/extra to prevent swallowing", () => {
    expect(parseSlashCommand("//x", KNOWN)).toEqual({ hit: false });
    expect(parseSlashCommand("/write-expense-report/extra", KNOWN)).toEqual({ hit: false });
  });

  it("passes through any /id when known list is empty", () => {
    expect(parseSlashCommand("/write-expense-report", [])).toEqual({ hit: false });
  });
});

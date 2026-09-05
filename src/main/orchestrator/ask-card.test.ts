import { describe, expect, it } from "vitest";
import { buildAskCard, validateAskUserAnswer } from "./ask-card";

describe("buildAskCard", () => {
  it("adds one Runtime-owned custom option last and never exceeds four options", () => {
    const card = buildAskCard({
      intro: "Friend, I still need you to make a choice.",
      questions: [{
        field: "format",
        question: "Which format do you prefer?",
        type: "single_select",
        options: [
          { value: "word", label: "Word Document" },
          { value: "markdown", label: "Markdown Document" },
          { value: "pdf", label: "PDF Document" },
          { value: "excel", label: "Excel Spreadsheet" },
        ],
        allowCustom: true,
        freeTextPlaceholder: "Enter another format",
      }],
      deferredFields: [],
    });

    expect(card.questions[0].options).toEqual([
      { value: "word", label: "Word Document" },
      { value: "markdown", label: "Markdown Document" },
      { value: "pdf", label: "PDF Document" },
      { value: "__custom__", label: "Other — I'll enter it myself" },
    ]);
  });

  it("rejects answer values that were not presented by Runtime", () => {
    const card = buildAskCard({
      intro: "Friend, I still need you to make a choice.",
      questions: [{
        field: "format",
        question: "Which format do you prefer?",
        type: "single_select",
        options: [{ value: "word", label: "Word Document" }],
        allowCustom: true,
        freeTextPlaceholder: "Enter another format",
      }],
      deferredFields: [],
    });

    expect(() => validateAskUserAnswer(card, "choice-1", {
      requestId: "forged",
      answers: [{ field: "format", selectedValues: ["shell"] }],
    })).toThrow("E_ASK_ANSWER_INVALID");
  });
});

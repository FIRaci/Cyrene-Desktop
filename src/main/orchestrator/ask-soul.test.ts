import { describe, expect, it } from "vitest";
import {
  buildFallbackAskClarification,
  detectRecentAddressedUser,
  normalizeAskClarificationOutput,
  resolveAskClarification,
} from "./ask-soul";
import type { AskClarificationInput } from "../../shared/ask-clarification";
import type { ChatRequest, ChatResponse } from "./vendors/types";

const input: AskClarificationInput = {
  userRequest: "Generate a document",
  trustedUserProfile: {
    callPreference: "Friend",
    gender: "male",
  },
  missingFields: [
    {
      field: "topic",
      reason: "Document topic unknown",
      required: true,
      questionHint: "What is this document mainly about?",
      typeHint: "text",
      allowCustom: false,
    },
    {
      field: "format",
      reason: "Output format unknown",
      required: true,
      questionHint: "Which format do you prefer?",
      typeHint: "single_select",
      allowedOptions: [
        { value: "word", label: "Word Document" },
        { value: "markdown", label: "Markdown Document" },
        { value: "pdf", label: "PDF Document" },
        { value: "excel", label: "Excel Spreadsheet" },
      ],
      allowCustom: true,
    },
  ],
};

describe("Ask Soul clarification contract", () => {
  it("keeps authoritative fields, caps model choices at three, and leaves custom insertion to Runtime", () => {
    const result = normalizeAskClarificationOutput({
      intro: "Friend, to make this document suit you better, I need to confirm two small things.",
      questions: [
        {
          field: "topic",
          question: "What is this document mainly about?",
          type: "text",
          options: [],
          allowCustom: false,
          freeTextPlaceholder: "For example: Project description",
        },
        {
          field: "format",
          question: "Which format do you prefer?",
          type: "single_select",
          options: [
            { value: "word", label: "Word Document" },
            { value: "markdown", label: "Markdown Document" },
            { value: "pdf", label: "PDF Document" },
            { value: "__custom__", label: "Other — I'll enter it myself" },
          ],
          allowCustom: true,
          freeTextPlaceholder: "Enter another format",
        },
      ],
      deferredFields: [],
    }, input);

    expect(result.questions).toHaveLength(2);
    expect(result.questions[1].options).toEqual([
      { value: "word", label: "Word Document" },
      { value: "markdown", label: "Markdown Document" },
      { value: "pdf", label: "PDF Document" },
    ]);
  });

  it("builds a usable local fallback without inventing choices", () => {
    const result = buildFallbackAskClarification(input);

    expect(result.intro).toContain("Friend");
    expect(result.questions).toEqual([
      expect.objectContaining({ field: "topic", type: "text", options: [] }),
      expect.objectContaining({
        field: "format",
        type: "single_select",
        options: [
          { value: "word", label: "Word Document" },
          { value: "markdown", label: "Markdown Document" },
          { value: "pdf", label: "PDF Document" },
        ],
      }),
    ]);
  });

  it("uses the dedicated Ask prompt and returns validated structured card copy", async () => {
    const invoke = async (request: ChatRequest): Promise<ChatResponse> => {
      expect(request.messages[0]?.content).toBe("ASK_SYSTEM\n\nASK_PERSONA\n\nASK_QUOTES");
      expect(request.messages[1]?.content).toContain('"trustedUserProfile"');
      return {
        assistantMessage: { role: "assistant", content: "{}" },
        text: JSON.stringify({
          intro: "Friend, to make this document suit you better, I need to confirm two small things.",
          questions: [
            {
              field: "topic",
              question: "What is this document mainly about?",
              type: "text",
              options: [],
              allowCustom: false,
              freeTextPlaceholder: "For example: Project description",
            },
            {
              field: "format",
              question: "Which format do you prefer?",
              type: "single_select",
              options: [
                { value: "word", label: "Word Document" },
                { value: "markdown", label: "Markdown Document" },
              ],
              allowCustom: true,
              freeTextPlaceholder: "Enter another format",
            },
          ],
          deferredFields: [],
        }),
        toolCalls: [],
        finishReason: "stop",
        raw: {},
      };
    };

    const result = await resolveAskClarification({
      model: "m",
      askSystemContent: "ASK_SYSTEM\n\nASK_PERSONA\n\nASK_QUOTES",
      input,
    }, invoke);

    expect(result.questions.map((question) => question.field)).toEqual(["topic", "format"]);
  });

  it("detects a recently used preferred address so Ask Soul does not repeat it", () => {
    expect(detectRecentAddressedUser([
      { role: "user", content: "Generate a document" },
      { role: "assistant", content: "Friend, I am listening." },
    ], { callPreference: "Friend", nickname: "Wang", gender: "male" })).toBe(true);
  });
});

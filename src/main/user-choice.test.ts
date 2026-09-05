import { beforeEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle },
}));

import {
  registerChoiceIpc,
  requestUserClarification,
  setChoiceCardSender,
} from "./user-choice";
import type { AskUserAnswer } from "../shared/ask-clarification";

describe("requestUserClarification", () => {
  beforeEach(() => {
    handle.mockReset();
  });

  it("round-trips a structured multi-field answer through the existing choice IPC", async () => {
    let sent: { id: string } | undefined;
    setChoiceCardSender((card) => {
      sent = card;
    });
    registerChoiceIpc();

    const pending = requestUserClarification({
      intro: "Partner, two things still need confirmation.",
      questions: [{
        field: "topic",
        question: "What is the primary topic of this document?",
        type: "text",
        options: [],
        allowCustom: false,
        freeTextPlaceholder: "e.g. Project overview",
      }],
      deferredFields: [],
    });
    const answer: AskUserAnswer = {
      requestId: sent!.id,
      answers: [{ field: "topic", customText: "Project overview" }],
    };
    const ipcHandler = handle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: { id: string; answer: AskUserAnswer },
    ) => unknown;
    ipcHandler({}, { id: sent!.id, answer });

    await expect(pending).resolves.toEqual(answer);
  });
});

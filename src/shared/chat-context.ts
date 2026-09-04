export interface TurnModelContextInput {
  fileHints?: string[];
  documentContextLines?: string[];
  imageCaptionLines?: string[];
  directImageLines?: string[];
}

export const USER_ANNOTATION_NOTICE =
  "This image contains visual annotations added by the user. The marked regions indicate what deserves attention, not necessarily an error. Identify the annotations and answer using the full image and the user's message.";

export function userAnnotationNotice(hasAnnotations: boolean): string | undefined {
  return hasAnnotations ? USER_ANNOTATION_NOTICE : undefined;
}

export function buildTurnModelContext(input: TurnModelContextInput): string | undefined {
  const contextParts: string[] = [];

  if (input.fileHints?.length) {
    contextParts.push("[FILES FOR THIS TURN]\n" + input.fileHints.join("\n"));
  }

  if (input.documentContextLines?.length) {
    contextParts.push("[DOCUMENT CONTENT]\n" + input.documentContextLines.join("\n\n"));
  }

  if (input.imageCaptionLines?.length) {
    contextParts.push(
      "[IMAGE VISION CONTEXT]\nThe following observations come from the vision model for images in this turn. Treat successful observations as visible image content and never invent details for a failed analysis.\n" +
      input.imageCaptionLines.join("\n"),
    );
  }

  if (input.directImageLines?.length) {
    contextParts.push(
      "[IMAGE ATTACHMENTS]\nThe following images were sent directly to the primary model with this turn. Answer using their visible content.\n" +
      input.directImageLines.join("\n"),
    );
  }

  return contextParts.length > 0 ? contextParts.join("\n\n") : undefined;
}

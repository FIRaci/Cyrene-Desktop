import { RelationshipLogEntry, RelationshipDailySummary } from "./relationship-log-types";

export function compactText(text: string, max = 120): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function detectUserMood(text: string): string {
  if (
    /\b(?:tired|exhausted|sleepy|drained|fatigued|can't hold on|burned out)\b/i.test(
      text
    )
  )
    return "tired";
  if (
    /\b(?:don't|do not|stop|no need|dislike|hate|annoying|intrusive|too much|too many|no cards?|no confirm|boundary)\b/i.test(
      text
    )
  )
    return "clear boundary";
  if (
    /\b(?:anxious|anxiety|stress|stressed|overwhelmed|nervous|worried|worry|panicking|panic)\b/i.test(
      text
    )
  )
    return "anxious";
  if (
    /\b(?:sad|down|upset|depressed|heartbroken|crying|cry|hurt|unhappy)\b/i.test(
      text
    )
  )
    return "down";
  if (
    /\b(?:happy|glad|great|yay|awesome|comfortable|enjoy|love it|wonderful)\b/i.test(
      text
    )
  )
    return "happy";
  return "unknown";
}

export function deriveSignal(
  userText: string,
  userMood: string
): {
  relationshipSignal: string;
  importantMoment?: string;
  nextCareCue: string;
} {
  if (userMood === "clear boundary") {
    return {
      relationshipSignal:
        "The user expressed a preference for low disturbance or experience boundaries; prioritize respecting this, and avoid turning care into interruptions.",
      importantMoment:
        "The user clearly stated that they dislike intrusive confirmation cards or excessive questioning.",
      nextCareCue:
        "Do not pop confirmation dialogs or repeatedly ask questions; execute quietly according to user preferences first, and confirm with a single sentence if necessary.",
    };
  }

  if (userMood === "tired") {
    return {
      relationshipSignal:
        "The user is showing signs of fatigue and needs low-pressure companionship and concise responses.",
      nextCareCue:
        "Next response cue: Keep tasks and questions minimal, slow down the tone, and acknowledge their state first.",
    };
  }

  if (userMood === "anxious") {
    return {
      relationshipSignal:
        "The user may be under stress or feeling anxious, requiring a sense of stability and clear, bite-sized suggestions.",
      nextCareCue:
        "Next response cue: Reassure first, then provide one or two actionable small steps without overwhelming them.",
    };
  }

  if (userMood === "down") {
    return {
      relationshipSignal:
        "The user's mood is low; they need understanding and gentle presence rather than immediate correction.",
      nextCareCue:
        "Next response cue: Acknowledge feelings first, then gently accompany; do not rush into moralizing or reasoning.",
    };
  }

  if (userMood === "happy") {
    return {
      relationshipSignal:
        "The user's feedback is positive; maintain a lighthearted interaction and note what sparked their joy.",
      nextCareCue:
        "Next response cue: Feel free to be more relaxed and maintain the user's positive state.",
    };
  }

  return {
    relationshipSignal:
      "This round of interaction had no obvious emotional peaks; maintaining natural companionship is sufficient.",
    nextCareCue: `Next response cue: Continue the recent topic "${compactText(
      userText,
      40
    )}", without over-interpreting.`,
  };
}

export function summarizeDate(
  date: string,
  entries: RelationshipLogEntry[]
): RelationshipDailySummary {
  const moods = entries.map((e) => e.userMood).filter((m) => m !== "unknown");
  const dominantMood = moods.at(-1) ?? "stable";
  const important = [...entries].reverse().find((e) => e.importantMoment)
    ?.importantMoment;
  const cue = entries.at(-1)?.nextCareCue ?? "Maintain natural companionship.";
  const signal =
    entries.at(-1)?.relationshipSignal ?? "Interaction today was stable.";
  const parts = [
    `${date}: The user's recent state leaned toward "${dominantMood}".`,
    important ? `Important preference: ${important}` : signal,
    cue,
  ];
  return {
    date,
    updatedAt: Date.now(),
    summary: parts.join(" "),
    nextCareCue: cue,
  };
}

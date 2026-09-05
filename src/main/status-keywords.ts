// Runtime status keyword configuration
// Modify this file to adjust status inference rules without changing main logic

export const STATUS_KEYWORDS: Record<string, RegExp> = {
  Listening: /sad|upset|tired|unhappy|cry|heartbroken|depressed|listening/i,
  Thinking: /analyze|think|why|how|logic|infer|explain|reason|understand/i,
};

export const FEELING_KEYWORDS: Array<{ feeling: "Calm" | "Happy" | "Gentle" | "Excited" | "Coy" | "Worried" | "Sad" | "Touched" | "Shy"; pattern: RegExp }> = [
  { feeling: "Excited", pattern: /\b(?:excited|awesome|fantastic|incredible|super cool|hooray|hurray|let's go|cannot wait)\b/i },
  { feeling: "Happy", pattern: /\b(?:happy|delighted|joy|wonderful|great|glad|hehe|haha|yay|smile|love it)\b/i },
  { feeling: "Coy", pattern: /\b(?:darling|flirt|silly|tease|playful|dummy|huff)\b/i },
  { feeling: "Shy", pattern: /\b(?:shy|blush|embarrass|fluster)\b/i },
  { feeling: "Touched", pattern: /\b(?:touched|grateful|cherish|heartwarming|thank you so much|appreciate)\b/i },
  { feeling: "Worried", pattern: /\b(?:worry|worried|nervous|careful|anxious|afraid|scared|danger)\b/i },
  { feeling: "Sad", pattern: /\b(?:sad|sorrow|unhappy|depressed|cry|tears|lonely|heartbroken|grief)\b/i },
  { feeling: "Gentle", pattern: /\b(?:gentle|sweet|care|warm|soft|hug|comfort|soothe|peaceful)\b/i },
];

export function inferFeelingFromText(text: string): "Calm" | "Happy" | "Gentle" | "Excited" | "Coy" | "Worried" | "Sad" | "Touched" | "Shy" {
  for (const entry of FEELING_KEYWORDS) {
    if (entry.pattern.test(text)) {
      return entry.feeling;
    }
  }
  return "Calm";
}
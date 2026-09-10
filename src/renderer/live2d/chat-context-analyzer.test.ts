import { describe, expect, it } from "vitest";
import {
  detectConversationMood,
  analyzeConversationContext,
  YANDERE_IDLE_THOUGHTS,
  JEALOUS_IDLE_THOUGHTS,
  BORED_IDLE_THOUGHTS,
  EXCITED_IDLE_THOUGHTS,
  SHY_IDLE_THOUGHTS,
  POUTING_IDLE_THOUGHTS,
  STUDY_IDLE_THOUGHTS,
  COMFORT_IDLE_THOUGHTS,
  AFFECTIONATE_IDLE_THOUGHTS,
  DEFAULT_IDLE_THOUGHTS,
} from "./chat-context-analyzer";

describe("chat-context-analyzer - 9 mood spectrum", () => {
  describe("detectConversationMood", () => {
    it("returns default for empty message history", () => {
      const result = detectConversationMood([]);
      expect(result.mood).toBe("default");
      expect(result.detectedKeywords).toEqual([]);
    });

    it("detects yandere mood from possessive / obsessive keywords (giam cầm, nhốt, yandere, mine alone)", () => {
      const messages = [
        { role: "user", content: "Master chỉ được nhìn một mình em thôi, không ai được cướp Master đi đâu~" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("yandere");
      expect(result.detectedKeywords.length).toBeGreaterThan(0);
    });

    it("detects jealous mood when mentioning another waifu or girl (Firefly, Acheron, ghen, ai khác)", () => {
      const messages = [
        { role: "user", content: "Anh thấy Firefly và Kafka cũng xinh phết nhỉ" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("jealous");
    });

    it("detects bored mood when user or Cyrene complains of boredom / sleepiness (chán, buồn tẻ, bored)", () => {
      const messages = [
        { role: "user", content: "Hôm nay chán quá à, chẳng có gì làm cả, rảnh rỗi ghê" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("bored");
    });

    it("detects excited mood from playful / celebrating keywords (vui quá, quẩy, excited, win)", () => {
      const messages = [
        { role: "user", content: "Yay thắng rồi, vui quá đi thôi Cyrene ơi!" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("excited");
    });

    it("detects shy mood from blushing and embarrassed keywords (ngại, đỏ mặt, shy, flustered)", () => {
      const messages = [
        { role: "user", content: "Master cứ nhìn chằm chằm làm em ngại và đỏ mặt quá nè" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("shy");
    });

    it("detects pouting mood from Vietnamese keywords (dỗi, giận, trêu, hmph)", () => {
      const messages = [
        { role: "user", content: "Sao em lại dỗi anh thế?" },
        { role: "model", content: "Hmph, ai bảo Master trêu em chứ!" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("pouting");
    });

    it("detects study mood from study and exam keywords (học, ôn thi, exam, homework)", () => {
      const messages = [
        { role: "user", content: "Tối nay anh phải học bài và ôn thi giải tích" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("study");
    });

    it("detects comfort mood when tired or stressed (mệt, stress, tired)", () => {
      const messages = [
        { role: "user", content: "Hôm nay đi làm mệt mỏi và áp lực quá em ơi" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("comfort");
    });

    it("detects affectionate mood from romantic words (yêu, nhớ, love, hug)", () => {
      const messages = [
        { role: "user", content: "Anh yêu Cyrene nhiều lắm" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });
  });

  describe("analyzeConversationContext for specialized moods", () => {
    it("provides yandere thoughts and possessive prompt for yandere mood", () => {
      const messages = [{ role: "user", content: "Cyrene là của riêng mình Master, không ai được chạm vào" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("yandere");
      expect(YANDERE_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("YANDERE mode");
      expect(result.gestureFallback.kaomoji).toBe("(★ω★)");
      expect(result.gestureFallback.headPat).toContain("mine alone");
    });

    it("provides jealous thoughts and possessive interrogation for jealous mood", () => {
      const messages = [{ role: "user", content: "Em thấy March 7th thế nào, dễ thương không?" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("jealous");
      expect(JEALOUS_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("JEALOUS");
      expect(result.gestureFallback.kaomoji).toBe("(╬ Ò﹏Ó)");
      expect(result.gestureFallback.headPat).toContain("Trying to distract me with pats?");
    });

    it("provides bored thoughts and lazy complaint for bored mood", () => {
      const messages = [{ role: "user", content: "Chán quá à, sao buồn tẻ thế này" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("bored");
      expect(BORED_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("BORED or LONELY");
      expect(result.gestureFallback.kaomoji).toBe("( ´_ゝ`)");
      expect(result.gestureFallback.headPat).toContain("almost dying of boredom");
    });

    it("provides excited thoughts and energetic celebration for excited mood", () => {
      const messages = [{ role: "user", content: "Vui quá đi, quẩy lên nào!" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("excited");
      expect(EXCITED_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("SUPER EXCITED and PLAYFUL");
      expect(result.gestureFallback.kaomoji).toBe("(≧◡≦) ♡");
      expect(result.gestureFallback.headPat).toContain("100% extra energy");
    });

    it("provides shy thoughts and blushing stammer for shy mood", () => {
      const messages = [{ role: "user", content: "Đừng nhìn em làm em ngại và đỏ mặt quá nè" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("shy");
      expect(SHY_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("SHY / FLUSTERED");
      expect(result.gestureFallback.kaomoji).toBe("(⸝⸝⸝•﹏•⸝⸝⸝)");
      expect(result.gestureFallback.headPat).toContain("burning red cheeks");
    });

    it("provides pouting thoughts and tsundere reaction for pouting mood", () => {
      const messages = [{ role: "user", content: "Em dỗi anh đấy à?" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("pouting");
      expect(POUTING_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).toContain("CRITICAL EMOTION AWARENESS");
      expect(result.gestureFallback.kaomoji).toBe("(・へ・)");
    });

    it("does not falsely trigger study mood on generic dev/app words like test, schedule, or code", () => {
      const messages = [
        { role: "user", content: "Tôi phải test chức năng này trước đã" },
        { role: "user", content: "Check the schedule and run the code tests" },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).not.toBe("study");
    });

    it("provides serene quiet support for study mood without assuming Master is tired", () => {
      const messages = [{ role: "user", content: "Tối nay em phải ôn thi bài vở nhiều quá" }];
      const result = analyzeConversationContext(messages);

      expect(result.mood).toBe("study");
      expect(STUDY_IDLE_THOUGHTS).toContainEqual(result.recommendedThought);
      expect(result.gestureEmotionPromptSnippet).not.toContain("tired from studying");
      expect(result.gestureFallback.headPat).toContain('"Cyrene will quietly stay right by your side, Master."');
    });

    it("correctly identifies intimate dialogue with 'teasing touch' as affectionate, not pouting", () => {
      const messages = [
        {
          role: "model",
          content: "Cyrene shivers as a teasing touch moves gently along her skin, whispering how much she loves Master.",
        },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });

    it("prevents negated sulking words from triggering pouting (e.g. 'Don't be mad at me')", () => {
      const messages = [
        {
          role: "user",
          content: "Don't be mad at me, my sweet darling, I love you so much.",
        },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });

    it("accurately detects genuine tsundere pouting when Master is truly teasing in an annoying way", () => {
      const messages = [
        {
          role: "model",
          content: "Hmph! Stop teasing me, Master, you're so mean to me! Won't talk to you!",
        },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("pouting");
    });

    it("correctly disambiguates 'mean' in 'you mean everything to me' as affectionate", () => {
      const messages = [
        {
          role: "user",
          content: "You mean everything to me, Cyrene. You are my world.",
        },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });

    it("correctly disambiguates 'madly in love' as affectionate rather than pouting", () => {
      const messages = [
        {
          role: "user",
          content: "I am madly in love with you forever.",
        },
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });

    it("demonstrates recency decay: recent affectionate turns override an older sulking turn", () => {
      const messages = [
        { role: "model", content: "Hmph! Stop teasing me!" }, // Turn N-2 (older)
        { role: "user", content: "I'm so sorry, my beloved sweetheart." }, // Turn N-1
        { role: "model", content: "I love you too, Master, hold me close." }, // Turn N (latest)
      ];
      const result = detectConversationMood(messages);
      expect(result.mood).toBe("affectionate");
    });
  });
});


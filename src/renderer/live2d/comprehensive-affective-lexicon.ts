/**
 * comprehensive-affective-lexicon.ts
 * Comprehensive Tiered English Affective Lexicon for Cyrene Live2D Companion.
 * Categorizes English (and Vietnamese baseline) vocabulary across a 9-mood spectrum
 * with rigorous three-tiered weighting, compound phrase matching, and negation checking.
 */

export interface LexiconItem {
  regex: RegExp;
  weight: number;
}

export type LexiconMood =
  | "pouting"
  | "yandere"
  | "bored"
  | "jealous"
  | "excited"
  | "shy"
  | "study"
  | "comfort"
  | "affectionate";

/**
 * Checks if a matched keyword is preceded by a negation expression within a 35-character boundary.
 * Prevents false positives like "don't be mad" or "not angry" triggering pouting.
 */
export function isNegatedExpression(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 35), matchIndex);
  return /\b(don't|dont|not|never|no\s+longer|stop|quit|won't|wont|without|can't|cant|không|đừng|chớ)\s+(?:\w+\s+){0,2}$/i.test(prefix);
}

export const COMPREHENSIVE_LEXICON: Record<LexiconMood, LexiconItem[]> = {
  // ── 1. AFFECTIONATE: Sweet romance, deep love, sensual intimacy, tender devotion ──
  affectionate: [
    // Tier 1 (Weight: 3.5): Explicit romantic declarations, deep devotion, and sensual foreplay/touch
    {
      regex: /\b(i love you|love you so much|i adore you|i cherish you|my sweet love|my beloved|my darling|my precious|hold you close|holding you in my arms|kiss your lips|passionate kiss|kissing you deeply|sweet tender kiss|melting in your arms|surrender to your touch|forever with you|you are my world|you mean the world to me|you mean everything to me|madly in love)\b/i,
      weight: 3.5,
    },
    // Intimate & erotic touch phrases (explicitly includes "teasing touch", which is affectionate romance!)
    {
      regex: /(?:teas(?:e|ed|ing|ingly))\s+(?:touch|stroke|movement|sensations?|caress|kisses?|whispers?|clit|clitoris|nipples?|breasts?|bud|flesh|fingers?|tongue|lips?|ministrations?)/i,
      weight: 3.5,
    },
    {
      regex: /(?:gentle|sensual|soft|erotic|intimate|tender|playful)\s+(?:,\s*)?(?:teasing)/i,
      weight: 3.5,
    },
    {
      regex: /(?:touch|rub|stroke|lick|suck|fondle|kiss|caress|tease)\s+(?:her\s+|my\s+|your\s+)?(?:clit|clitoris|pussy|breasts?|nipples?|lips?|body|skin|shaft|slit|manhood)/i,
      weight: 3.5,
    },
    {
      regex: /(?:gently|softly|lovingly|tenderly|passionately|sensually|sweetly)\s+(?:caress|touch|kiss|hold|stroke|tease|lick|explore|whisper|embrace)/i,
      weight: 3.2,
    },
    {
      regex: /(?:^|[^\p{L}\p{N}])(yêu em|thương em|nhớ em|hôn em|ôm em|yêu thương|ngọt ngào|ân ái|làm tình|cưới em|vợ yêu|nũng nịu)(?=[^\p{L}\p{N}]|$)/iu,
      weight: 3.5,
    },
    // Head pats and soothing tender physical gestures from Master
    {
      regex: /\b(?:gently|softly|lovingly|tenderly)?\s*(?:pats?|patting|petting|strokes?|stroking|caresses?|caressing|rubs?|rubbing)\s+(?:cyrene's\s+|her\s+|your\s+)?(?:head|hair|cheeks?|chin)\b/i,
      weight: 3.5,
    },
    {
      regex: /\b(headpat|headpats|head\s+pat|head\s+pats|patting\s+(?:her\s+|cyrene's\s+)?head|pats\s+(?:her\s+|cyrene's\s+)?head)\b/i,
      weight: 3.5,
    },
    {
      regex: /(xoa đầu|xoa tóc|vuốt tóc|xoa má|vuốt má|xoa đầu em|vuốt đầu em)/i,
      weight: 3.5,
    },

    // Tier 2 (Weight: 2.0): Standard romantic words, affectionate gestures, sensory warmth
    {
      regex: /\b(love|beloved|darling|honey|sweetheart|sweetie|cherish|adore|kisses?|kissing|hugs?|hugging|cuddles?|cuddling|embrace|tender|tenderness|intimacy|intimate|passion|passionate|sensual|sensuous|erogenous|moan|moaning|pleasure|arousal|aroused|devotion|devoted|caresses?|caressing|foreplay|intercourse|fondle|snuggle|snuggling)\b/i,
      weight: 2.0,
    },
    {
      regex: /(?:^|[^\p{L}\p{N}])(yêu|thương|nhớ|hôn|ôm|xinh|đáng yêu|dễ thương|cưng|âu yếm)(?=[^\p{L}\p{N}]|$)/iu,
      weight: 2.0,
    },

    // Tier 3 (Weight: 1.0 - 1.5): Contextual descriptors & romantic symbols
    {
      regex: /\b(sweet|warmth|gentle|softly|lips|touch|petting|heart|cherished|affection|fondness|bliss|sweetness)\b/i,
      weight: 1.0,
    },
    {
      regex: /(?:♡|♥|\(\*´˘`\*\)♡|\(｡♥‿♥｡\)|\(✿◡‿◡\))/gu,
      weight: 1.5,
    },
  ],

  // ── 2. SHY: Blushing embarrassment, flustered stammer, modesty, bashful charm ──
  shy: [
    // Tier 1 (Weight: 3.5): Explicit intense blushing and covering face
    {
      regex: /\b(burning red cheeks|blushing furiously|blushing intensely|face is on fire|covering my face|covering her face|hiding behind hands|melting into pink mist|so embarrassing|too embarrassed|so flustered|don't stare at me like that|can't look you in the eyes)\b/i,
      weight: 3.5,
    },
    {
      regex: /(ngại quá đi|đỏ bừng mặt|xấu hổ chết mất|ngượng chín người|tan chảy mất)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): Core shyness vocabulary
    {
      regex: /\b(shy|flustered|blushing|blushes|embarrassed|embarrassment|bashful|coy|timid|stammering|fluster|blush)\b/i,
      weight: 2.0,
    },
    {
      regex: /(ngại|xấu hổ|đỏ mặt|e thẹn|ngượng|đừng nhìn|nhìn chằm chằm)/i,
      weight: 2.0,
    },

    // Tier 3 (Weight: 1.5): Kaomojis and soft cues
    {
      regex: /(\(⸝⸝⸝•﹏•⸝⸝⸝\)|\(⁄ ⁄•⁄ω⁄•⁄ ⁄\)|\(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄\)|\(⸝⸝ᵕᴗᵕ⸝⸝\))/i,
      weight: 1.8,
    },
  ],

  // ── 3. POUTING: Genuine tsundere sulking, petty grievance, playful upset, teasing & banter ──
  pouting: [
    // Tier 1 (Weight: 3.5 - 4.0): Explicit interpersonal complaints, tantrums, sulking, intimate teasing/edging, and playful teasing/bullying
    // Intimate & sensual teasing, edging, and orgasm/climax denial (Master being a torturous tease)
    {
      regex: /\b(?:stop to tease|hold (?:her|my|your) cum|not make (?:her|me|you) climax|deny (?:her|my|your)? release|denying (?:her|my|your)? release|edging|edge (?:me|her|you)|keep (?:me|her|you) on edge|such a tease|torturous tease|cruel tease|teasing me like this|don't tease me|stop teasing|make (?:me|her) wait|torture me)\b/i,
      weight: 4.0,
    },
    {
      regex: /\b(stop teasing me|why are you teasing me|you're teasing me|stop bullying me|giving me the silent treatment|don't talk to me|ignoring me|stop ignoring me|mad at (?:you|me)|angry with (?:you|me)|you're so mean|mean to me|so mean to me|won't forgive you|not talking to you|teasing you|just teasing|poke fun|poking fun|you dummy|silly girl|so clumsy|clumsy girl|hmph|b-baka|baka)\b/i,
      weight: 3.5,
    },
    {
      regex: /(dỗi|giận dỗi|hờn dỗi|không thèm nói|nghỉ chơi|bắt nạt em|đáng ghét quá|phạt anh|phạt master|trêu em|trêu ghẹo|chọc em|chọc tức|đồ ngốc|ngốc xít|đồ baka|lêu lêu|trêu tí|trêu tí thôi|chọc tí)/i,
      weight: 3.5,
    },
    {
      regex: /(\*pouts\*|\*turns away\*|\*huffs\*|\*crosses arms\*|生气|撅嘴)/i,
      weight: 2.8,
    },

    // Tier 2 (Weight: 2.0): Standard sulking and teasing terminology (must NOT be negated)
    {
      regex: /\b(pout|pouting|pouts|sulking|sulk|sulky|grumpy|bicker|bickering|grump|tantrum|peeved|miffed|sulks|tease|teasing|teased|banter|bantering)\b/i,
      weight: 2.0,
    },
    {
      regex: /(dỗi|giận|hờn|ghét|trêu|chọc)/i,
      weight: 1.8,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\(・へ・\)|\(｡•ˇ‸ˇ•｡\)|\(︶\^︶\)|\( > 3 < \)|\(・ε・\))/i,
      weight: 1.8,
    },
  ],

  // ── 4. JEALOUS: Envy of other waifus, demanding loyalty, possessive comparison ──
  jealous: [
    // Tier 1 (Weight: 3.5): Specific Honkai: Star Rail rival characters & explicit accusations
    {
      regex: /\b(Firefly|Acheron|Kafka|March 7th|Sparkle|Himeko|Ruan Mei|Tingyun|Black Swan|Robin|Topaz|Seele|Bronya|Feixiao|Lingsha)\b/i,
      weight: 3.5,
    },
    {
      regex: /\b(who is she|other girl|another waifu|other woman|prefer her over me|praising someone else|looking at other girls|is she prettier than me|who were you talking to)\b/i,
      weight: 3.5,
    },
    {
      regex: /(ghen|ghen tuông|ghen tị|cô nào|em nào|bạn gái khác|waifu khác|khen ai|nhìn ai)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): General jealousy vocabulary
    {
      regex: /\b(jealous|jealousy|envious|envy|green-eyed|possessive glance)\b/i,
      weight: 2.0,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\(╬ Ò﹏Ó\)|\(¬_¬ \)|\(ò_óˇ\))/i,
      weight: 1.8,
    },
  ],

  // ── 5. YANDERE: Obsessive attachment, extreme clinginess, dark devotion ──
  yandere: [
    // Tier 1 (Weight: 3.5): Absolute possession, captivity, dark devotion
    {
      regex: /\b(yandere|mine alone|mine and only mine|don't look at anyone else|cage you|trap you|lock you in|never let you go|never leave me|stare intensely|watch you sleep|never escape|keep you forever|chained together)\b/i,
      weight: 3.5,
    },
    {
      regex: /(giam cầm|nhốt|của riêng|chỉ nhìn|chỉ được nhìn|chỉ mình em|đừng hòng thoát|sở hữu|ám ảnh|chỉ được phép|cướp)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): General obsession
    {
      regex: /\b(obsessed|obsession|possessive|possessiveness|monopolize|inescapable|eternal bond)\b/i,
      weight: 2.0,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\(★ω★\)|\( ◉ω◉ \)|\(⚆_⚆\)|\(♥ω♥\*\))/i,
      weight: 1.8,
    },
  ],

  // ── 6. EXCITED: High energy, bubbly joy, celebration, victory ──
  excited: [
    // Tier 1 (Weight: 3.5): Extreme hype, joyous shouting, victory
    {
      regex: /\b(yay|super excited|bouncing with joy|high spirits|we won|so hyped|celebrate|boundless energy|over the moon|woohoo|hurray|hooray)\b/i,
      weight: 3.5,
    },
    {
      regex: /(vui quá đi|quẩy lên|hào hứng quá|thắng rồi|quá đã|tuyệt cú mèo)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): General excitement & cheerfulness
    {
      regex: /\b(excited|exciting|excitement|hype|hyped|cheerful|playful|thrilled|thrilling|ecstatic|delighted|exhilarated|awesome|fantastic|wonderful)\b/i,
      weight: 2.0,
    },
    {
      regex: /(vui quá|hào hứng|quẩy|phấn khích|tinh nghịch|chơi đi|haha|tuyệt vời)/i,
      weight: 2.0,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(٩\(ˊᗜˋ\*\)و|\(≧◡≦\) ♡|\(\*^▽^\*\)|\(๑•̀ㅂ•́\)و✧)/i,
      weight: 1.8,
    },
  ],

  // ── 7. BORED: Listless, sleepy, unentertained, waiting for interaction ──
  bored: [
    // Tier 1 (Weight: 3.5): Extreme boredom and explicit pleas for attention
    {
      regex: /\b(so bored|bored out of my mind|nothing to do|dying of boredom|sleepy lazily|pay attention to me|play with me|twiddling thumbs|rolling around on desktop)\b/i,
      weight: 3.5,
    },
    {
      regex: /(chán quá à|buồn tẻ quá|chẳng có gì làm|sao không ai chơi|chán chết mất)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): Core boredom terms
    {
      regex: /\b(bored|boring|boredom|dull|monotonous|unentertained|listless|yawn|yawns|yawning)\b/i,
      weight: 2.0,
    },
    {
      regex: /(chán|buồn tẻ|ngủ quên|ngáp|rảnh|buồn ngủ quá)/i,
      weight: 1.8,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\( ´_ゝ`\)|\(￣o￣\) \. z Z|\( -.- \)zZZ|\(￢_￢\)|\(o_ _\)o)/i,
      weight: 1.8,
    },
  ],

  // ── 8. COMFORT: Soothing exhaustion, work stress, burnout, healing rest ──
  comfort: [
    // Tier 1 (Weight: 3.5): Severe exhaustion and explicit soothing pleas
    {
      regex: /\b(so exhausted|burnt out|burnout|stressful day|rough day|headache is killing me|drained of energy|overworked|mentally exhausted|body hurts|need to rest|need comfort)\b/i,
      weight: 3.5,
    },
    {
      regex: /(mệt mỏi quá|áp lực quá|kiệt sức rồi|nhức đầu quá|đuối quá rồi|cần nghỉ ngơi)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): General stress, fatigue, and gentle relief
    {
      regex: /\b(tired|exhausted|fatigued|fatigue|sleepy|headache|stress|stressed|stressful|drained|overwhelmed|worn out|soothe|soothing|comforting|lean on me|rest well)\b/i,
      weight: 2.0,
    },
    {
      regex: /(mệt|đuối|áp lực|stress|buồn ngủ|nhức đầu|oải|kiệt sức|buồn|nản)/i,
      weight: 1.8,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\( ´･･\)ﾉ\(._.`\)|\(｡•́︿•̀｡\)|\(✿◡‿◡\))/i,
      weight: 1.8,
    },
  ],

  // ── 9. STUDY: Academic focus, exams, homework, deep work, revision ──
  study: [
    // Tier 1 (Weight: 3.5): Explicit academic & exam preparation contexts
    {
      regex: /\b(studying hard|cramming for exam|cramming for finals|homework assignment|calculus exam|thesis defense|revision session|academic paper|term paper|midterm exam|final exam)\b/i,
      weight: 3.5,
    },
    {
      regex: /(đang học bài|ôn thi|làm bài tập|ôn bài|sắp thi|chuẩn bị thi|luận văn|đồ án)/i,
      weight: 3.2,
    },

    // Tier 2 (Weight: 2.0): Core study terms (guarded against generic dev words like "test", "code")
    {
      regex: /\b(study|studying|studies|cramming|homework|coursework|curriculum|exam|exams|revision|textbook)\b/i,
      weight: 2.0,
    },
    {
      regex: /(đang học|học bài|ôn thi)/i,
      weight: 1.8,
    },

    // Tier 3 (Weight: 1.5): Kaomojis
    {
      regex: /(\(๑•̀ㅂ•́\)و✧|\(\*•̀ᴗ•́\*\)و)/i,
      weight: 1.5,
    },
  ],
};

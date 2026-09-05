"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fourTierMix = void 0;
exports.buildMixRounds = buildMixRounds;
const fixture_parser_1 = require("./fixture-parser");
const MIX_FIXTURE = `## Test Permanent
- Keywords: permanent_test, fixture_permanent
- Permanent: true
- Intrinsic Value: 100
- Priority: 200

Fixture permanent entry, verifying bypass (always injected, does not enter DMAE).
---

## Cyrene Main
- Keywords: MiMi, PHILIA093, Heart of Amphoreus, Scepter Core, Original Form, Where do you come from, Demiurge
- Intrinsic Value: 90
- Priority: 200

Cyrene is the core companion.
---

## Elysee Grove
- Keywords: Elysee Grove, Hometown, Wheat Field, Swing
- Intrinsic Value: 70
- Priority: 150

Important scene memory.
---

## Coffee
- Keywords: Coffee, latte, americano, espresso
- Intrinsic Value: 45
- Priority: 100

User daily preference.
---

## Blender
- Keywords: Blender, blender, 3d modeling, rendering
- Intrinsic Value: 45
- Priority: 100

User 3D creation tool.
---

## Cat
- Keywords: Cat, kitten, meow, pet cat
- Intrinsic Value: 45
- Priority: 100

Life interest.
---

## Star Rail
- Keywords: Star Rail, Astral Express, Trailblazer
- Intrinsic Value: 45
- Priority: 100

Game played by user.
---

## This Afternoon
- Keywords: this afternoon, just now, a moment ago
- Intrinsic Value: 15
- Priority: 80

Ephemeral event.
---

## Last Week Movie
- Keywords: last week, last time, movie, cinema
- Intrinsic Value: 15
- Priority: 80

Ephemeral event.
---

## Weather
- Keywords: weather, raining, sunny, cloudy
- Intrinsic Value: 15
- Priority: 80

Daily small talk.
---
`;
const TIER_KEYWORDS = [
    { tier: "high", I: 90, weight: 0.2, keywords: ["MiMi", "PHILIA093", "Heart of Amphoreus", "Scepter Core", "Original Form", "Where do you come from", "Demiurge"] },
    { tier: "mid-high", I: 70, weight: 0.3, keywords: ["Elysee Grove", "Hometown", "Wheat Field"] },
    { tier: "mid", I: 45, weight: 0.3, keywords: ["Coffee", "Blender", "Cat", "Star Rail"] },
    { tier: "low", I: 15, weight: 0.2, keywords: ["this afternoon", "weather", "last week"] },
];
function pickKeyword(rng) {
    const r = rng();
    let acc = 0;
    for (const t of TIER_KEYWORDS) {
        acc += t.weight;
        if (r < acc) {
            const kw = t.keywords[Math.floor(rng() * t.keywords.length)];
            return { tier: t.tier, kw };
        }
    }
    const last = TIER_KEYWORDS[TIER_KEYWORDS.length - 1];
    return { tier: last.tier, kw: last.keywords[0] };
}
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}
function buildMixRounds(totalRounds = 100, seed = 42) {
    const rng = makeRng(seed);
    const rounds = [];
    const recentHits = [];
    for (let i = 0; i < totalRounds; i++) {
        if (rng() < 0.15 && i > 0) {
            rounds.push({ index: i, userText: "Yeah", modelText: "", note: "silence" });
            continue;
        }
        const { tier, kw } = pickKeyword(rng);
        let modelText = "";
        if (rng() < 0.33 && recentHits.length > 0) {
            const mk = recentHits[Math.floor(rng() * recentHits.length)];
            modelText = `Yes, ${mk}, I agree.`;
        }
        rounds.push({
            index: i,
            userText: `Let's talk about ${kw}`,
            modelText,
            note: `tier=${tier} kw=${kw}`,
        });
        recentHits.push(kw);
        if (recentHits.length > 8)
            recentHits.shift();
    }
    return rounds;
}
exports.fourTierMix = {
    name: "four-tier-mix",
    description: "100 rounds: 4 I tiers (90/70/45/15) + 1 permanent",
    buildEntries: () => (0, fixture_parser_1.parseFixtureMarkdown)(MIX_FIXTURE, "mix"),
    buildRounds: () => buildMixRounds(100, 42),
};

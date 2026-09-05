"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coffeeLifecycle = void 0;
const fixture_parser_1 = require("./fixture-parser");
const COFFEE_FIXTURE = `## Coffee
- Keywords: Coffee, latte, americano
- Intrinsic Value: 45
- Priority: 100

User daily preference, triggered indirectly.
---

## Baie
- Keywords: Baie, Phainon
- Intrinsic Value: 90
- Priority: 150

Core supporting character, used for comparison.
`;
const COFFEE_ROUNDS = [
    // R1~R3: Repeatedly mention coffee
    { index: 0, userText: "I want some coffee today", modelText: "Sure, do you want a latte or an americano?" },
    { index: 1, userText: "Coffee it is", modelText: "Coffee coffee coffee~" },
    { index: 2, userText: "Coffee coffee", modelText: "" },
    // R4~R8: Silent for 5 rounds, model mentions Baie (silencing coffee)
    { index: 3, userText: "How has Baie been lately?", modelText: "Baie has been very busy lately." },
    { index: 4, userText: "Yeah", modelText: "" },
    { index: 5, userText: "Nice weather today", modelText: "Indeed." },
    { index: 6, userText: "Yeah", modelText: "" },
    { index: 7, userText: "All right then", modelText: "" },
    // R9~R12: Mention other topics, coffee stays silent
    { index: 8, userText: "Baie", modelText: "Baie is here." },
    { index: 9, userText: "Did you learn Blender?", modelText: "Not yet." },
    { index: 10, userText: "How about the cat?", modelText: "The cat is doing great." },
    { index: 11, userText: "Okay", modelText: "" },
    // R13~R15: Further silence
    { index: 12, userText: "Yeah", modelText: "" },
    { index: 13, userText: "Okay", modelText: "" },
    { index: 14, userText: "Let's leave it at that", modelText: "" },
    // R16: Resurrection point: mention coffee again (triggers Archived -> Active floor jump to 45)
    { index: 15, userText: "Still want some coffee", modelText: "Sure thing~" },
    // R17~R30: Mixed rounds
    { index: 16, userText: "Where's the cat", modelText: "" },
    { index: 17, userText: "Coffee", modelText: "" },
    { index: 18, userText: "The weather is really nice", modelText: "It really is." },
    { index: 19, userText: "Yeah", modelText: "" },
    { index: 20, userText: "Baie Baie", modelText: "" },
    { index: 21, userText: "This afternoon", modelText: "" },
    { index: 22, userText: "Coffee", modelText: "" },
    { index: 23, userText: "Kitty cat", modelText: "" },
    { index: 24, userText: "Yeah", modelText: "" },
    { index: 25, userText: "Good", modelText: "" },
    { index: 26, userText: "Blender", modelText: "" },
    { index: 27, userText: "Coffee", modelText: "" },
    { index: 28, userText: "Weather", modelText: "" },
    { index: 29, userText: "Yeah", modelText: "" },
];
exports.coffeeLifecycle = {
    name: "coffee-lifecycle",
    description: "30 rounds: Single coffee entry from trigger -> Dormant -> Archived -> Resurrection -> Oscillation",
    buildEntries: () => (0, fixture_parser_1.parseFixtureMarkdown)(COFFEE_FIXTURE, "coffee-fixture"),
    buildRounds: () => COFFEE_ROUNDS,
};

// Scenario 3: dormant-rescue (10 rounds)
import type { Round, Scenario } from "../sim-types";
import { parseFixtureMarkdown } from "./fixture-parser";

const RESCUE_FIXTURE = `## Coffee
- Keywords: Coffee
- Intrinsic Value: 60
- Priority: 100

For testing.
---

## Baie
- Keywords: Baie
- Intrinsic Value: 90
- Priority: 150

For comparison.
`;

const RESCUE_ROUNDS: Round[] = [
  { index: 0,  userText: "I want some coffee today",   modelText: "",               note: "First hit -> floor 60" },
  { index: 1,  userText: "Yeah",             modelText: "",               note: "Silence" },
  { index: 2,  userText: "Okay",           modelText: "",               note: "Silence" },
  { index: 3,  userText: "How is Baie",      modelText: "Baie is great.",     note: "Silence coffee" },
  { index: 4,  userText: "Yeah",             modelText: "",               note: "Silence" },
  { index: 5,  userText: "Nice weather",       modelText: "Indeed.",         note: "Silence" },
  { index: 6,  userText: "Yeah",             modelText: "",               note: "Silence" },
  { index: 7,  userText: "All right",           modelText: "",               note: "Silence -- coffee should be Dormant" },
  { index: 8,  userText: "Still want some coffee",   modelText: "",               note: "Rescue point: A must recover" },
  { index: 9,  userText: "Yeah",             modelText: "",               note: "Observe trend" },
];

export const dormantRescue: Scenario = {
  name: "dormant-rescue",
  description: "10 rounds: Dormant rescue test -- A must recover on R9 user hit (validates ms reset)",
  buildEntries: () => parseFixtureMarkdown(RESCUE_FIXTURE, "rescue"),
  buildRounds: () => RESCUE_ROUNDS,
};

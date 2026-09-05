"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldbookManager = exports.QuadraticResistanceDecay = exports.DefaultRewardStrategy = exports.DEFAULT_DMAE_PARAMS = void 0;
exports.deriveState = deriveState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const worldbook_constants_1 = require("./worldbook-constants");
exports.DEFAULT_DMAE_PARAMS = {
    maxScore: 100,
    promptThreshold: 30,
    userRewardBase: 20,
    wakeGamma: 0.5,
    modelRewardBase: 8,
    wakeLambda: 0.3,
    decayAlpha: 1.5,
    decayBeta: 0.3,
};
// ── v4.0 Default Reward Strategy ──
// Ru = Bu × (1 + γ · ln(1 + U_old))     [v4.0 §4]
//   - Consecutive hits -> at least Bu
//   - Longer silence -> larger ln(1+U) -> stronger reunion reward
//   - Logarithmic growth prevents explosion
//
// Rm = Bm × e^(−λ · U_old)             [v4.0 §5]
//   - U_old=0 -> maximum Bm
//   - Larger U_old -> exponential decay -> diminishing model authority
//   - Active gating controlled by main loop
//   - Rm < D clamp enforced by main loop
class DefaultRewardStrategy {
    userReward(ctx) {
        const { snap, params } = ctx;
        return params.userRewardBase * (1 + params.wakeGamma * Math.log(1 + snap.userSilence));
    }
    modelReward(ctx) {
        const { snap, params } = ctx;
        return params.modelRewardBase * Math.exp(-params.wakeLambda * snap.userSilence);
    }
}
exports.DefaultRewardStrategy = DefaultRewardStrategy;
// Intrinsic value does not participate in reward (prevents permanent dominance).
// ── v3.4 Default Decay Strategy ──
// Decay = (alpha * US^2 + beta * MS^2) / sqrt(I)   [High I = strong resistance = slower forgetting]
// Quadratic -> accelerated forgetting; divided by sqrt(I) -> value determines resistance.
class QuadraticResistanceDecay {
    compute(ctx) {
        const { entry, snap, params } = ctx;
        const I = Math.max(worldbook_constants_1.WORLDBOOK_CONSTANTS.MIN_INTRINSIC_VALUE, entry.intrinsicValue);
        const resistance = 1 / Math.sqrt(I);
        const raw = params.decayAlpha * snap.userSilence * snap.userSilence
            + params.decayBeta * snap.modelSilence * snap.modelSilence;
        return raw * resistance;
    }
}
exports.QuadraticResistanceDecay = QuadraticResistanceDecay;
// ── State Derivation (Pure function) ──
// <=0 -> Archived; >= threshold -> Active; in-between -> Dormant
function deriveState(activation, threshold) {
    if (activation <= 0)
        return "Archived";
    if (activation >= threshold)
        return "Active";
    return "Dormant";
}
class WorldbookManager {
    entries = [];
    worldbookDir;
    state = new Map();
    // ── One-Shot Cascade: entries co-triggered after user hit (active for current turn only) ──
    lastCascadeEntries = [];
    params;
    rewardStrategy;
    decayStrategy;
    stateFile;
    debug;
    // Final injection upper bound (see worldbook-constants.ts)
    static MAX_ACTIVE = worldbook_constants_1.WORLDBOOK_CONSTANTS.MAX_ACTIVE;
    // Fallback when .md does not specify intrinsic value (see worldbook-constants.ts)
    static DEFAULT_INTRINSIC_VALUE = worldbook_constants_1.WORLDBOOK_CONSTANTS.DEFAULT_INTRINSIC_VALUE;
    constructor(worldbookDir, options) {
        this.worldbookDir = worldbookDir;
        this.params = { ...exports.DEFAULT_DMAE_PARAMS, ...(options?.params ?? {}) };
        this.rewardStrategy = options?.rewardStrategy ?? new DefaultRewardStrategy();
        this.decayStrategy = options?.decayStrategy ?? new QuadraticResistanceDecay();
        this.stateFile = options?.stateFile;
        this.debug = options?.debug ?? true;
    }
    // Load all .md files from the worldbook directory
    async loadFromDirectory() {
        if (!fs.existsSync(this.worldbookDir)) {
            console.warn("[Worldbook] directory not found:", this.worldbookDir);
            return;
        }
        const files = fs.readdirSync(this.worldbookDir).filter((f) => f.endsWith(".md"));
        if (files.length === 0) {
            console.warn("[Worldbook] no .md files found in:", this.worldbookDir);
            return;
        }
        const allEntries = [];
        for (const file of files) {
            const filePath = path.join(this.worldbookDir, file);
            const content = fs.readFileSync(filePath, "utf8");
            const entries = this.parseMarkdown(content, file);
            allEntries.push(...entries);
        }
        this.entries = allEntries;
        // Initialize DMAE state: non-permanent entries start at activation = 0 (Archived state)
        // Permanent entries bypass DMAE (always injected).
        this.state.clear();
        for (const e of this.entries) {
            if (e.enabled && !e.permanent) {
                this.state.set(e.id, { activation: 0, userSilence: 0, modelSilence: 0 });
            }
        }
        // v1 persistence seam: reserved
        this.loadState();
        console.log(`[Worldbook] loaded ${allEntries.length} entries from ${files.length} files; DMAE state initialized for ${this.state.size} non-permanent entries`);
    }
    // Load from in-memory entries: used by simulator / tests.
    // Reuses loadFromDirectory state initialization logic for consistency.
    loadFromEntries(entries) {
        this.entries = entries;
        this.state.clear();
        for (const e of this.entries) {
            if (e.enabled && !e.permanent) {
                this.state.set(e.id, { activation: 0, userSilence: 0, modelSilence: 0 });
            }
        }
        this.loadState();
    }
    // Parse markdown format:
    // ## Entry Name
    // - triggers: word1, word2, word3
    // - permanent: true
    // - priority: 200
    // - intrinsic_value: 60
    //
    // Content paragraph...
    // ---
    parseMarkdown(content, fileName) {
        const entries = [];
        // Split by ## headings
        const lines = content.split("\n");
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            // Find next ## heading
            if (!line.startsWith("## ")) {
                i++;
                continue;
            }
            const title = line.replace(/^## /, "").trim();
            i++;
            // Parse metadata lines (lines starting with -)
            let keywords = [];
            let priority = 5;
            let permanent = false;
            let intrinsicValue = WorldbookManager.DEFAULT_INTRINSIC_VALUE;
            let linkTriggers = [];
            let contentStart = i;
            while (i < lines.length) {
                const metaLine = lines[i].trim();
                if (metaLine.toLowerCase().startsWith("- trigger:") || metaLine.toLowerCase().startsWith("- triggers:") || /^-\s*\u89e6\u53d1\u8bcd[\uff1a:]/.test(metaLine)) {
                    const val = metaLine.replace(/^-\s*(?:triggers?|\u89e6\u53d1\u8bcd)[\uff1a:]/i, "").trim();
                    keywords = val.split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
                    i++;
                }
                else if (metaLine.toLowerCase().startsWith("- permanent:") || /^-\s*\u5e38\u9a7b[\uff1a:]/.test(metaLine)) {
                    const val = metaLine.replace(/^-\s*(?:permanent|\u5e38\u9a7b)[\uff1a:]/i, "").trim().toLowerCase();
                    permanent = val === "yes" || val === "true" || val === "1" || val === "\u662f";
                    i++;
                }
                else if (metaLine.toLowerCase().startsWith("- priority:") || /^-\s*\u4f18\u5148\u7ea7[\uff1a:]/.test(metaLine)) {
                    const val = metaLine.replace(/^-\s*(?:priority|\u4f18\u5148\u7ea7)[\uff1a:]/i, "").trim();
                    priority = parseInt(val) || 5;
                    i++;
                }
                else if (metaLine.toLowerCase().startsWith("- initial_score:") ||
                    metaLine.toLowerCase().startsWith("- intrinsic_value:") ||
                    /^-\s*(?:\u521d\u59cb\u5206|\u5185\u5728\u4ef7\u503c)[\uff1a:]/.test(metaLine)) {
                    const val = metaLine.replace(/^-\s*(?:initial_score|intrinsic_value|\u521d\u59cb\u5206|\u5185\u5728\u4ef7\u503c)[\uff1a:]/i, "").trim();
                    const parsed = parseFloat(val);
                    intrinsicValue = Number.isFinite(parsed) ? parsed : WorldbookManager.DEFAULT_INTRINSIC_VALUE;
                    i++;
                }
                else if (metaLine.toLowerCase().startsWith("- link_triggers:") || /^-\s*(?:\u8fde\u5e26\u89e6\u53d1\u8bcd|\u8fde\u5e26\u89e6\u53d1)[\uff1a:]/.test(metaLine)) {
                    const val = metaLine.replace(/^-\s*(?:link_triggers|\u8fde\u5e26\u89e6\u53d1\u8bcd|\u8fde\u5e26\u89e6\u53d1)[\uff1a:]/i, "").trim();
                    // "none" indicates no cascade
                    if (val && val !== "none" && val !== "-" && val !== "\u65e0") {
                        linkTriggers = val.split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
                    }
                    i++;
                }
                else if (metaLine.startsWith("---")) {
                    // Separator line — stop metadata parsing
                    i++;
                    break;
                }
                else if (metaLine === "" || metaLine.startsWith("# ")) {
                    // Empty line or top-level heading — stop
                    break;
                }
                else if (metaLine.startsWith("- ")) {
                    // Unknown metadata field — skip
                    i++;
                }
                else {
                    // Content line — stop metadata parsing
                    break;
                }
            }
            // Collect content until next ## or ---
            const contentLines = [];
            while (i < lines.length) {
                const cl = lines[i];
                if (cl.trim().startsWith("## ") || cl.trim() === "---") {
                    break;
                }
                contentLines.push(cl);
                i++;
            }
            const entryContent = contentLines.join("\n").trim();
            if (entryContent) {
                entries.push({
                    id: `wb_${fileName.replace(/\.md$/, "")}_${title.replace(/\s+/g, "_")}`,
                    keywords,
                    content: entryContent,
                    priority,
                    permanent,
                    enabled: true,
                    intrinsicValue,
                    linkTriggers,
                });
            }
            // suppress unused-var lint for contentStart (kept for parity with original structure)
            void contentStart;
        }
        return entries;
    }
    // ── DMAE Scoring Layer: update Activation/US/MS for all entries every round ──
    // v3.4 Formulas:
    //   reward = userHit ? rewardGain * Wake(US_old) * Eff(A_old) : 0   (I does not participate in Reward)
    //   decay  = (alpha * US_new^2 + beta * MS_new^2) / sqrt(I)          (I in Resistance only)
    //   A_new  = clamp(A_old + reward - decay, 0, MaxScore)
    //   if userHit && A_old == Archived: A_new = max(A_new, I)         (Floor on resurrection from Archived)
    // MS semantics: turns since last entry into context (reset by userHit or modelHit).
    // ModelHit: resets msNew = 0 without positive reward.
    // Snapshot semantics: entries evaluated independently from old state.
    updateActivation(userText, modelText) {
        const user = userText ?? "";
        const model = modelText ?? "";
        const params = this.params;
        const max = params.maxScore;
        const changed = [];
        // ── Pass 1: Collect all userHit entry IDs this round ──
        const userHitEntryIds = new Set();
        for (const entry of this.entries) {
            if (!entry.enabled || entry.permanent)
                continue;
            if (entry.keywords.length === 0)
                continue;
            if (entry.keywords.some((kw) => user.includes(kw))) {
                userHitEntryIds.add(entry.id);
            }
        }
        for (const entry of this.entries) {
            if (!entry.enabled || entry.permanent)
                continue;
            if (entry.keywords.length === 0)
                continue;
            const st = this.state.get(entry.id);
            if (!st)
                continue;
            // ─ snapshot old ─
            const aOld = st.activation;
            const usOld = st.userSilence;
            const msOld = st.modelSilence;
            // ─ hits ─
            const userHit = entry.keywords.some((kw) => user.includes(kw));
            const modelHit = entry.keywords.some((kw) => model.includes(kw));
            // ─ silence update ─
            const usNew = userHit ? 0 : usOld + 1;
            // MS = turns since last entry into context. User prompt OR model reply counts as context entry,
            // so userHit also resets ms to avoid wrongful decay.
            const msNew = (userHit || modelHit) ? 0 : msOld + 1;
            // - positive: user reward (userHit only, I does not participate) -
            const userReward = userHit
                ? this.rewardStrategy.userReward({ entry, snap: { activation: aOld, userSilence: usOld, modelSilence: msOld }, params })
                : 0;
            // - negative: decay (I in resistance only) -
            const decay = this.decayStrategy.compute({
                entry,
                snap: { userSilence: usNew, modelSilence: msNew },
                params,
            });
            // - positive: model reward (modelHit + Active gating only) -
            // v4.0: Rm = Bm * e^(-lambda * U_old), awarded only when A >= PromptThreshold
            // v4.0 invariant: Rm < D strictly holds via main loop clamp
            let modelReward = 0;
            if (modelHit && deriveState(aOld, params.promptThreshold) === worldbook_constants_1.WORLDBOOK_STATES.ACTIVE) {
                const rawRm = this.rewardStrategy.modelReward({ entry, snap: { activation: aOld, userSilence: usOld, modelSilence: msOld }, params });
                // Invariant clamp: Rm = min(Rm, D - eps)
                modelReward = Math.max(0, Math.min(rawRm, decay - worldbook_constants_1.WORLDBOOK_CONSTANTS.EPSILON));
            }
            // ─ commit ─
            let aNew = aOld + userReward + modelReward - decay;
            aNew = Math.max(0, aNew);
            // Floor triggered only on resurrection from Archived
            if (userHit && deriveState(aOld, params.promptThreshold) === worldbook_constants_1.WORLDBOOK_CONSTANTS.FLOOR_TRIGGER_STATE) {
                aNew = Math.max(aNew, entry.intrinsicValue);
            }
            aNew = Math.min(max, aNew);
            st.activation = aNew;
            st.userSilence = usNew;
            st.modelSilence = msNew;
            if (this.debug && (userHit || modelHit || Math.abs(aNew - aOld) >= 0.05)) {
                const reasons = [];
                if (userHit)
                    reasons.push(`U+${userReward.toFixed(2)}`);
                if (modelHit)
                    reasons.push(`M+${modelReward.toFixed(2)}`);
                if (decay > 0)
                    reasons.push(`D-${decay.toFixed(2)}`);
                if (userHit && deriveState(aOld, params.promptThreshold) === worldbook_constants_1.WORLDBOOK_CONSTANTS.FLOOR_TRIGGER_STATE)
                    reasons.push(`floor→${entry.intrinsicValue}`);
                changed.push({ id: entry.id, aOld, aNew, reason: reasons.join(" ") });
            }
        }
        if (this.debug && changed.length > 0) {
            console.log(`[Worldbook/DMAE] update: ${changed.length} entries changed`);
            for (const c of changed.slice(0, 12)) {
                console.log(`  ${c.id}: ${c.aOld.toFixed(1)} → ${c.aNew.toFixed(1)}  (${c.reason})`);
            }
        }
        // ── One-Shot Linked Cascade (not stored in DMAE state table, valid for current turn only) ──
        // Rules: only userHit entries have cascade rights; 1-level cap.
        // Anti-loop constraints:
        //   1. 1-level cap: cascade triggered only from userHit, targets do not cascade further
        //   2. userHit intercept: skip cascade targets already in userHit list
        //   3. Deduplicate: an entry cascades at most once per round
        this.lastCascadeEntries = [];
        const cascadeInjected = new Set();
        for (const entry of this.entries) {
            if (!userHitEntryIds.has(entry.id))
                continue;
            if (entry.linkTriggers.length === 0)
                continue;
            if (entry.permanent || !entry.enabled)
                continue;
            // Find child entries corresponding to linkTriggers
            const targets = this.entries.filter(e => e.enabled && !e.permanent &&
                e.keywords.some(kw => entry.linkTriggers.includes(kw)));
            for (const target of targets) {
                // Constraint 2: Skip userHit entries
                if (userHitEntryIds.has(target.id))
                    continue;
                // Constraint 3: Deduplicate cascade entries
                if (cascadeInjected.has(target.id))
                    continue;
                cascadeInjected.add(target.id);
                this.lastCascadeEntries.push(target);
            }
        }
        if (this.debug && this.lastCascadeEntries.length > 0) {
            console.log(`[Worldbook/Cascade] ${this.lastCascadeEntries.length} entries one-shot injected: ${this.lastCascadeEntries.map(e => e.id).join(", ")}`);
        }
    }
    // Get entries triggered by One-Shot cascade this round
    getCascadeEntries() {
        return [...this.lastCascadeEntries];
    }
    // ── Business Layer: Threshold Gating + Prompt Injection ──
    // Inject entries where state == Active; sorted by activation desc, priority desc, capped at MAX_ACTIVE.
    getActiveEntries(promptThreshold) {
        const th = promptThreshold ?? this.params.promptThreshold;
        const active = this.entries
            .filter((e) => {
            if (!e.enabled || e.permanent)
                return false;
            const st = this.state.get(e.id);
            if (!st)
                return false;
            return deriveState(st.activation, th) === worldbook_constants_1.WORLDBOOK_STATES.ACTIVE;
        })
            .sort((a, b) => {
            const sa = this.state.get(a.id).activation;
            const sb = this.state.get(b.id).activation;
            if (sb !== sa)
                return sb - sa;
            return b.priority - a.priority;
        })
            .slice(0, WorldbookManager.MAX_ACTIVE);
        if (this.debug && active.length > 0) {
            console.log(`[Worldbook/DMAE] active entries injected: ${active.length} (threshold=${th})`);
        }
        // Return full content with entry title
        return active.map((e) => {
            // Restore readable title from entry.id: wb_<file>_<title> -> <title>
            const title = e.id.replace(/^wb_[^_]+_/, "").replace(/_/g, " ");
            return `【${title}】\n${e.content}`;
        });
    }
    // Get permanent entries — always included, bypasses DMAE
    getPermanentEntries() {
        return this.entries
            .filter((e) => e.enabled && e.permanent)
            .sort((a, b) => b.priority - a.priority)
            .map((e) => e.content);
    }
    // Get all registered trigger words (legacy, kept for compatibility)
    getAllTriggerWords() {
        const words = new Set();
        for (const entry of this.entries) {
            for (const kw of entry.keywords) {
                words.add(kw);
            }
        }
        return [...words];
    }
    get entriesCount() {
        return this.entries.length;
    }
    // ── Read-only Accessors (Simulator / Debug) ──
    getEntries() {
        return this.entries;
    }
    getState(id) {
        return this.state.get(id);
    }
    // ── Persistence Seam (v1 no-op) ──
    loadState() {
        if (!this.stateFile)
            return;
        // TODO v1.1: fs.readFileSync(this.stateFile) -> deserialize to this.state
        // Volatile in v1, resets on restart
    }
    saveState() {
        if (!this.stateFile)
            return;
        // TODO v1.1: fs.writeFileSync(this.stateFile, JSON.stringify([...this.state]))
    }
}
exports.WorldbookManager = WorldbookManager;

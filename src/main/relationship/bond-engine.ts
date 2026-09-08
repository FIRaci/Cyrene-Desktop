import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import {
  BondLevel,
  BondLevelName,
  BondLevelInfo,
  BOND_LEVELS,
  MAX_BOND_SCORE,
  computeBondLevel,
  formatBondPersonaPrompt,
} from "./bond-persona-config";

export {
  BondLevel,
  BondLevelName,
  BondLevelInfo,
  BOND_LEVELS,
  MAX_BOND_SCORE,
  computeBondLevel,
  formatBondPersonaPrompt,
};

export type BondInteractionType =
  | "chat_message"
  | "pet_gesture"
  | "music_session"
  | "daily_checkin";

export interface DailyBondStats {
  date: string; // YYYY-MM-DD
  chatCount: number;
  petPoints: number; // max 15 per day
  musicPoints: number; // max 15 per day
  checkedIn: boolean; // 10 pts once per day
}

export interface BondState {
  affectionScore: number; // 0 - 1000
  level: BondLevel;
  levelName: BondLevelName;
  lastInteractionAt: number;
  dailyStats: DailyBondStats;
  totalInteractions: number;
  unlockedMilestones: string[];
}

export interface BondEngineDeps {
  filePath?: string;
  now?: () => number;
}

const MAX_DAILY_PET_POINTS = 15;
const MAX_DAILY_MUSIC_POINTS = 15;

function defaultFilePath(): string {
  try {
    return path.join(app.getPath("userData"), "bond-state.json");
  } catch {
    return path.join(process.cwd(), ".cache", "bond-state.json");
  }
}

function todayLocalDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export class BondEngine {
  private filePath: string;
  private nowFn: () => number;
  private state: BondState;
  private loaded = false;

  constructor(deps?: BondEngineDeps) {
    this.filePath = deps?.filePath || defaultFilePath();
    this.nowFn = deps?.now || (() => Date.now());
    this.state = this.createDefaultState();
  }

  private createDefaultState(): BondState {
    const now = this.nowFn();
    const lvl = computeBondLevel(0);
    return {
      affectionScore: 0,
      level: lvl.level,
      levelName: lvl.name,
      lastInteractionAt: now,
      dailyStats: {
        date: todayLocalDate(now),
        chatCount: 0,
        petPoints: 0,
        musicPoints: 0,
        checkedIn: false,
      },
      totalInteractions: 0,
      unlockedMilestones: [],
    };
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<BondState>;
        if (parsed && typeof parsed.affectionScore === "number") {
          const lvl = computeBondLevel(parsed.affectionScore);
          this.state = {
            affectionScore: Math.min(MAX_BOND_SCORE, Math.max(0, parsed.affectionScore)),
            level: lvl.level,
            levelName: lvl.name,
            lastInteractionAt: parsed.lastInteractionAt || this.nowFn(),
            dailyStats: parsed.dailyStats || {
              date: todayLocalDate(this.nowFn()),
              chatCount: 0,
              petPoints: 0,
              musicPoints: 0,
              checkedIn: false,
            },
            totalInteractions: parsed.totalInteractions || 0,
            unlockedMilestones: parsed.unlockedMilestones || [],
          };
          this.checkDayRollOver();
          return;
        }
      }
    } catch (err) {
      console.warn("[BondEngine] Failed to load bond state, using default:", err);
    }
    this.checkDayRollOver();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      console.warn("[BondEngine] Failed to save bond state:", err);
    }
  }

  private checkDayRollOver(): void {
    const today = todayLocalDate(this.nowFn());
    if (this.state.dailyStats.date !== today) {
      this.state.dailyStats = {
        date: today,
        chatCount: 0,
        petPoints: 0,
        musicPoints: 0,
        checkedIn: false,
      };
    }
  }

  public getState(): BondState {
    this.ensureLoaded();
    this.checkDayRollOver();
    return { ...this.state, dailyStats: { ...this.state.dailyStats } };
  }

  public recordInteraction(type: BondInteractionType): {
    pointsAwarded: number;
    newScore: number;
    levelUp: boolean;
    currentLevel: BondLevelInfo;
  } {
    this.ensureLoaded();
    this.checkDayRollOver();

    let points = 0;
    const stats = this.state.dailyStats;

    switch (type) {
      case "chat_message":
        points = 2;
        stats.chatCount += 1;
        break;

      case "pet_gesture": {
        const remaining = Math.max(0, MAX_DAILY_PET_POINTS - stats.petPoints);
        points = Math.min(3, remaining);
        stats.petPoints += points;
        break;
      }

      case "music_session": {
        const remaining = Math.max(0, MAX_DAILY_MUSIC_POINTS - stats.musicPoints);
        points = Math.min(5, remaining);
        stats.musicPoints += points;
        break;
      }

      case "daily_checkin":
        if (!stats.checkedIn) {
          points = 10;
          stats.checkedIn = true;
        }
        break;
    }

    const oldLevel = this.state.level;
    this.state.affectionScore = Math.min(MAX_BOND_SCORE, this.state.affectionScore + points);
    const newLevelInfo = computeBondLevel(this.state.affectionScore);
    this.state.level = newLevelInfo.level;
    this.state.levelName = newLevelInfo.name;
    this.state.lastInteractionAt = this.nowFn();
    this.state.totalInteractions += 1;

    const levelUp = newLevelInfo.level > oldLevel;
    if (levelUp && !this.state.unlockedMilestones.includes(newLevelInfo.name)) {
      this.state.unlockedMilestones.push(newLevelInfo.name);
    }

    this.save();

    return {
      pointsAwarded: points,
      newScore: this.state.affectionScore,
      levelUp,
      currentLevel: newLevelInfo,
    };
  }

  public setScore(score: number): void {
    this.ensureLoaded();
    this.state.affectionScore = Math.min(MAX_BOND_SCORE, Math.max(0, score));
    const lvl = computeBondLevel(this.state.affectionScore);
    this.state.level = lvl.level;
    this.state.levelName = lvl.name;
    this.save();
  }

  public reset(): void {
    this.state = this.createDefaultState();
    this.save();
  }

  public buildBondPersonaPrompt(): string {
    const s = this.getState();
    return formatBondPersonaPrompt({
      affectionScore: s.affectionScore,
      totalInteractions: s.totalInteractions,
    });
  }
}

let bondEngineInstance: BondEngine | null = null;

export function getBondEngine(deps?: BondEngineDeps): BondEngine {
  if (deps) return new BondEngine(deps);
  if (!bondEngineInstance) {
    bondEngineInstance = new BondEngine();
  }
  return bondEngineInstance;
}

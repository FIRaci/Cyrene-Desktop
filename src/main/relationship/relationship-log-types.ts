export type RelationshipChannel = "desktop" | "wechat" | "feishu";

export interface RelationshipTurnInput {
  userText: string;
  assistantText: string;
  cyreneFeeling: string;
  channel: RelationshipChannel;
}

export interface RelationshipLogEntry extends RelationshipTurnInput {
  id: string;
  date: string;
  createdAt: number;
  userMood: string;
  relationshipSignal: string;
  importantMoment?: string;
  nextCareCue: string;
}

export interface RelationshipDailySummary {
  date: string;
  updatedAt: number;
  summary: string;
  nextCareCue: string;
}

export interface RelationshipLogData {
  entries: RelationshipLogEntry[];
  dailySummaries: RelationshipDailySummary[];
}

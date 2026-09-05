// Sticker system shared types (shared by main / renderer)

/** Built-in sticker ID list (used by renderer to determine origin) */
export const BUILT_IN_STICKER_IDS = [
  "playful",
  "love-happy",
  "confident",
  "serious",
  "calm",
  "peek",
  "clingy-confused",
  "love-calm",
  "HI",
  "hello",
  "goodmoring1",
  "goodnight",
  "teatime",
  "eating",
  "Allset",
  "OK",
  "copythat",
  "Thumbsup",
  "awesome",
  "sogood",
  "sonice",
  "fighting",
  "hellyeah",
  "Thanks",
  "foryou",
  "blushhard",
  "shyshort",
  "hmph",
  "hugtight",
  "Airkiss",
  "Gigglelots",
  "thinking",
  "putmd",
  "Whatswrong",
  "midmeh",
  "awkward",
  "Madnow",
  "Hurtcry",
  "Sobbinghard",
  "weeploud",
  "PanincCrying",
  "missme",
  "Free",
  "Dreak",
  "outfast",
  "Vcayover",
  "sleepynow",
  "deadtired",
  "sotired",
  "giveup",
  "poorwallet",
  "please",
] as const;

/** Union type of built-in sticker IDs */
export type BuiltInStickerId = (typeof BUILT_IN_STICKER_IDS)[number];

/** Arbitrary sticker ID (built-in ID or user-defined string) */
export type AnyStickerId = string;

/** Metadata of user-added stickers (persisted in userData/sticker-manifest.json) */
export interface UserStickerMeta {
  id: string;
  file: string;
  description: string;
  phrases: string[];
  createdAt: number;
}

/** Configuration item for sticker management window */
export interface StickerConfigItem {
  id: string;
  src: string;
  enabled: boolean;
  builtIn: boolean;
  description?: string;
}

/** Sticker size */
export type StickerSize = "small" | "standard" | "large";
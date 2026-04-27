import { playExclusiveSfxFromUrl } from "./audio-mixer.js";
import { publicAssetUrl } from "./asset-url.js";
import { UnitType, type UnitType as UnitTypeValue } from "../../shared/game-rules.js";

const VILLAGER_POOL = [
  "action0.ogg",
  "action1.ogg",
  "action2.ogg",
  "action3.ogg",
  "action4.ogg",
  "action5.ogg",
  "action6.ogg",
] as const;

/** 5 latest military command lines — random pick on each user action. */
const MILITARY_POOL = [
  "action0.ogg",
  "action1.ogg",
  "action2.ogg",
  "action3.ogg",
  "action4.ogg",
] as const;

const POOL_BY_SUBDIR: Record<string, readonly string[]> = {
  villager: VILLAGER_POOL as unknown as string[],
  military: [...MILITARY_POOL],
};

/**
 * `villager` = economy; `military` = WARBAND / ARCHER / SYNTHAUR (all play the same 5-clip pool).
 */
export const VOICE_DIR_BY_UNIT: Partial<Record<UnitTypeValue, string>> = {
  [UnitType.VILLAGER]: "villager",
  [UnitType.WARBAND]: "military",
  [UnitType.ARCHER]: "military",
  [UnitType.SYNTHAUR]: "military",
};

export const DEFAULT_COMMAND_VOICE_UNIT = UnitType.VILLAGER;

/** In this build, the only non-villager controllable units are the three military line types. */
export function isMilitaryUnitType(u: UnitTypeValue): boolean {
  return u !== UnitType.VILLAGER;
}

function playOneShot(url: string): void {
  void playExclusiveSfxFromUrl(url, { clipLinear: 0.5, pitchCentsMax: 11 });
}

function playRandomForSubdir(subdir: string): void {
  const pool = POOL_BY_SUBDIR[subdir];
  if (pool == null || pool.length === 0) return;
  const name = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  if (!name) return;
  playOneShot(publicAssetUrl(`audio/voice/${subdir}/${name}`));
}

function getSubdirForUnit(unitType: UnitTypeValue): string | null {
  return VOICE_DIR_BY_UNIT[unitType] ?? null;
}

export function hasUnitVoiceSet(unitType: UnitTypeValue): boolean {
  return getSubdirForUnit(unitType) != null;
}

export function playUnitVoice(unitType: UnitTypeValue): void {
  const sub = getSubdirForUnit(unitType);
  if (!sub) return;
  playRandomForSubdir(sub);
}

export function playDefaultCommandVoice(): void {
  playUnitVoice(DEFAULT_COMMAND_VOICE_UNIT);
}

export function playUnitVoiceOrDefault(unitType: UnitTypeValue): void {
  if (hasUnitVoiceSet(unitType)) {
    playUnitVoice(unitType);
  } else {
    playDefaultCommandVoice();
  }
}

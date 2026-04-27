import { playExclusiveSfxFromUrl } from "./audio-mixer.js";
import { publicAssetUrl } from "./asset-url.js";
import { UnitType, type UnitType as UnitTypeValue } from "../../shared/game-rules.js";

/**
 * Pooled lines under `public/audio/voice/{unit}/` — one clip per `ACTION_POOL` entry.
 * On each bark we pick a random file from the pool (no per-action mapping yet).
 */
const ACTION_POOL = [
  "action0.ogg",
  "action1.ogg",
  "action2.ogg",
  "action3.ogg",
  "action4.ogg",
  "action5.ogg",
  "action6.ogg",
] as const;

/**
 * Maps game unit type → subdirectory of `public/audio/voice/`.
 * Copy the same `action*.ogg` set into each new unit folder and bump `ACTION_POOL` if you add more clips.
 */
export const VOICE_DIR_BY_UNIT: Partial<Record<UnitTypeValue, string>> = {
  [UnitType.VILLAGER]: "villager",
};

export const DEFAULT_COMMAND_VOICE_UNIT = UnitType.VILLAGER;

function randomActionFilename(): (typeof ACTION_POOL)[number] {
  const i = Math.floor(Math.random() * ACTION_POOL.length);
  return ACTION_POOL[i] ?? ACTION_POOL[0]!;
}

function playOneShot(url: string): void {
  void playExclusiveSfxFromUrl(url, { clipLinear: 0.5, pitchCentsMax: 11 });
}

function playRandomForSubdir(subdir: string): void {
  const url = publicAssetUrl(`audio/voice/${subdir}/${randomActionFilename()}`);
  playOneShot(url);
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

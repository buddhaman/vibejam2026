/**
 * Shared gameplay constants and numeric wire values.
 * Server authority and client prediction should both import from here.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const SquadSpread = {
  TIGHT: 0,
  DEFAULT: 1,
  WIDE: 2,
} as const;

export type SquadSpread = (typeof SquadSpread)[keyof typeof SquadSpread];

export function isBuildingType(value: unknown): value is BuildingType {
  return value === BuildingType.BARRACKS || value === BuildingType.TOWER;
}

export function isSquadSpread(value: unknown): value is SquadSpread {
  return value === SquadSpread.TIGHT || value === SquadSpread.DEFAULT || value === SquadSpread.WIDE;
}

export const GAME_RULES = {
  TICK_HZ: 20,
  WORLD_MIN: -120,
  WORLD_MAX: 120,
  TILE_SIZE: 12,
  BLOB_MOVE_SPEED: 28,
  BLOB_ACCELERATION: 26,
  BLOB_DECELERATION_RADIUS: 14,
  BLOB_STOP_EPSILON: 0.65,
  CLIENT_PREDICTION_LEAD: 0.09,
  UNIT_RADIUS: 0.42,
  UNIT_HEIGHT: 0.78,
  UNIT_SPACING: 1.1,
  SQUAD_PACKING_DENSITY: 0.74,
  SQUAD_STRETCH_MAX: 1.55,
  SQUAD_STRETCH_DISTANCE: 18,
  DEFAULT_BLOB_HEALTH: 100,
  DEFAULT_UNIT_COUNT: 40,
  START_BLOB_SPACING: 10,
  BARRACKS_HEALTH: 200,
  TOWER_HEALTH: 300,
  MAX_BUILDINGS_PER_PLAYER: 8,
} as const;

export function getSquadArea(unitCount: number): number {
  return getSquadAreaForSpread(unitCount, SquadSpread.DEFAULT);
}

export function getSquadAreaForSpread(unitCount: number, spread: SquadSpread): number {
  const count = Math.max(0, unitCount);
  const footprintRadius = GAME_RULES.UNIT_RADIUS * GAME_RULES.UNIT_SPACING * getSquadSpacingMultiplier(spread);
  const footprintArea = Math.PI * footprintRadius * footprintRadius;
  return (count * footprintArea) / GAME_RULES.SQUAD_PACKING_DENSITY;
}

export function getSquadSpacingMultiplier(spread: SquadSpread): number {
  if (spread === SquadSpread.WIDE) return 1.34;
  if (spread === SquadSpread.DEFAULT) return 1.12;
  return 0.9;
}

export function getSquadBaseStretch(spread: SquadSpread): number {
  if (spread === SquadSpread.WIDE) return 1.75;
  if (spread === SquadSpread.DEFAULT) return 1.28;
  return 1;
}

export function getSquadTravelStretch(moveDistance: number, speed: number): number {
  const t = 1 - Math.exp(-Math.max(0, moveDistance) / GAME_RULES.SQUAD_STRETCH_DISTANCE);
  const speedT = Math.max(0, Math.min(1, speed / GAME_RULES.BLOB_MOVE_SPEED));
  const blend = Math.max(t, speedT * 0.9);
  return 1 + (GAME_RULES.SQUAD_STRETCH_MAX - 1) * blend;
}

export function getSquadAxes(unitCount: number, moveDistance: number, speed: number, spread: SquadSpread) {
  const area = Math.max(
    getSquadAreaForSpread(unitCount, spread),
    Math.PI * GAME_RULES.UNIT_RADIUS * GAME_RULES.UNIT_RADIUS
  );
  const stretch = getSquadBaseStretch(spread) * getSquadTravelStretch(moveDistance, speed);
  const minor = Math.sqrt(area / (Math.PI * stretch));
  const major = minor * stretch;
  return { major, minor };
}

export function getSquadRadius(unitCount: number, spread: SquadSpread): number {
  return Math.sqrt(getSquadAreaForSpread(unitCount, spread) / Math.PI);
}

export function getWorldTileCount(): number {
  return Math.round((GAME_RULES.WORLD_MAX - GAME_RULES.WORLD_MIN) / GAME_RULES.TILE_SIZE);
}

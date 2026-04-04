/**
 * Shared gameplay constants and numeric wire values.
 * Server authority and client prediction should both import from here.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export function isBuildingType(value: unknown): value is BuildingType {
  return value === BuildingType.BARRACKS || value === BuildingType.TOWER;
}

export const GAME_RULES = {
  TICK_HZ: 20,
  WORLD_MIN: -120,
  WORLD_MAX: 120,
  BLOB_MOVE_SPEED: 28,
  BLOB_RADIUS_PER_SQRT_UNIT: 0.6324555320336759,
  DEFAULT_BLOB_HEALTH: 100,
  DEFAULT_UNIT_COUNT: 40,
  START_BLOB_SPACING: 10,
  BARRACKS_HEALTH: 200,
  TOWER_HEALTH: 300,
  MAX_BUILDINGS_PER_PLAYER: 8,
} as const;

export function getBlobRadius(unitCount: number): number {
  return Math.sqrt(Math.max(0, unitCount)) * GAME_RULES.BLOB_RADIUS_PER_SQRT_UNIT;
}

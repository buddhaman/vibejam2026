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
  TILE_SIZE: 12,
  BLOB_MOVE_SPEED: 28,
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
  const count = Math.max(0, unitCount);
  const footprintRadius = GAME_RULES.UNIT_RADIUS * GAME_RULES.UNIT_SPACING;
  const footprintArea = Math.PI * footprintRadius * footprintRadius;
  return (count * footprintArea) / GAME_RULES.SQUAD_PACKING_DENSITY;
}

export function getSquadStretch(moveDistance: number): number {
  const t = 1 - Math.exp(-Math.max(0, moveDistance) / GAME_RULES.SQUAD_STRETCH_DISTANCE);
  return 1 + (GAME_RULES.SQUAD_STRETCH_MAX - 1) * t;
}

export function getSquadAxes(unitCount: number, moveDistance: number) {
  const area = Math.max(getSquadArea(unitCount), Math.PI * GAME_RULES.UNIT_RADIUS * GAME_RULES.UNIT_RADIUS);
  const stretch = getSquadStretch(moveDistance);
  const minor = Math.sqrt(area / (Math.PI * stretch));
  const major = minor * stretch;
  return { major, minor };
}

export function getSquadRadius(unitCount: number): number {
  return Math.sqrt(getSquadArea(unitCount) / Math.PI);
}

export function getWorldTileCount(): number {
  return Math.round((GAME_RULES.WORLD_MAX - GAME_RULES.WORLD_MIN) / GAME_RULES.TILE_SIZE);
}

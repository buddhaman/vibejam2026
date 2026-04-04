/**
 * Shared gameplay constants and numeric wire values.
 * Server authority and client prediction should both import from here.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
  TOWN_CENTER: 3,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const UnitType = {
  VILLAGER: 1,
  WARBAND: 2,
} as const;

export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export type ResourceCost = {
  food: number;
  wood: number;
  gold: number;
};

export const SquadSpread = {
  TIGHT: 0,
  DEFAULT: 1,
  WIDE: 2,
} as const;

export type SquadSpread = (typeof SquadSpread)[keyof typeof SquadSpread];

export function isBuildingType(value: unknown): value is BuildingType {
  return value === BuildingType.BARRACKS || value === BuildingType.TOWER || value === BuildingType.TOWN_CENTER;
}

export function isUnitType(value: unknown): value is UnitType {
  return value === UnitType.VILLAGER || value === UnitType.WARBAND;
}

export function isSquadSpread(value: unknown): value is SquadSpread {
  return value === SquadSpread.TIGHT || value === SquadSpread.DEFAULT || value === SquadSpread.WIDE;
}

export const GAME_RULES = {
  TICK_HZ: 20,
  WORLD_MIN: -120,
  WORLD_MAX: 120,
  TILE_SIZE: 12,
  BLOB_MOVE_SPEED: 11,
  BLOB_ACCELERATION: 10,
  BLOB_DECELERATION_RADIUS: 14,
  BLOB_STOP_EPSILON: 0.65,
  CLIENT_PREDICTION_LEAD: 0.09,
  UNIT_RADIUS: 0.56,
  UNIT_HEIGHT: 1.18,
  UNIT_SPACING: 1.22,
  SQUAD_PACKING_DENSITY: 0.74,
  SQUAD_STRETCH_MAX: 1.55,
  SQUAD_STRETCH_DISTANCE: 18,
  DEFAULT_BLOB_HEALTH: 100,
  DEFAULT_UNIT_COUNT: 40,
  START_BLOB_SPACING: 10,
  START_FOOD: 500,
  START_WOOD: 300,
  START_GOLD: 200,
  BARRACKS_HEALTH: 200,
  TOWER_HEALTH: 300,
  TOWN_CENTER_HEALTH: 950,
  MAX_BUILDINGS_PER_PLAYER: 8,
} as const;

const TILE_HALF = GAME_RULES.TILE_SIZE * 0.5;
const TILE_CENTER_MIN = GAME_RULES.WORLD_MIN + TILE_HALF;
const TILE_CENTER_MAX = GAME_RULES.WORLD_MAX - TILE_HALF;

export const BUILDING_RULES = {
  [BuildingType.BARRACKS]: {
    label: "Barracks",
    health: GAME_RULES.BARRACKS_HEALTH,
    buildable: true,
    cost: { food: 0, wood: 175, gold: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 6.2,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    producibleUnits: [UnitType.WARBAND],
  },
  [BuildingType.TOWER]: {
    label: "Tower",
    health: GAME_RULES.TOWER_HEALTH,
    buildable: true,
    cost: { food: 0, wood: 125, gold: 50 },
    footprintWidth: GAME_RULES.TILE_SIZE * 0.78,
    footprintDepth: GAME_RULES.TILE_SIZE * 0.78,
    selectionWidth: GAME_RULES.TILE_SIZE * 0.86,
    selectionDepth: GAME_RULES.TILE_SIZE * 0.86,
    height: 15.5,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE * 0.9,
    producibleUnits: [],
  },
  [BuildingType.TOWN_CENTER]: {
    label: "Town Center",
    health: GAME_RULES.TOWN_CENTER_HEALTH,
    buildable: false,
    cost: { food: 0, wood: 0, gold: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE * 1.36,
    footprintDepth: GAME_RULES.TILE_SIZE * 1.36,
    selectionWidth: GAME_RULES.TILE_SIZE * 1.4,
    selectionDepth: GAME_RULES.TILE_SIZE * 1.4,
    height: 8.8,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE * 1.1,
    producibleUnits: [UnitType.VILLAGER],
  },
} as const;

export const UNIT_RULES = {
  [UnitType.VILLAGER]: {
    label: "Villager",
    detail: "Gatherer",
    cost: { food: 50, wood: 0, gold: 0 },
    trainTimeMs: 9000,
    health: 55,
    unitCount: 1,
    visualScale: 0.82,
  },
  [UnitType.WARBAND]: {
    label: "Warband",
    detail: "Heavy infantry squad",
    cost: { food: 80, wood: 0, gold: 35 },
    trainTimeMs: 12000,
    health: GAME_RULES.DEFAULT_BLOB_HEALTH,
    unitCount: 12,
    visualScale: 1,
  },
} as const;

export function getBuildingRules(buildingType: BuildingType) {
  return BUILDING_RULES[buildingType] ?? BUILDING_RULES[BuildingType.BARRACKS];
}

export function getUnitRules(unitType: UnitType) {
  return UNIT_RULES[unitType] ?? UNIT_RULES[UnitType.WARBAND];
}

export function canBuildingProduceUnit(buildingType: BuildingType, unitType: UnitType): boolean {
  return getBuildingRules(buildingType).producibleUnits.some((candidate) => candidate === unitType);
}

export function formatResourceCost(cost: ResourceCost): string {
  const parts: string[] = [];
  if (cost.food > 0) parts.push(`${cost.food}F`);
  if (cost.wood > 0) parts.push(`${cost.wood}W`);
  if (cost.gold > 0) parts.push(`${cost.gold}G`);
  return parts.length > 0 ? parts.join("  ") : "Free";
}

export function canAfford(resources: ResourceCost, cost: ResourceCost): boolean {
  return resources.food >= cost.food && resources.wood >= cost.wood && resources.gold >= cost.gold;
}

export function subtractCost(resources: ResourceCost, cost: ResourceCost): ResourceCost {
  return {
    food: resources.food - cost.food,
    wood: resources.wood - cost.wood,
    gold: resources.gold - cost.gold,
  };
}

export function snapCoordinateToTileCenter(value: number): number {
  const clamped = Math.max(TILE_CENTER_MIN, Math.min(TILE_CENTER_MAX, value));
  const tileIndex = Math.round((clamped - TILE_CENTER_MIN) / GAME_RULES.TILE_SIZE);
  return TILE_CENTER_MIN + tileIndex * GAME_RULES.TILE_SIZE;
}

export function snapWorldToTileCenter(x: number, z: number) {
  return {
    x: snapCoordinateToTileCenter(x),
    z: snapCoordinateToTileCenter(z),
  };
}

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
  if (spread === SquadSpread.WIDE) return 1.72;
  if (spread === SquadSpread.DEFAULT) return 1.18;
  return 0.98;
}

export function getSquadBaseStretch(spread: SquadSpread): number {
  if (spread === SquadSpread.WIDE) return 0.72;
  if (spread === SquadSpread.DEFAULT) return 1.28;
  return 1.08;
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
  const travelStretch = getSquadTravelStretch(moveDistance, speed);
  const stretch = getSquadBaseStretch(spread) * travelStretch;
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

/**
 * Shared gameplay constants and numeric wire values.
 * Server authority and client prediction should both import from here.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
  TOWN_CENTER: 3,
  ARCHERY_RANGE: 4,
  STABLE: 5,
  FARM: 6,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const UnitType = {
  VILLAGER: 1,
  WARBAND: 2,
  ARCHER: 3,
  SYNTHAUR: 4,
  /** Legacy alias kept so older references keep working while the project moves to the correct name. */
  CENTAUR: 4,
} as const;

export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export type ResourceCost = {
  biomass: number;
  material: number;
  compute: number;
};

export const TileType = {
  GRASS: 1,
  FOREST: 2,
} as const;

export type TileType = (typeof TileType)[keyof typeof TileType];

export const SquadSpread = {
  TIGHT: 0,
  DEFAULT: 1,
  WIDE: 2,
} as const;

export type SquadSpread = (typeof SquadSpread)[keyof typeof SquadSpread];

export function isBuildingType(value: unknown): value is BuildingType {
  return (
    value === BuildingType.BARRACKS ||
    value === BuildingType.TOWER ||
    value === BuildingType.TOWN_CENTER ||
    value === BuildingType.ARCHERY_RANGE ||
    value === BuildingType.STABLE ||
    value === BuildingType.FARM
  );
}

export function isUnitType(value: unknown): value is UnitType {
  return (
    value === UnitType.VILLAGER ||
    value === UnitType.WARBAND ||
    value === UnitType.ARCHER ||
    value === UnitType.SYNTHAUR ||
    value === UnitType.CENTAUR
  );
}

export function isTileType(value: unknown): value is TileType {
  return value === TileType.GRASS || value === TileType.FOREST;
}

export function isSquadSpread(value: unknown): value is SquadSpread {
  return value === SquadSpread.TIGHT || value === SquadSpread.DEFAULT || value === SquadSpread.WIDE;
}

export const GAME_RULES = {
  TICK_HZ: 20,
  /** Radial KOTH world: bigger map, fixed outer spawns, open center valley. */
  WORLD_MIN: -360,
  WORLD_MAX: 360,
  TILE_SIZE: 12,
  TARGET_PLAYERS_PER_ROOM: 4,
  KOTH_SPAWN_RADIUS: 258,
  KOTH_START_CLEAR_RADIUS: 60,
  KOTH_CENTER_VALLEY_RADIUS: 114,
  KOTH_PER_PLAYER_FOREST_DISTANCE: 90,
  KOTH_PER_PLAYER_COMPUTE_DISTANCE: 78,
  KOTH_CENTER_SERVER_COMPUTE: 1_100,
  KOTH_PLAYER_COMPUTE: 360,
  BLOB_MOVE_SPEED: 11,
  BLOB_ACCELERATION: 10,
  BLOB_DECELERATION_RADIUS: 14,
  BLOB_STOP_EPSILON: 0.65,
  BLOB_COMBAT_ENGAGE_PADDING: 2.5,
  /** While mutually engaged, both blobs move toward a shared center until they overlap (world units/sec). */
  ENGAGE_OVERLAP_CONVERGE_SPEED: 16,
  /** When centers are this close, snap to identical position for a stable stacked fight. */
  ENGAGE_OVERLAP_EPSILON: 0.12,
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
  START_BIOMASS: 500,
  START_MATERIAL: 300,
  START_COMPUTE: 200,
  /** Free starting squads spawned with your first town center (release defaults). */
  START_AGENT_UNIT_COUNT: 3,
  START_WARBAND_UNIT_COUNT: 0,
  START_ARCHER_UNIT_COUNT: 0,
  START_SYNTHAUR_UNIT_COUNT: 0,
  START_CENTAUR_UNIT_COUNT: 0,
  /** Release uses longer production; dev can override this to be much faster. */
  UNIT_TRAIN_TIME_MULTIPLIER: 1.8,
  /** World-unit radius from center (0,0) within which a blob captures the central server. */
  KOTH_CAPTURE_RADIUS: 40,
  /** Starting countdown per player in ms (5 minutes). First to reach 0 wins. */
  KOTH_START_TIME_MS: 300_000,
  FARM_GROWTH_MS: 10000,
  BARRACKS_HEALTH: 200,
  ARCHERY_RANGE_HEALTH: 190,
  STABLE_HEALTH: 240,
  FARM_HEALTH: 120,
  TOWER_HEALTH: 300,
  TOWER_ATTACK_RANGE: 92,
  TOWER_DAMAGE_PER_SEC: 18,
  TOWN_CENTER_HEALTH: 950,
  MAX_BUILDINGS_PER_PLAYER: 64,
  FOREST_WOOD_MAX: 2400,
  /** Per-player compute site size; central server uses a larger dedicated value. */
  DATACENTER_COMPUTE_MAX: 300,
  /** Per second while a villager squad is idle on a resource tile. */
  VILLAGER_GATHER_MATERIAL_PER_SEC: 34,
  VILLAGER_GATHER_COMPUTE_PER_SEC: 28,
  MOUNTAIN_THRESHOLD: 7.2,
} as const;

const TILE_HALF = GAME_RULES.TILE_SIZE * 0.5;
const TILE_CENTER_MIN = GAME_RULES.WORLD_MIN + TILE_HALF;
const TILE_CENTER_MAX = GAME_RULES.WORLD_MAX - TILE_HALF;

/** All buildings occupy exactly one tile for placement, blocking, and walk/build flags (`footprint*` / `selection*`). */
export const BUILDING_RULES = {
  [BuildingType.BARRACKS]: {
    label: "Stratégion",
    detail: "Produces hoplites",
    health: GAME_RULES.BARRACKS_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 175, compute: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 6.2,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: true,
    attackRange: 0,
    damagePerSec: 0,
    producibleUnits: [UnitType.WARBAND],
  },
  [BuildingType.TOWER]: {
    label: "Pyrgos",
    detail: "Lightning tower",
    health: GAME_RULES.TOWER_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 125, compute: 50 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 15.5,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: true,
    attackRange: GAME_RULES.TOWER_ATTACK_RANGE,
    damagePerSec: GAME_RULES.TOWER_DAMAGE_PER_SEC,
    producibleUnits: [],
  },
  [BuildingType.TOWN_CENTER]: {
    label: "Agora",
    detail: "Produces agents",
    health: GAME_RULES.TOWN_CENTER_HEALTH,
    buildable: false,
    cost: { biomass: 0, material: 0, compute: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 8.8,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: true,
    attackRange: 0,
    damagePerSec: 0,
    producibleUnits: [UnitType.VILLAGER],
  },
  [BuildingType.ARCHERY_RANGE]: {
    label: "Toxotikon",
    detail: "Produces archers",
    health: GAME_RULES.ARCHERY_RANGE_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 150, compute: 30 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 5.9,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: true,
    attackRange: 0,
    damagePerSec: 0,
    producibleUnits: [UnitType.ARCHER],
  },
  [BuildingType.STABLE]: {
    label: "Synthaurion",
    detail: "Produces synthaurs",
    health: GAME_RULES.STABLE_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 210, compute: 80 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 6.8,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: true,
    attackRange: 0,
    damagePerSec: 0,
    producibleUnits: [UnitType.SYNTHAUR],
  },
  [BuildingType.FARM]: {
    label: "Kleros",
    detail: "Food field",
    health: GAME_RULES.FARM_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 70, compute: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 2.2,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    blocksWalk: false,
    attackRange: 0,
    damagePerSec: 0,
    producibleUnits: [],
  },
} as const;

export const UNIT_RULES = {
  [UnitType.VILLAGER]: {
    label: "Agent",
    detail: "Resource Gatherer",
    cost: { biomass: 50, material: 0, compute: 0 },
    trainTimeMs: 9000,
    health: 55,
    unitCount: 1,
    visualScale: 0.82,
    dpsPerUnit: 0.35,
    meleeDpsPerUnit: 0.35,
    targetSize: 3,
    rebalanceThreshold: 1,
    mergeDistance: 28,
    moveSpeed: 12,
    acceleration: 34,
    decelerationRadius: 6,
    retreatSpeedMultiplier: 0.25,
    canAlwaysDisengage: false,
    attackStyle: "melee",
    attackRange: 0,
    projectileSpeed: 0,
  },
  [UnitType.WARBAND]: {
    label: "Hoplite",
    detail: "Heavy melee squad",
    cost: { biomass: 80, material: 0, compute: 35 },
    trainTimeMs: 12000,
    health: 10,
    unitCount: 12,
    visualScale: 1,
    dpsPerUnit: 0.45,
    meleeDpsPerUnit: 0.45,
    targetSize: 40,
    rebalanceThreshold: 5,
    mergeDistance: 32,
    moveSpeed: 11,
    acceleration: 30,
    decelerationRadius: 6,
    retreatSpeedMultiplier: 0.25,
    canAlwaysDisengage: false,
    attackStyle: "melee",
    attackRange: 0,
    projectileSpeed: 0,
  },
  [UnitType.ARCHER]: {
    label: "Archer",
    detail: "Ranged skirmisher squad",
    cost: { biomass: 70, material: 0, compute: 45 },
    trainTimeMs: 11000,
    health: 8,
    unitCount: 10,
    visualScale: 0.96,
    dpsPerUnit: 0.4,
    meleeDpsPerUnit: 0.2,
    targetSize: 32,
    rebalanceThreshold: 4,
    mergeDistance: 30,
    moveSpeed: 11.5,
    acceleration: 32,
    decelerationRadius: 6,
    retreatSpeedMultiplier: 0.25,
    canAlwaysDisengage: false,
    attackStyle: "ranged",
    attackRange: 34,
    projectileSpeed: 28,
  },
  [UnitType.SYNTHAUR]: {
    label: "Synthaur",
    detail: "Fast shock cavalry",
    cost: { biomass: 110, material: 0, compute: 90 },
    trainTimeMs: 14500,
    health: 18,
    unitCount: 6,
    visualScale: 1.18,
    dpsPerUnit: 0.9,
    meleeDpsPerUnit: 0.9,
    targetSize: 18,
    rebalanceThreshold: 2,
    mergeDistance: 34,
    moveSpeed: 16.5,
    acceleration: 42,
    decelerationRadius: 7,
    retreatSpeedMultiplier: 0.25,
    canAlwaysDisengage: true,
    attackStyle: "melee",
    attackRange: 0,
    projectileSpeed: 0,
  },
} as const;

export function getBuildingRules(buildingType: BuildingType) {
  return BUILDING_RULES[buildingType] ?? BUILDING_RULES[BuildingType.BARRACKS];
}

export function getUnitRules(unitType: UnitType) {
  return UNIT_RULES[unitType] ?? UNIT_RULES[UnitType.WARBAND];
}

export function getUnitTrainCost(unitType: UnitType): ResourceCost {
  const rules = getUnitRules(unitType);
  const count = Math.max(1, rules.unitCount);
  return {
    biomass: Math.ceil(rules.cost.biomass / count),
    material: Math.ceil(rules.cost.material / count),
    compute: Math.ceil(rules.cost.compute / count),
  };
}

export function getUnitTrainTimeMs(unitType: UnitType): number {
  const rules = getUnitRules(unitType);
  return Math.max(1, Math.ceil(rules.trainTimeMs / Math.max(1, rules.unitCount)));
}

export function getUnitBalanceRules(unitType: UnitType) {
  const rules = getUnitRules(unitType);
  return {
    targetSize: rules.targetSize,
    rebalanceThreshold: rules.rebalanceThreshold,
    mergeDistance: rules.mergeDistance,
  };
}

export function getBlobMoveRules(unitType: UnitType) {
  const rules = getUnitRules(unitType);
  return {
    moveSpeed: rules.moveSpeed,
    acceleration: rules.acceleration,
    decelerationRadius: rules.decelerationRadius,
    retreatSpeedMultiplier: rules.retreatSpeedMultiplier,
    canAlwaysDisengage: rules.canAlwaysDisengage,
  };
}

export function getBlobMaxHealth(unitType: UnitType, unitCount: number): number {
  return Math.max(0, unitCount) * getUnitRules(unitType).health;
}

export function canBuildingProduceUnit(buildingType: BuildingType, unitType: UnitType): boolean {
  return getBuildingRules(buildingType).producibleUnits.some((candidate) => candidate === unitType);
}

export function formatResourceCost(cost: ResourceCost): string {
  const parts: string[] = [];
  if (cost.biomass > 0) parts.push(`${cost.biomass}B`);
  if (cost.material > 0) parts.push(`${cost.material}M`);
  if (cost.compute > 0) parts.push(`${cost.compute}C`);
  return parts.length > 0 ? parts.join("  ") : "Free";
}

export function canAfford(resources: ResourceCost, cost: ResourceCost): boolean {
  return resources.biomass >= cost.biomass && resources.material >= cost.material && resources.compute >= cost.compute;
}

export function subtractCost(resources: ResourceCost, cost: ResourceCost): ResourceCost {
  return {
    biomass: resources.biomass - cost.biomass,
    material: resources.material - cost.material,
    compute: resources.compute - cost.compute,
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

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

function valueNoise2D(x: number, z: number, seed: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);

  const n00 = hash(ix * 9283.11 + iz * 6899.37 + seed * 0.0001 + 0.381);
  const n10 = hash((ix + 1) * 9283.11 + iz * 6899.37 + seed * 0.0001 + 0.381);
  const n01 = hash(ix * 9283.11 + (iz + 1) * 6899.37 + seed * 0.0001 + 0.381);
  const n11 = hash((ix + 1) * 9283.11 + (iz + 1) * 6899.37 + seed * 0.0001 + 0.381);

  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fz;
}

function fbm2D(x: number, z: number, seed: number, octaves: number) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let totalAmplitude = 0;

  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, z * frequency, seed + i * 97) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return totalAmplitude > 0 ? value / totalAmplitude : 0;
}

function seededFraction(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233 + salt * salt * 0.001) * 43758.5453123;
  return x - Math.floor(x);
}

const TAU = Math.PI * 2;

function wrapAngle(angle: number): number {
  let wrapped = (angle + Math.PI) % TAU;
  if (wrapped < 0) wrapped += TAU;
  return wrapped - Math.PI;
}

function angleDistance(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

type RadialKothLayout = {
  playerCount: number;
  sectorAngle: number;
  rotation: number;
  spawnRadius: number;
  centerValleyRadius: number;
  startClearRadius: number;
  forestDistance: number;
  forestAngleOffset: number;
  computeDistance: number;
  computeAngleOffset: number;
  computeSideSign: -1 | 1;
  mountainHalfAngle: number;
};

function getRadialKothLayout(seed: number, playerCount = GAME_RULES.TARGET_PLAYERS_PER_ROOM): RadialKothLayout {
  const count = Math.max(2, Math.round(playerCount));
  const sectorAngle = TAU / count;
  return {
    playerCount: count,
    sectorAngle,
    rotation: seededFraction(seed, 901) * TAU,
    spawnRadius: GAME_RULES.KOTH_SPAWN_RADIUS,
    centerValleyRadius: GAME_RULES.KOTH_CENTER_VALLEY_RADIUS,
    startClearRadius: GAME_RULES.KOTH_START_CLEAR_RADIUS,
    forestDistance: GAME_RULES.KOTH_PER_PLAYER_FOREST_DISTANCE + Math.round(seededFraction(seed, 902) * 6 - 3),
    forestAngleOffset: sectorAngle * (0.19 + seededFraction(seed, 903) * 0.05),
    computeDistance: GAME_RULES.KOTH_PER_PLAYER_COMPUTE_DISTANCE + Math.round(seededFraction(seed, 904) * 6 - 3),
    computeAngleOffset: sectorAngle * (0.12 + seededFraction(seed, 905) * 0.05),
    computeSideSign: seededFraction(seed, 906) < 0.5 ? -1 : 1,
    mountainHalfAngle: sectorAngle * (0.12 + seededFraction(seed, 907) * 0.025),
  };
}

function polarToWorld(radius: number, angle: number) {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function getSectorAngle(playerIndex: number, layout: RadialKothLayout): number {
  return layout.rotation + playerIndex * layout.sectorAngle;
}

function getNearestSpawnDistance(x: number, z: number, layout: RadialKothLayout): number {
  let best = Infinity;
  for (let i = 0; i < layout.playerCount; i++) {
    const p = polarToWorld(layout.spawnRadius, getSectorAngle(i, layout));
    best = Math.min(best, Math.hypot(x - p.x, z - p.z));
  }
  return best;
}

function getNearestMountainBoundaryDistance(angle: number, layout: RadialKothLayout): number {
  let best = Infinity;
  for (let i = 0; i < layout.playerCount; i++) {
    best = Math.min(best, angleDistance(angle, layout.rotation + (i + 0.5) * layout.sectorAngle));
  }
  return best;
}

export function getPlayerSpawnPoint(
  playerIndex: number,
  playerCount = GAME_RULES.TARGET_PLAYERS_PER_ROOM,
  seed = 0
) {
  const layout = getRadialKothLayout(seed, playerCount);
  const angle = getSectorAngle(playerIndex, layout);
  return snapWorldToTileCenter(Math.cos(angle) * layout.spawnRadius, Math.sin(angle) * layout.spawnRadius);
}

export function getTileKey(tx: number, tz: number): string {
  return `${tx},${tz}`;
}

export function getTileCoordsFromWorld(x: number, z: number) {
  const tiles = getWorldTileCount();
  const tx = Math.max(0, Math.min(tiles - 1, Math.floor((x - GAME_RULES.WORLD_MIN) / GAME_RULES.TILE_SIZE)));
  const tz = Math.max(0, Math.min(tiles - 1, Math.floor((z - GAME_RULES.WORLD_MIN) / GAME_RULES.TILE_SIZE)));
  return { tx, tz };
}

export function getTileCenter(tx: number, tz: number) {
  const min = GAME_RULES.WORLD_MIN + TILE_HALF;
  return {
    x: min + tx * GAME_RULES.TILE_SIZE,
    z: min + tz * GAME_RULES.TILE_SIZE,
  };
}

export function forEachTileKeyUnderFootprint(
  centerX: number,
  centerZ: number,
  footprintW: number,
  footprintD: number,
  visit: (key: string) => void
) {
  const minX = centerX - footprintW * 0.5;
  const maxX = centerX + footprintW * 0.5;
  const minZ = centerZ - footprintD * 0.5;
  const maxZ = centerZ + footprintD * 0.5;
  const a = getTileCoordsFromWorld(minX + 0.001, minZ + 0.001);
  const b = getTileCoordsFromWorld(maxX - 0.001, maxZ - 0.001);

  for (let tz = a.tz; tz <= b.tz; tz++) {
    for (let tx = a.tx; tx <= b.tx; tx++) {
      visit(getTileKey(tx, tz));
    }
  }
}

export function getTileHeight(tx: number, tz: number, seed: number): number {
  const world = getTileCenter(tx, tz);
  const radius = Math.hypot(world.x, world.z);
  const layout = getRadialKothLayout(seed);
  if (radius <= layout.centerValleyRadius) return 0.18;
  const undulation = fbm2D(world.x * 0.018 + 2.4, world.z * 0.018 - 1.7, seed + 1700, 3);
  return 0.28 + undulation * 1.35;
}

export type GeneratedTile = {
  key: string;
  tx: number;
  tz: number;
  h00: number;
  h10: number;
  h11: number;
  h01: number;
  height: number;
  tileType: TileType;
  material: number;
  maxMaterial: number;
  compute: number;
  maxCompute: number;
  isMountain: boolean;
  canBuild: boolean;
  canWalk: boolean;
};

export function getTerrainVertexHeight(
  vx: number,
  vz: number,
  seed: number,
  playerCount = GAME_RULES.TARGET_PLAYERS_PER_ROOM
): number {
  const layout = getRadialKothLayout(seed, playerCount);
  const x = GAME_RULES.WORLD_MIN + vx * GAME_RULES.TILE_SIZE;
  const z = GAME_RULES.WORLD_MIN + vz * GAME_RULES.TILE_SIZE;
  const radius = Math.hypot(x, z);

  if (radius <= layout.centerValleyRadius) {
    const bowl = clamp01(radius / Math.max(1, layout.centerValleyRadius));
    const floorNoise = fbm2D(x * 0.012 + 9.4, z * 0.012 - 14.8, seed + 1200, 2);
    return 0.08 + bowl * 0.42 + floorNoise * 0.14;
  }

  const gentleNoise = fbm2D(x * 0.018 + 2.4, z * 0.018 - 1.7, seed + 1700, 3);
  const ripple = fbm2D(x * 0.046 - 9.2, z * 0.046 + 14.1, seed + 2200, 2);
  const outerRise = clamp01((radius - layout.centerValleyRadius) / (layout.spawnRadius + 120 - layout.centerValleyRadius));
  const openGroundHeight = Math.min(
    2.35,
    0.22 + gentleNoise * 1.15 + ripple * 0.45 + outerRise * 0.9
  );

  const angle = Math.atan2(z, x);
  const boundaryDistance = getNearestMountainBoundaryDistance(angle, layout);
  const widthNoise = fbm2D(x * 0.011 + 17.4, z * 0.011 - 31.2, seed + 4400, 2);
  const boundaryWidth = layout.mountainHalfAngle + (widthNoise - 0.5) * layout.sectorAngle * 0.05;
  const boundaryStrength = 1 - boundaryDistance / Math.max(0.025, boundaryWidth);

  if (
    boundaryStrength <= 0 ||
    radius >= Math.max(Math.abs(GAME_RULES.WORLD_MIN), Math.abs(GAME_RULES.WORLD_MAX)) - 18
  ) {
    return openGroundHeight;
  }

  const spawnDistance = getNearestSpawnDistance(x, z, layout);
  const spawnGate = smoothstep(clamp01((spawnDistance - layout.startClearRadius) / 30));
  const centerGate = smoothstep(clamp01((radius - layout.centerValleyRadius) / 28));
  const ridgeNoise = fbm2D(x * 0.021 + 4.1, z * 0.021 - 7.9, seed + 5100, 3);
  const ridgeStrength = boundaryStrength * spawnGate * centerGate * (0.84 + ridgeNoise * 0.5);

  if (ridgeStrength <= 0.26) return openGroundHeight;
  return 9.6 + ridgeStrength * 18 + ridgeNoise * 4.6;
}

export function generateTile(
  tx: number,
  tz: number,
  seed: number,
  playerCount = GAME_RULES.TARGET_PLAYERS_PER_ROOM
): GeneratedTile {
  const rawH00 = getTerrainVertexHeight(tx, tz, seed, playerCount);
  const rawH10 = getTerrainVertexHeight(tx + 1, tz, seed, playerCount);
  const rawH11 = getTerrainVertexHeight(tx + 1, tz + 1, seed, playerCount);
  const rawH01 = getTerrainVertexHeight(tx, tz + 1, seed, playerCount);
  const rawHeight = (rawH00 + rawH10 + rawH11 + rawH01) * 0.25;
  const isMountain = rawHeight > GAME_RULES.MOUNTAIN_THRESHOLD;
  const h00 = rawH00;
  const h10 = rawH10;
  const h11 = rawH11;
  const h01 = rawH01;
  const height = rawHeight;

  return {
    key: getTileKey(tx, tz),
    tx,
    tz,
    h00,
    h10,
    h11,
    h01,
    height,
    tileType: TileType.GRASS,
    material: 0,
    maxMaterial: 0,
    compute: 0,
    maxCompute: 0,
    isMountain,
    canBuild: !isMountain,
    canWalk: !isMountain,
  };
}

function setGrassTile(tile: GeneratedTile): void {
  tile.tileType = TileType.GRASS;
  tile.material = 0;
  tile.maxMaterial = 0;
}

function setForestTile(tile: GeneratedTile, amount: number): void {
  if (tile.isMountain) return;
  tile.tileType = TileType.FOREST;
  tile.material = Math.max(tile.material, amount);
  tile.maxMaterial = Math.max(tile.maxMaterial, amount);
}

function setComputeTile(tile: GeneratedTile, amount: number): void {
  if (tile.isMountain) return;
  tile.compute = Math.max(tile.compute, amount);
  tile.maxCompute = Math.max(tile.maxCompute, amount);
}

function stampForestPatch(
  tiles: Map<string, GeneratedTile>,
  centerX: number,
  centerZ: number,
  amountScale: number
): void {
  const { tx, tz } = getTileCoordsFromWorld(centerX, centerZ);
  const patch = [
    { dx: 0, dz: 0, weight: 1.0 },
    { dx: 1, dz: 0, weight: 0.84 },
    { dx: -1, dz: 0, weight: 0.84 },
    { dx: 0, dz: 1, weight: 0.84 },
    { dx: 0, dz: -1, weight: 0.84 },
    { dx: 1, dz: 1, weight: 0.7 },
    { dx: -1, dz: 1, weight: 0.7 },
    { dx: 1, dz: -1, weight: 0.7 },
    { dx: -1, dz: -1, weight: 0.7 },
    { dx: 2, dz: 0, weight: 0.54 },
    { dx: -2, dz: 0, weight: 0.54 },
    { dx: 0, dz: 2, weight: 0.54 },
    { dx: 0, dz: -2, weight: 0.54 },
  ] as const;

  for (const entry of patch) {
    const tile = tiles.get(getTileKey(tx + entry.dx, tz + entry.dz));
    if (!tile) continue;
    const amount = Math.round(GAME_RULES.FOREST_WOOD_MAX * amountScale * entry.weight);
    setForestTile(tile, Math.max(1, amount));
  }
}

function stampComputeSite(tiles: Map<string, GeneratedTile>, worldX: number, worldZ: number, amount: number): void {
  const { tx, tz } = getTileCoordsFromWorld(worldX, worldZ);
  const tile = tiles.get(getTileKey(tx, tz));
  if (!tile) return;
  setComputeTile(tile, amount);
}

function stampCentralServer(tiles: Map<string, GeneratedTile>): void {
  const center = snapWorldToTileCenter(0, 0);
  const { tx, tz } = getTileCoordsFromWorld(center.x, center.z);
  const cluster = [
    { dx: 0, dz: 0, weight: 1.0 },
    { dx: 1, dz: 0, weight: 0.72 },
    { dx: -1, dz: 0, weight: 0.72 },
    { dx: 0, dz: 1, weight: 0.72 },
    { dx: 0, dz: -1, weight: 0.72 },
  ] as const;

  for (const entry of cluster) {
    const tile = tiles.get(getTileKey(tx + entry.dx, tz + entry.dz));
    if (!tile) continue;
    const amount = Math.round(GAME_RULES.KOTH_CENTER_SERVER_COMPUTE * entry.weight);
    setComputeTile(tile, amount);
  }
}

export function decorateRadialKothResources(
  tiles: Map<string, GeneratedTile>,
  seed: number,
  playerCount = GAME_RULES.TARGET_PLAYERS_PER_ROOM
): void {
  const layout = getRadialKothLayout(seed, playerCount);

  tiles.forEach((t) => {
    setGrassTile(t);
    t.compute = 0;
    t.maxCompute = 0;
  });

  const forestScale = 0.34 + seededFraction(seed, 921) * 0.08;
  for (let playerIndex = 0; playerIndex < layout.playerCount; playerIndex++) {
    const spawnAngle = getSectorAngle(playerIndex, layout);
    const spawn = polarToWorld(layout.spawnRadius, spawnAngle);

    for (const dir of [-1, 1] as const) {
      const forestAngle = spawnAngle + dir * layout.forestAngleOffset;
      const fx = spawn.x + Math.cos(forestAngle) * layout.forestDistance;
      const fz = spawn.z + Math.sin(forestAngle) * layout.forestDistance;
      stampForestPatch(tiles, fx, fz, forestScale);
    }

    const computeAngle = spawnAngle + layout.computeSideSign * layout.computeAngleOffset;
    const computeX = spawn.x + Math.cos(computeAngle) * layout.computeDistance;
    const computeZ = spawn.z + Math.sin(computeAngle) * layout.computeDistance;
    stampComputeSite(tiles, computeX, computeZ, GAME_RULES.KOTH_PLAYER_COMPUTE);
  }

  stampCentralServer(tiles);
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

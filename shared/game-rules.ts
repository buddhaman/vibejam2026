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
  return value === BuildingType.BARRACKS || value === BuildingType.TOWER || value === BuildingType.TOWN_CENTER;
}

export function isUnitType(value: unknown): value is UnitType {
  return value === UnitType.VILLAGER || value === UnitType.WARBAND;
}

export function isTileType(value: unknown): value is TileType {
  return value === TileType.GRASS || value === TileType.FOREST;
}

export function isSquadSpread(value: unknown): value is SquadSpread {
  return value === SquadSpread.TIGHT || value === SquadSpread.DEFAULT || value === SquadSpread.WIDE;
}

export const GAME_RULES = {
  TICK_HZ: 20,
  /** World span is 4× the original 20×20 tile map (now 40×40); bounds drive server clamp + tile grid. */
  WORLD_MIN: -240,
  WORLD_MAX: 240,
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
  START_BIOMASS: 500,
  START_MATERIAL: 300,
  START_COMPUTE: 200,
  /** Free Phalanx spawned with your first town center — does not affect barracks-trained warbands. */
  START_WARBAND_UNIT_COUNT: 800,
  BARRACKS_HEALTH: 200,
  TOWER_HEALTH: 300,
  TOWN_CENTER_HEALTH: 950,
  MAX_BUILDINGS_PER_PLAYER: 8,
  FOREST_WOOD_MAX: 320,
  /** Per-site compute vein size; placement is global + spaced (see `assignDatacenterSites`). */
  DATACENTER_COMPUTE_MAX: 300,
  /** At least this many data-center tiles per world (non-mountain permitting). */
  DATACENTER_MIN_SITES_PER_WORLD: 2,
  /** Cap for rare extra sites beyond the minimum (mean ≈ 2 on a full-sized map). */
  DATACENTER_MAX_SITES_PER_WORLD: 3,
  /** Target Chebyshev tile gap between sites; lowered only if the map cannot fit the count. */
  DATACENTER_MIN_CHEBYSHEV_TILES: 8,
  /** Per second while a villager squad is idle on a resource tile. */
  VILLAGER_GATHER_MATERIAL_PER_SEC: 34,
  VILLAGER_GATHER_COMPUTE_PER_SEC: 28,
  TERRAIN_HEIGHT_THRESHOLD: 0.62,
  TERRAIN_HEIGHT_SCALE: 140,
  MOUNTAIN_THRESHOLD: 7.2,
} as const;

const TILE_HALF = GAME_RULES.TILE_SIZE * 0.5;
const TILE_CENTER_MIN = GAME_RULES.WORLD_MIN + TILE_HALF;
const TILE_CENTER_MAX = GAME_RULES.WORLD_MAX - TILE_HALF;

export const BUILDING_RULES = {
  [BuildingType.BARRACKS]: {
    label: "Stratégion",
    health: GAME_RULES.BARRACKS_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 175, compute: 0 },
    footprintWidth: GAME_RULES.TILE_SIZE,
    footprintDepth: GAME_RULES.TILE_SIZE,
    selectionWidth: GAME_RULES.TILE_SIZE,
    selectionDepth: GAME_RULES.TILE_SIZE,
    height: 6.2,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE,
    producibleUnits: [UnitType.WARBAND],
  },
  [BuildingType.TOWER]: {
    label: "Pyrgos",
    health: GAME_RULES.TOWER_HEALTH,
    buildable: true,
    cost: { biomass: 0, material: 125, compute: 50 },
    footprintWidth: GAME_RULES.TILE_SIZE * 0.78,
    footprintDepth: GAME_RULES.TILE_SIZE * 0.78,
    selectionWidth: GAME_RULES.TILE_SIZE * 0.86,
    selectionDepth: GAME_RULES.TILE_SIZE * 0.86,
    height: 15.5,
    trainSpawnOffsetX: GAME_RULES.TILE_SIZE * 0.9,
    producibleUnits: [],
  },
  [BuildingType.TOWN_CENTER]: {
    label: "Agora",
    health: GAME_RULES.TOWN_CENTER_HEALTH,
    buildable: false,
    cost: { biomass: 0, material: 0, compute: 0 },
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
    label: "Helot",
    detail: "Resource Gatherer",
    cost: { biomass: 50, material: 0, compute: 0 },
    trainTimeMs: 9000,
    health: 55,
    unitCount: 1,
    visualScale: 0.82,
    targetSize: 3,
    rebalanceThreshold: 1,
    mergeDistance: 18,
  },
  [UnitType.WARBAND]: {
    label: "Phalanx",
    detail: "Elite hoplites",
    cost: { biomass: 80, material: 0, compute: 35 },
    trainTimeMs: 12000,
    health: GAME_RULES.DEFAULT_BLOB_HEALTH,
    unitCount: 12,
    visualScale: 1,
    targetSize: 40,
    rebalanceThreshold: 5,
    mergeDistance: 32,
  },
} as const;

export function getBuildingRules(buildingType: BuildingType) {
  return BUILDING_RULES[buildingType] ?? BUILDING_RULES[BuildingType.BARRACKS];
}

export function getUnitRules(unitType: UnitType) {
  return UNIT_RULES[unitType] ?? UNIT_RULES[UnitType.WARBAND];
}

export function getUnitBalanceRules(unitType: UnitType) {
  const rules = getUnitRules(unitType);
  return {
    targetSize: rules.targetSize,
    rebalanceThreshold: rules.rebalanceThreshold,
    mergeDistance: rules.mergeDistance,
  };
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
  const noise = fbm2D(tx * 0.22 + 11.1, tz * 0.22 - 5.4, seed, 3);
  return 0.55 + noise * 0.55;
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

export function getTerrainVertexHeight(vx: number, vz: number, seed: number): number {
  const noise = fbm2D(vx * 0.085 + 11.1, vz * 0.085 - 5.4, seed, 3);
  if (noise < GAME_RULES.TERRAIN_HEIGHT_THRESHOLD) return 0;
  const t = (noise - GAME_RULES.TERRAIN_HEIGHT_THRESHOLD) / (1 - GAME_RULES.TERRAIN_HEIGHT_THRESHOLD);
  return Math.pow(Math.max(0, t), 2.35) * GAME_RULES.TERRAIN_HEIGHT_SCALE;
}

export function generateTile(tx: number, tz: number, seed: number): GeneratedTile {
  const rawH00 = getTerrainVertexHeight(tx, tz, seed);
  const rawH10 = getTerrainVertexHeight(tx + 1, tz, seed);
  const rawH11 = getTerrainVertexHeight(tx + 1, tz + 1, seed);
  const rawH01 = getTerrainVertexHeight(tx, tz + 1, seed);
  const rawHeight = (rawH00 + rawH10 + rawH11 + rawH01) * 0.25;
  const isMountain = rawHeight > GAME_RULES.MOUNTAIN_THRESHOLD;
  const h00 = rawH00;
  const h10 = rawH10;
  const h11 = rawH11;
  const h01 = rawH01;
  const height = rawHeight;
  const forestField = fbm2D(tx * 0.12 + 40.2, tz * 0.12 - 13.4, seed + 1700, 4);
  const clusterField = fbm2D(tx * 0.36 - 8.1, tz * 0.36 + 19.6, seed + 8100, 3);
  const hasForest = !isMountain && forestField > 0.6 && clusterField > 0.52;
  const maxMaterial = hasForest
    ? Math.round(
        GAME_RULES.FOREST_WOOD_MAX * (0.45 + (forestField - 0.6) * 1.1 + (clusterField - 0.52) * 0.8)
      )
    : 0;

  return {
    key: getTileKey(tx, tz),
    tx,
    tz,
    h00,
    h10,
    h11,
    h01,
    height,
    tileType: hasForest ? TileType.FOREST : TileType.GRASS,
    material: Math.max(0, maxMaterial),
    maxMaterial: Math.max(0, maxMaterial),
    compute: 0,
    maxCompute: 0,
    isMountain,
    canBuild: !isMountain,
    canWalk: !isMountain,
  };
}

function seededFraction(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233 + salt * salt * 0.001) * 43758.5453123;
  return x - Math.floor(x);
}

function shuffleTilesInPlace(tiles: GeneratedTile[], seed: number): void {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(seededFraction(seed + i * 167, i) * (i + 1));
    const t = tiles[i]!;
    tiles[i] = tiles[j]!;
    tiles[j] = t;
  }
}

function tileChebyshev(a: GeneratedTile, b: GeneratedTile): number {
  return Math.max(Math.abs(a.tx - b.tx), Math.abs(a.tz - b.tz));
}

function datacenterSiteTarget(seed: number, eligibleCount: number): number {
  const cap = Math.min(GAME_RULES.DATACENTER_MAX_SITES_PER_WORLD, eligibleCount);
  if (cap < GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD) return cap;
  const u = seededFraction(seed, 501);
  if (u < 0.1 && cap >= 3) return 3;
  return 2;
}

/**
 * After all tiles exist: pick a small, well-separated set of non-mountain tiles for compute sites.
 * No noise blobs — sparse, seed-stable, at least {@link GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD} sites.
 */
function greedySpacedSites(eligible: GeneratedTile[], wantCount: number, sep: number): GeneratedTile[] {
  const picked: GeneratedTile[] = [];
  for (const t of eligible) {
    if (picked.length >= wantCount) break;
    if (picked.every((c) => tileChebyshev(c, t) >= sep)) picked.push(t);
  }
  return picked;
}

export function assignDatacenterSites(tiles: Map<string, GeneratedTile>, seed: number): void {
  const eligible: GeneratedTile[] = [];
  tiles.forEach((t) => {
    if (!t.isMountain) eligible.push(t);
  });

  const target = datacenterSiteTarget(seed, eligible.length);
  if (target <= 0 || eligible.length === 0) return;

  shuffleTilesInPlace(eligible, seed ^ 0x6f4c_29f3);

  const maxSep = GAME_RULES.DATACENTER_MIN_CHEBYSHEV_TILES;
  let chosen: GeneratedTile[] = [];

  for (let sep = maxSep; sep >= 1; sep--) {
    chosen = greedySpacedSites(eligible, target, sep);
    if (chosen.length >= target) break;
  }

  if (chosen.length < GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD) {
    for (let sep = maxSep; sep >= 1; sep--) {
      chosen = greedySpacedSites(eligible, GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD, sep);
      if (chosen.length >= GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD) break;
    }
  }

  if (chosen.length < GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD) {
    chosen = eligible.slice(0, GAME_RULES.DATACENTER_MIN_SITES_PER_WORLD);
  }

  for (const t of chosen) {
    const fr = seededFraction(seed + t.tx * 3_571 + t.tz * 8_923, 1);
    const amount = Math.round(GAME_RULES.DATACENTER_COMPUTE_MAX * (0.52 + fr * 0.42));
    t.compute = Math.max(1, amount);
    t.maxCompute = t.compute;
  }
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

import * as THREE from "three";
import { GAME_RULES, TileType, getTileCenter, getTileCoordsFromWorld, getTileKey } from "../../shared/game-rules.js";
import { applyStylizedShading } from "./stylized-shading.js";

export type TileView = {
  key: string;
  tx: number;
  tz: number;
  h00: number;
  h10: number;
  h11: number;
  h01: number;
  height: number;
  tileType: number;
  material: number;
  maxMaterial: number;
  compute: number;
  maxCompute: number;
  isMountain: boolean;
  canBuild: boolean;
  canWalk: boolean;
  treeSlots?: TreeSlot[];
  computeSlots?: ComputeSlot[];
  rockSlots?: RockSlot[];
};

export type TreeSlot = {
  x: number;
  z: number;
  rotationY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  variantIndex: number;
};

export type ComputeSlot = {
  x: number;
  z: number;
  rotationY: number;
  scale: number;
};

export type RockSlot = {
  x: number;
  z: number;
  y?: number;
  rotationY: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  variantIndex: number;
  colorJitter: number;
};

const TERRAIN_SUBDIVISIONS = 4;
const GRASS_BROAD_HEIGHT = 0.08;
const GRASS_DETAIL_HEIGHT = 0.035;
const MOUNTAIN_RIDGE_HEIGHT = 0.45;
const MOUNTAIN_DETAIL_HEIGHT = 0.18;
const MOUNTAIN_PLATEAU_STRENGTH = 0.45;
const MOUNTAIN_STEP_SIZE = 0.75;
const DRY_PATCH_SCALE = 0.045;
const LUSH_PATCH_SCALE = 0.055;
const PATCH_DETAIL_SCALE = 0.22;
const FLAT_TILE_HEIGHT_EPSILON = 1e-4;

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

function remap01(value: number, low: number, high: number) {
  return clamp01((value - low) / (high - low));
}

function sharpenedMask(value: number, low: number, high: number) {
  return smoothstep(remap01(value, low, high));
}

function visualNoise(wx: number, wz: number, scale: number, seed: number) {
  return valueNoise2D(wx * scale, wz * scale, seed);
}

function centeredNoise(wx: number, wz: number, scale: number, seed: number) {
  return visualNoise(wx, wz, scale, seed) * 2 - 1;
}

function applyGrasslandVisualHeight(_tile: TileView, wx: number, wz: number, y: number): number {
  const broad = centeredNoise(wx, wz, 0.045, 3101);
  const detail = centeredNoise(wx, wz, 0.14, 3102);
  return y + broad * GRASS_BROAD_HEIGHT + detail * GRASS_DETAIL_HEIGHT;
}

function applyMountainVisualHeight(_tile: TileView, wx: number, wz: number, y: number): number {
  const ridge = centeredNoise(wx, wz, 0.075, 7201);
  const chunk = centeredNoise(wx, wz, 0.18, 7202);
  y += ridge * MOUNTAIN_RIDGE_HEIGHT;
  y += chunk * MOUNTAIN_DETAIL_HEIGHT;

  const stepped = Math.round(y / MOUNTAIN_STEP_SIZE) * MOUNTAIN_STEP_SIZE;
  return y * (1 - MOUNTAIN_PLATEAU_STRENGTH) + stepped * MOUNTAIN_PLATEAU_STRENGTH;
}

export function getVisualTerrainHeight(
  tile: TileView,
  wx: number,
  wz: number,
  baseHeight: number
): number {
  const grassHeight = applyGrasslandVisualHeight(tile, wx, wz, baseHeight);
  const mountainHeight = applyMountainVisualHeight(tile, wx, wz, baseHeight);
  const mountainBlend = smoothstep(
    clamp01(
      (baseHeight - GAME_RULES.MOUNTAIN_THRESHOLD * 0.54) /
      (GAME_RULES.MOUNTAIN_THRESHOLD * 0.42)
    )
  );
  return grassHeight + (mountainHeight - grassHeight) * mountainBlend;
}

function getMountainRockColor(wx: number, wz: number, height: number) {
  const warm = valueNoise2D(wx * 0.065, wz * 0.065, 8111);
  const dark = valueNoise2D(wx * 0.18, wz * 0.18, 8112);
  const hue = 0.075 + warm * 0.035;
  const sat = 0.16 + warm * 0.08;
  const light = 0.30 + Math.min(0.18, height * 0.008) + dark * 0.08;
  return new THREE.Color().setHSL(hue, sat, light);
}

function getGroundVertexColor(wx: number, wz: number, height: number) {
  const dryLarge = valueNoise2D(wx * DRY_PATCH_SCALE + 30.7, wz * DRY_PATCH_SCALE - 14.2, 4103);
  const lushLarge = valueNoise2D(wx * LUSH_PATCH_SCALE - 8.4, wz * LUSH_PATCH_SCALE + 18.6, 9201);
  const detail = valueNoise2D(wx * PATCH_DETAIL_SCALE - 41.3, wz * PATCH_DETAIL_SCALE + 7.9, 6121);
  const stonePatch = valueNoise2D(wx * 0.038 + 68.2, wz * 0.038 - 33.7, 1881);
  const stoneBreakup = valueNoise2D(wx * 0.19 - 11.8, wz * 0.19 + 52.4, 1882);

  const dryMask = sharpenedMask(dryLarge, 0.48, 0.72);
  const lushMask = sharpenedMask(lushLarge, 0.56, 0.78);
  const detailAmount = (detail - 0.5) * 0.10;

  const grass = new THREE.Color().setHSL(0.29, 0.78, 0.50);
  const yellowGrass = new THREE.Color().setHSL(0.18, 0.75, 0.57);
  const lushGrass = new THREE.Color().setHSL(0.34, 0.72, 0.39);
  const color = grass.clone();

  color.lerp(yellowGrass, clamp01(dryMask * 0.72 + detailAmount));
  color.lerp(lushGrass, clamp01(lushMask * 0.55));
  color.lerp(getMountainRockColor(wx, wz, height), sharpenedMask(stonePatch + stoneBreakup * 0.14, 0.86, 0.96) * 0.5);

  const mountainBlend = smoothstep(
    clamp01(
      (height - GAME_RULES.MOUNTAIN_THRESHOLD * 0.55) /
      (GAME_RULES.MOUNTAIN_THRESHOLD * 0.65)
    )
  );
  return color.lerp(getMountainRockColor(wx, wz, height), mountainBlend);
}

function pushTri(
  positions: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  ca: THREE.Color,
  cb: THREE.Color,
  cc: THREE.Color
) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
}

function pushQuad(
  positions: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  ca: THREE.Color,
  cb: THREE.Color,
  cc: THREE.Color,
  cd: THREE.Color
) {
  pushTri(positions, colors, a, b, c, ca, cb, cc);
  pushTri(positions, colors, a, c, d, ca, cc, cd);
}

function getTileSurfacePoint(
  tile: TileView,
  center: { x: number; z: number },
  half: number,
  fx: number,
  fz: number
): THREE.Vector3 {
  const x = center.x - half + fx * GAME_RULES.TILE_SIZE;
  const z = center.z - half + fz * GAME_RULES.TILE_SIZE;
  const t00 = { x: center.x - half, z: center.z - half, y: tile.h00 };
  const t10 = { x: center.x + half, z: center.z - half, y: tile.h10 };
  const t11 = { x: center.x + half, z: center.z + half, y: tile.h11 };
  const t01 = { x: center.x - half, z: center.z + half, y: tile.h01 };
  const y = fz >= fx ? interpolateTriangleHeight(x, z, t00, t01, t11) : interpolateTriangleHeight(x, z, t00, t11, t10);
  return new THREE.Vector3(x, y, z);
}

function getFlatVisualTileHeight(tile: TileView): number | null {
  if (
    Math.abs(tile.h00 - tile.h10) > FLAT_TILE_HEIGHT_EPSILON ||
    Math.abs(tile.h10 - tile.h11) > FLAT_TILE_HEIGHT_EPSILON ||
    Math.abs(tile.h11 - tile.h01) > FLAT_TILE_HEIGHT_EPSILON ||
    Math.abs(tile.h01 - tile.h00) > FLAT_TILE_HEIGHT_EPSILON
  ) {
    return null;
  }
  return (tile.h00 + tile.h10 + tile.h11 + tile.h01) * 0.25;
}

function getForestGroundColor(tile: TileView, wx: number, wz: number, fx: number, fz: number, height: number): THREE.Color {
  const base = getGroundVertexColor(wx, wz, height);
  if (tile.tileType !== TileType.FOREST || tile.maxMaterial <= 0) return base;

  const nx = fx * 2 - 1;
  const nz = fz * 2 - 1;
  const canopyPool = smoothstep(clamp01((1.12 - Math.hypot(nx * 0.92, nz * 1.08)) / 0.82));
  const dapple = valueNoise2D(wx * 0.28, wz * 0.28, 2687);
  const leafPatch = valueNoise2D(wx * 0.075 + 12.4, wz * 0.075 - 37.2, 3381);
  const leafDetail = valueNoise2D(wx * 0.32 - 18.9, wz * 0.32 + 7.7, 3382);
  const richness = clamp01(tile.maxMaterial / GAME_RULES.FOREST_WOOD_MAX);
  const canopyShade = (0.18 + richness * 0.22) * canopyPool * (0.82 + dapple * 0.28);
  const wholeTileShade = 0.22 + richness * 0.1;
  const shade = clamp01(wholeTileShade + canopyShade);

  const forestTint = new THREE.Color().setHSL(0.31 + dapple * 0.025, 0.82, 0.24 + dapple * 0.035);
  const leafLitter = new THREE.Color().setHSL(0.115 + leafDetail * 0.03, 0.62, 0.36 + leafDetail * 0.08);
  const moss = new THREE.Color().setHSL(0.26 + dapple * 0.025, 0.7, 0.31 + leafDetail * 0.05);
  const forest = base.lerp(forestTint, shade).multiplyScalar(1 - shade * 0.34);
  forest.lerp(leafLitter, sharpenedMask(leafPatch + leafDetail * 0.12, 0.58, 0.82) * canopyPool * 0.36);
  forest.lerp(moss, sharpenedMask(1 - leafPatch + dapple * 0.1, 0.6, 0.86) * canopyPool * 0.18);
  return forest;
}

function pushTerrainTop(
  positions: number[],
  colors: number[],
  tile: TileView,
  center: { x: number; z: number },
  half: number
) {
  const divisions = TERRAIN_SUBDIVISIONS;
  const flatVisualHeight = getFlatVisualTileHeight(tile);
  const points: THREE.Vector3[][] = [];
  const vertexColors: THREE.Color[][] = [];

  for (let z = 0; z <= divisions; z++) {
    const fz = z / divisions;
    const pointRow: THREE.Vector3[] = [];
    const colorRow: THREE.Color[] = [];
    for (let x = 0; x <= divisions; x++) {
      const fx = x / divisions;
      const point = getTileSurfacePoint(tile, center, half, fx, fz);
      if (flatVisualHeight !== null) {
        point.y = flatVisualHeight;
      } else if (x > 0 && x < divisions && z > 0 && z < divisions) {
        point.y = getVisualTerrainHeight(tile, point.x, point.z, point.y);
      }
      pointRow.push(point);
      colorRow.push(getForestGroundColor(tile, point.x, point.z, fx, fz, point.y));
    }
    points.push(pointRow);
    vertexColors.push(colorRow);
  }

  for (let z = 0; z < divisions; z++) {
    for (let x = 0; x < divisions; x++) {
      pushQuad(
        positions,
        colors,
        points[z]![x]!,
        points[z + 1]![x]!,
        points[z + 1]![x + 1]!,
        points[z]![x + 1]!,
        vertexColors[z]![x]!,
        vertexColors[z + 1]![x]!,
        vertexColors[z + 1]![x + 1]!,
        vertexColors[z]![x + 1]!
      );
    }
  }
}

function interpolateTriangleHeight(
  px: number,
  pz: number,
  a: { x: number; z: number; y: number },
  b: { x: number; z: number; y: number },
  c: { x: number; z: number; y: number }
): number {
  const denom = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(denom) < 1e-6) {
    return (a.y + b.y + c.y) / 3;
  }

  const wa = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / denom;
  const wb = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / denom;
  const wc = 1 - wa - wb;
  return a.y * wa + b.y * wb + c.y * wc;
}

export function getTerrainHeightAt(x: number, z: number, tiles: Map<string, TileView> | null): number {
  if (!tiles) return 0.55;
  const { tx, tz } = getTileCoordsFromWorld(x, z);
  const tile = tiles.get(getTileKey(tx, tz));
  if (!tile) return 0.55;

  const center = getTileCenter(tile.tx, tile.tz);
  const half = GAME_RULES.TILE_SIZE * 0.5;
  const t00 = { x: center.x - half, z: center.z - half, y: tile.h00 };
  const t10 = { x: center.x + half, z: center.z - half, y: tile.h10 };
  const t11 = { x: center.x + half, z: center.z + half, y: tile.h11 };
  const t01 = { x: center.x - half, z: center.z + half, y: tile.h01 };

  const localX = (x - (center.x - half)) / GAME_RULES.TILE_SIZE;
  const localZ = (z - (center.z - half)) / GAME_RULES.TILE_SIZE;
  if (localZ >= localX) {
    return interpolateTriangleHeight(x, z, t00, t01, t11);
  }
  return interpolateTriangleHeight(x, z, t00, t11, t10);
}

export function createTerrainMesh(tiles: Iterable<TileView>): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const half = GAME_RULES.TILE_SIZE * 0.5;

  for (const tile of tiles) {
    const center = getTileCenter(tile.tx, tile.tz);
    const flatVisualHeight = getFlatVisualTileHeight(tile);
    const h00 = flatVisualHeight ?? tile.h00;
    const h10 = flatVisualHeight ?? tile.h10;
    const h11 = flatVisualHeight ?? tile.h11;
    const h01 = flatVisualHeight ?? tile.h01;
    const dirt = tile.isMountain
      ? getMountainRockColor(center.x, center.z, tile.height).multiplyScalar(0.82)
      : new THREE.Color().setHSL(0.09, 0.55, 0.32);
    const dirtDark = dirt.clone().multiplyScalar(tile.isMountain ? 0.62 : 0.74);

    const t00 = new THREE.Vector3(center.x - half, h00, center.z - half);
    const t10 = new THREE.Vector3(center.x + half, h10, center.z - half);
    const t11 = new THREE.Vector3(center.x + half, h11, center.z + half);
    const t01 = new THREE.Vector3(center.x - half, h01, center.z + half);

    const b00 = new THREE.Vector3(center.x - half, 0, center.z - half);
    const b10 = new THREE.Vector3(center.x + half, 0, center.z - half);
    const b11 = new THREE.Vector3(center.x + half, 0, center.z + half);
    const b01 = new THREE.Vector3(center.x - half, 0, center.z + half);

    pushTerrainTop(positions, colors, tile, center, half);
    pushQuad(positions, colors, b00, t00, t10, b10, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b10, t10, t11, b11, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b11, t11, t01, b01, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b01, t01, t00, b00, dirtDark, dirt, dirt, dirtDark);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = applyStylizedShading(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
  }));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

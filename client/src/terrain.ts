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

function getGroundVertexColor(vx: number, vz: number, height: number) {
  const dry = valueNoise2D(vx * 0.17 + 30.7, vz * 0.17 - 14.2, 4103);
  const lush = valueNoise2D(vx * 0.09 - 8.4, vz * 0.09 + 18.6, 9201);
  const forestBoost = valueNoise2D(vx * 0.13 + 4.8, vz * 0.13 - 21.4, 1777);
  const patch = valueNoise2D(vx * 0.28 - 41.3, vz * 0.28 + 7.9, 6121);

  // Hue: vivid mid-green range (Snakebird grass). Dry patches drift toward yellow-green.
  const baseHue   = 0.29 + lush * 0.06 - dry * 0.11 + forestBoost * 0.03 - patch * 0.02;
  // Saturation: boldly saturated — never muddy.
  const baseSat   = 0.86 + lush * 0.10 - dry * 0.08 + patch * 0.04;
  // Lightness: bright! The old 0.2 base was the main culprit.
  const baseLight = 0.48 + lush * 0.06 - dry * 0.09 + patch * 0.03 + Math.min(0.02, height * 0.001);

  // Rock / mountain: warm stone, noticeably brighter than before.
  const rockHue   = 0.09 + dry * 0.02;
  const rockSat   = 0.18 + dry * 0.06;
  const rockLight = 0.38 + Math.min(0.16, height * 0.008);

  const mountainBlend = smoothstep(
    Math.max(0, Math.min(1, (height - GAME_RULES.MOUNTAIN_THRESHOLD * 0.58) / (GAME_RULES.MOUNTAIN_THRESHOLD * 0.62)))
  );

  return new THREE.Color().setHSL(
    baseHue   + (rockHue   - baseHue)   * mountainBlend,
    baseSat   + (rockSat   - baseSat)   * mountainBlend,
    baseLight + (rockLight - baseLight) * mountainBlend
  );
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

function getForestGroundColor(tile: TileView, fx: number, fz: number, height: number): THREE.Color {
  const base = getGroundVertexColor(tile.tx + fx, tile.tz + fz, height);
  if (tile.tileType !== TileType.FOREST || tile.maxMaterial <= 0) return base;

  const nx = fx * 2 - 1;
  const nz = fz * 2 - 1;
  const canopyPool = smoothstep(clamp01((1.12 - Math.hypot(nx * 0.92, nz * 1.08)) / 0.82));
  const dapple = valueNoise2D(tile.tx * 1.7 + fx * 4.6, tile.tz * 1.7 + fz * 4.6, 2687);
  const richness = clamp01(tile.maxMaterial / GAME_RULES.FOREST_WOOD_MAX);
  const canopyShade = (0.18 + richness * 0.22) * canopyPool * (0.82 + dapple * 0.28);
  const wholeTileShade = 0.22 + richness * 0.1;
  const shade = clamp01(wholeTileShade + canopyShade);

  // Keep the Snakebird-like saturated grass, but make forest floors read clearly darker.
  const forestTint = new THREE.Color().setHSL(0.31 + dapple * 0.025, 0.82, 0.24 + dapple * 0.035);
  return base.lerp(forestTint, shade).multiplyScalar(1 - shade * 0.34);
}

function pushTerrainTop(
  positions: number[],
  colors: number[],
  tile: TileView,
  center: { x: number; z: number },
  half: number
) {
  const divisions = tile.tileType === TileType.FOREST && tile.maxMaterial > 0 ? 4 : 1;
  const points: THREE.Vector3[][] = [];
  const vertexColors: THREE.Color[][] = [];

  for (let z = 0; z <= divisions; z++) {
    const fz = z / divisions;
    const pointRow: THREE.Vector3[] = [];
    const colorRow: THREE.Color[] = [];
    for (let x = 0; x <= divisions; x++) {
      const fx = x / divisions;
      const point = getTileSurfacePoint(tile, center, half, fx, fz);
      pointRow.push(point);
      colorRow.push(getForestGroundColor(tile, fx, fz, point.y));
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
    const dirt = tile.isMountain
      ? new THREE.Color().setHSL(0.09, 0.22, 0.28 + Math.min(0.14, tile.height * 0.007))
      : new THREE.Color().setHSL(0.07, 0.68, 0.30);
    const dirtDark = dirt.clone().multiplyScalar(0.74);

    const t00 = new THREE.Vector3(center.x - half, tile.h00, center.z - half);
    const t10 = new THREE.Vector3(center.x + half, tile.h10, center.z - half);
    const t11 = new THREE.Vector3(center.x + half, tile.h11, center.z + half);
    const t01 = new THREE.Vector3(center.x - half, tile.h01, center.z + half);

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
  }));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

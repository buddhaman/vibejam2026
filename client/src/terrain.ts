import * as THREE from "three";
import { GAME_RULES, getTileCenter, getTileCoordsFromWorld, getTileKey } from "../../shared/game-rules.js";

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

function getGroundVertexColor(vx: number, vz: number, height: number) {
  const dry = valueNoise2D(vx * 0.17 + 30.7, vz * 0.17 - 14.2, 4103);
  const lush = valueNoise2D(vx * 0.09 - 8.4, vz * 0.09 + 18.6, 9201);
  const forestBoost = valueNoise2D(vx * 0.13 + 4.8, vz * 0.13 - 21.4, 1777);
  const patch = valueNoise2D(vx * 0.28 - 41.3, vz * 0.28 + 7.9, 6121);
  const baseHue = 0.12 + lush * 0.18 - dry * 0.16 + forestBoost * 0.045 - patch * 0.03;
  const baseSat = 0.7 + lush * 0.2 - dry * 0.12 + patch * 0.08;
  const baseLight = 0.2 + dry * 0.24 + lush * 0.03 + patch * 0.06 + Math.min(0.03, height * 0.002);

  const rockHue = 0.08 + dry * 0.015;
  const rockSat = 0.05 + dry * 0.04;
  const rockLight = 0.2 + Math.min(0.22, height * 0.011);

  const mountainBlend = smoothstep(
    Math.max(0, Math.min(1, (height - GAME_RULES.MOUNTAIN_THRESHOLD * 0.58) / (GAME_RULES.MOUNTAIN_THRESHOLD * 0.62)))
  );

  return new THREE.Color().setHSL(
    baseHue + (rockHue - baseHue) * mountainBlend,
    baseSat + (rockSat - baseSat) * mountainBlend,
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
    const c00 = getGroundVertexColor(tile.tx, tile.tz, tile.h00);
    const c10 = getGroundVertexColor(tile.tx + 1, tile.tz, tile.h10);
    const c11 = getGroundVertexColor(tile.tx + 1, tile.tz + 1, tile.h11);
    const c01 = getGroundVertexColor(tile.tx, tile.tz + 1, tile.h01);
    const dirt = tile.isMountain
      ? new THREE.Color().setHSL(0.08, 0.08, 0.09 + Math.min(0.15, tile.height * 0.008))
      : new THREE.Color().setHSL(0.07, 0.58, 0.16);
    const dirtDark = dirt.clone().multiplyScalar(0.82);

    const t00 = new THREE.Vector3(center.x - half, tile.h00, center.z - half);
    const t10 = new THREE.Vector3(center.x + half, tile.h10, center.z - half);
    const t11 = new THREE.Vector3(center.x + half, tile.h11, center.z + half);
    const t01 = new THREE.Vector3(center.x - half, tile.h01, center.z + half);

    const b00 = new THREE.Vector3(center.x - half, 0, center.z - half);
    const b10 = new THREE.Vector3(center.x + half, 0, center.z - half);
    const b11 = new THREE.Vector3(center.x + half, 0, center.z + half);
    const b01 = new THREE.Vector3(center.x - half, 0, center.z + half);

    pushQuad(positions, colors, t00, t01, t11, t10, c00, c01, c11, c10);
    pushQuad(positions, colors, b00, t00, t10, b10, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b10, t10, t11, b11, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b11, t11, t01, b01, dirtDark, dirt, dirt, dirtDark);
    pushQuad(positions, colors, b01, t01, t00, b00, dirtDark, dirt, dirt, dirtDark);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

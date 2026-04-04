import * as THREE from "three";
import { GAME_RULES, getWorldTileCount } from "../../shared/game-rules.js";

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function tileNoise(tx: number, tz: number, seed: number) {
  return hash(tx * 9283.11 + tz * 6899.37 + seed * 0.0001 + 0.381);
}

export function getTerrainHeightAt(x: number, z: number, seed: number): number {
  const tileSize = GAME_RULES.TILE_SIZE;
  const tx = Math.floor((x - GAME_RULES.WORLD_MIN) / tileSize);
  const tz = Math.floor((z - GAME_RULES.WORLD_MIN) / tileSize);
  const clampedTx = Math.max(0, Math.min(getWorldTileCount() - 1, tx));
  const clampedTz = Math.max(0, Math.min(getWorldTileCount() - 1, tz));
  const noise = tileNoise(clampedTx, clampedTz, seed);
  return 0.55 + noise * 0.55;
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

export function createTerrainMesh(seed: number): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];

  const tileSize = GAME_RULES.TILE_SIZE;
  const tiles = getWorldTileCount();
  const min = GAME_RULES.WORLD_MIN + tileSize * 0.5;
  const half = tileSize * 0.5;

  for (let tz = 0; tz < tiles; tz++) {
    for (let tx = 0; tx < tiles; tx++) {
      const cx = min + tx * tileSize;
      const cz = min + tz * tileSize;
      const noise = tileNoise(tx, tz, seed);
      const topY = 0.55 + noise * 0.55;

      const grass = new THREE.Color().setHSL(
        0.29 + (noise - 0.5) * 0.03,
        0.6 + noise * 0.08,
        0.5 + noise * 0.08
      );
      const dirt = new THREE.Color().setHSL(0.09 + noise * 0.015, 0.46, 0.34 + noise * 0.04);
      const dirtDark = dirt.clone().multiplyScalar(0.84);

      const t00 = new THREE.Vector3(cx - half, topY, cz - half);
      const t10 = new THREE.Vector3(cx + half, topY, cz - half);
      const t11 = new THREE.Vector3(cx + half, topY, cz + half);
      const t01 = new THREE.Vector3(cx - half, topY, cz + half);

      const b00 = new THREE.Vector3(cx - half, 0, cz - half);
      const b10 = new THREE.Vector3(cx + half, 0, cz - half);
      const b11 = new THREE.Vector3(cx + half, 0, cz + half);
      const b01 = new THREE.Vector3(cx - half, 0, cz + half);

      pushQuad(positions, colors, t00, t01, t11, t10, grass, grass, grass, grass);

      pushQuad(positions, colors, b00, t00, t10, b10, dirtDark, dirt, dirt, dirtDark);
      pushQuad(positions, colors, b10, t10, t11, b11, dirtDark, dirt, dirt, dirtDark);
      pushQuad(positions, colors, b11, t11, t01, b01, dirtDark, dirt, dirt, dirtDark);
      pushQuad(positions, colors, b01, t01, t00, b00, dirtDark, dirt, dirt, dirtDark);
    }
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

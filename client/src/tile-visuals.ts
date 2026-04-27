import * as THREE from "three";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { TileType, GAME_RULES, getTileCenter } from "../../shared/game-rules.js";
import { createInstancedVariantSet, syncInstancedVariantSet, type InstancedTransform, type InstancedVariant } from "./instancing.js";
import type { Game } from "./game.js";
import { applyStylizedShading, isStylizedLitMaterial } from "./stylized-shading.js";
import {
  getTerrainHeightAt,
  type ComputeSlot,
  type TileView,
  type TreeSlot,
} from "./terrain.js";

const COMPUTE_MINE_GLB = publicAssetUrl("models/buildings/compute_mine.glb");
const GPU_GLB = publicAssetUrl("models/buildings/gpu.glb");
const COMPUTE_MINE_TARGET_HEIGHT = 8.0;
const GPU_TARGET_HEIGHT = 1.4;
const TREE_VARIANT_COUNT = 3;
const TREE_SLOT_GRID = 4;
const TREE_SLOT_COUNT = TREE_SLOT_GRID * TREE_SLOT_GRID;
const TREE_CENTER_CLEAR_RADIUS = GAME_RULES.KOTH_CAPTURE_RADIUS + GAME_RULES.TILE_SIZE * 2.4;

type TileVisualLayerId = "forest" | "datacenters";

type TileVisualLayer = {
  id: TileVisualLayerId;
  set: ReturnType<typeof createInstancedVariantSet>;
  rebuild: (tiles: TileView[], game: Game) => void;
  shouldRebuild?: (game: Game) => boolean;
};

type RegrowingTree = {
  slotIndex: number;
  startedAt: number;
};

type RegrowingCompute = {
  slotIndex: number;
  startedAt: number;
};

let computeMineVariantTemplate: InstancedVariant | null = null;
let gpuVariantTemplate: InstancedVariant | null = null;
let tileVisualAssetVersion = 0;

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function hash01(tx: number, tz: number, salt: number) {
  const x = Math.sin(tx * 9283.11 + tz * 6899.37 + salt * 0.001) * 43758.5453123;
  return x - Math.floor(x);
}

function treeJitter(seed: number, index: number) {
  return hash(seed * 0.173 + index * 13.37 + 0.91);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getTreeNeighborScore(
  tile: TileView,
  tiles: Map<string, TileView>,
  radius: number,
  score: (neighbor: TileView) => number
): number {
  let totalWeight = 0;
  let totalScore = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.hypot(dx, dz);
      if (dist > radius) continue;
      const weight = dx === 0 && dz === 0 ? 1.3 : 1 / (1 + dist * 1.35);
      const neighbor = tiles.get(`${tile.tx + dx},${tile.tz + dz}`);
      if (!neighbor) continue;
      totalWeight += weight;
      totalScore += score(neighbor) * weight;
    }
  }
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

function treeCandidateThreshold(tile: TileView, tiles: Map<string, TileView>): number {
  if (tile.isMountain || tile.compute > 0 || tile.maxCompute > 0) return 0;
  const center = getTileCenter(tile.tx, tile.tz);
  const centerDist = Math.hypot(center.x, center.z);
  if (centerDist < TREE_CENTER_CLEAR_RADIUS) return 0;

  const fill = tile.maxMaterial > 0 ? clamp01(tile.maxMaterial / GAME_RULES.FOREST_WOOD_MAX) : 0;
  const forestInfluence = getTreeNeighborScore(
    tile,
    tiles,
    2,
    (neighbor) => (neighbor.tileType === TileType.FOREST && neighbor.maxMaterial > 0 ? 1 : 0)
  );
  const mountainInfluence = getTreeNeighborScore(tile, tiles, 2, (neighbor) => (neighbor.isMountain ? 1 : 0));
  const localNoise = hash(tile.tx * 421.37 + tile.tz * 719.11 + 0.37);
  let threshold = 0;

  if (tile.tileType === TileType.FOREST && tile.maxMaterial > 0) {
    threshold = 0.56 + fill * 0.3 + forestInfluence * 0.12 + mountainInfluence * 0.06;
  } else {
    if (forestInfluence < 0.34) return 0;
    const forestFringe = Math.max(0, forestInfluence - 0.24) * 0.62;
    threshold = forestFringe - 0.04 + (localNoise - 0.5) * 0.06;
  }

  const clearing = clamp01((centerDist - TREE_CENTER_CLEAR_RADIUS) / (GAME_RULES.TILE_SIZE * 1.8));
  return clamp01(threshold * clearing);
}

function fitGroundAndCenterXZ(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxY = Math.max(size.y, 1e-3);
  const s = targetHeight / maxY;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const center = box3.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
}

function cloneGeometryGroup(source: THREE.BufferGeometry, materialIndex: number): THREE.BufferGeometry | null {
  if (source.groups.length === 0) return source.clone();

  const geometry = source.clone();
  geometry.clearGroups();
  let matched = false;
  for (const group of source.groups) {
    if (group.materialIndex !== materialIndex) continue;
    matched = true;
    geometry.addGroup(group.start, group.count, 0);
  }
  return matched ? geometry : null;
}

function meshPartsFromObject(root: THREE.Object3D): InstancedVariant["parts"] {
  const parts: InstancedVariant["parts"] = [];
  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
      const material = materials[materialIndex];
      if (!material) continue;
      const geometry = cloneGeometryGroup(obj.geometry, materialIndex);
      if (!geometry) continue;
      geometry.applyMatrix4(obj.matrixWorld);
      const stylizedMaterial = isStylizedLitMaterial(material) ? applyStylizedShading(material.clone()) : material;
      parts.push({
        geometry,
        material: stylizedMaterial,
        castShadow: true,
        receiveShadow: true,
      });
    }
  });

  return parts;
}

function createDatacenterFallbackVariant(): InstancedVariant {
  const baseMat = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xbec7d4, roughness: 0.92, metalness: 0.08 }));
  const accentMat = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0x50616f, roughness: 0.84, metalness: 0.18 }));
  return {
    parts: [
      {
        geometry: new THREE.BoxGeometry(6.2, 5.6, 5.2).translate(0, 2.8, 0),
        material: baseMat,
      },
      {
        geometry: new THREE.BoxGeometry(4.8, 1.2, 3.6).translate(0, 6, 0),
        material: accentMat,
      },
      {
        geometry: new THREE.BoxGeometry(1.1, 2.2, 1.1).translate(-1.7, 7.2, -1.1),
        material: accentMat,
      },
      {
        geometry: new THREE.BoxGeometry(1.1, 2.8, 1.1).translate(1.5, 7.5, 1.2),
        material: accentMat,
      },
    ],
  };
}

function createComputeShardVariant(): InstancedVariant {
  const crystalMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({
      color: 0x83ecff,
      emissive: 0x2dc4ef,
      emissiveIntensity: 0.55,
      roughness: 0.22,
      metalness: 0.08,
    })
  );
  const baseMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x91a7b2, roughness: 0.78, metalness: 0.08 })
  );
  return {
    parts: [
      {
        geometry: new THREE.OctahedronGeometry(0.42, 0).scale(0.9, 1.8, 0.9).translate(0, 0.82, 0),
        material: crystalMat,
      },
      {
        geometry: new THREE.CylinderGeometry(0.16, 0.22, 0.28, 6).translate(0, 0.14, 0),
        material: baseMat,
      },
    ],
  };
}

function createTreeVariants(): InstancedVariant[] {
  const trunkMat = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0x6d4324, roughness: 1, metalness: 0 }));
  const foliageMatA = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0x4c7f38, roughness: 0.96, metalness: 0 }));
  const foliageMatB = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0x5e8f42, roughness: 0.94, metalness: 0 }));
  const foliageMatC = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0x6c9950, roughness: 0.94, metalness: 0 }));

  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.5, 6).translate(0, 1.25, 0);
  const branchTrunk = new THREE.CylinderGeometry(0.2, 0.3, 2.9, 6).translate(0, 1.45, 0);

  const puffA = new THREE.SphereGeometry(0.88, 8, 7).scale(1, 1.15, 1).translate(0, 3.1, 0);
  const puffB = new THREE.SphereGeometry(0.8, 8, 7).scale(1.15, 0.95, 1.05).translate(-0.55, 2.85, 0.2);
  const puffC = new THREE.SphereGeometry(0.72, 8, 7).scale(0.95, 1.05, 1.1).translate(0.5, 2.78, -0.18);

  const tallCrown = new THREE.SphereGeometry(0.8, 8, 7).scale(0.9, 1.55, 0.9).translate(0, 3.5, 0);
  const tallSideA = new THREE.SphereGeometry(0.58, 8, 7).scale(1.15, 0.9, 1.1).translate(-0.42, 2.78, 0.18);
  const tallSideB = new THREE.SphereGeometry(0.58, 8, 7).scale(1.05, 0.9, 1.15).translate(0.46, 2.72, -0.12);

  const branchA = new THREE.CylinderGeometry(0.08, 0.12, 0.9, 5)
    .rotateZ(0.78)
    .translate(-0.42, 2.15, 0.05);
  const branchB = new THREE.CylinderGeometry(0.08, 0.12, 0.95, 5)
    .rotateZ(-0.76)
    .translate(0.44, 2.05, -0.03);
  const branchLeafA = new THREE.SphereGeometry(0.6, 8, 7).scale(1.05, 1, 1.1).translate(-0.72, 2.75, 0.15);
  const branchLeafB = new THREE.SphereGeometry(0.54, 8, 7).scale(1, 1.15, 1).translate(0.73, 2.62, -0.15);
  const topLeaf = new THREE.SphereGeometry(0.76, 8, 7).scale(1, 1.2, 1).translate(0, 3.2, 0);

  return [
    {
      parts: [
        { geometry: trunk, material: trunkMat },
        { geometry: puffA, material: foliageMatA },
        { geometry: puffB, material: foliageMatB },
        { geometry: puffC, material: foliageMatC },
      ],
    },
    {
      parts: [
        { geometry: trunk, material: trunkMat },
        { geometry: tallCrown, material: foliageMatB },
        { geometry: tallSideA, material: foliageMatA },
        { geometry: tallSideB, material: foliageMatC },
      ],
    },
    {
      parts: [
        { geometry: branchTrunk, material: trunkMat },
        { geometry: branchA, material: trunkMat },
        { geometry: branchB, material: trunkMat },
        { geometry: branchLeafA, material: foliageMatA },
        { geometry: branchLeafB, material: foliageMatC },
        { geometry: topLeaf, material: foliageMatB },
      ],
    },
  ];
}

export function ensureTreeSlots(tile: TileView, tiles?: Map<string, TileView>): TreeSlot[] {
  if (tile.treeSlots) return tile.treeSlots;

  const center = getTileCenter(tile.tx, tile.tz);
  const slots: TreeSlot[] = [];
  const tileMap = tiles ?? new Map<string, TileView>([[tile.key, tile]]);
  const threshold = treeCandidateThreshold(tile, tileMap);
  if (threshold <= 0) {
    tile.treeSlots = slots;
    return slots;
  }
  const half = GAME_RULES.TILE_SIZE * 0.5;
  const cellSize = GAME_RULES.TILE_SIZE / TREE_SLOT_GRID;
  const allCandidates: Array<{ slot: TreeSlot; score: number; accepted: boolean }> = [];

  for (let gz = 0; gz < TREE_SLOT_GRID; gz++) {
    for (let gx = 0; gx < TREE_SLOT_GRID; gx++) {
      const index = gz * TREE_SLOT_GRID + gx;
      const a = treeJitter(tile.tx * 9283.11 + tile.tz * 6899.37 + 17.31, index * 5 + 1);
      const b = treeJitter(tile.tx * 9283.11 + tile.tz * 6899.37 + 17.31, index * 5 + 2);
      const c = treeJitter(tile.tx * 9283.11 + tile.tz * 6899.37 + 17.31, index * 5 + 3);
      const d = treeJitter(tile.tx * 9283.11 + tile.tz * 6899.37 + 17.31, index * 5 + 4);
      const e = treeJitter(tile.tx * 9283.11 + tile.tz * 6899.37 + 17.31, index * 5 + 5);
      const localX = -half + (gx + 0.18 + a * 0.64) * cellSize;
      const localZ = -half + (gz + 0.18 + b * 0.64) * cellSize;
      const x = center.x + localX;
      const z = center.z + localZ;
      const worldPatch = hash(Math.floor(x * 0.23) * 173.11 + Math.floor(z * 0.23) * 311.17 + 0.91);
      const edgeFade = clamp01(
        Math.min(
          1,
          (Math.min(gx + a, TREE_SLOT_GRID - gx - a, gz + b, TREE_SLOT_GRID - gz - b) + 0.2) / 1.1
        )
      );
      const score = c * 0.6 + worldPatch * 0.3 + (1 - edgeFade) * 0.1;
      const effectiveThreshold = clamp01(threshold * (0.86 + e * 0.28));
      const scale = 0.84 + d * 0.52;
      allCandidates.push({
        accepted: score <= effectiveThreshold,
        score,
        slot: {
          x,
          z,
          rotationY: e * Math.PI * 2,
          scaleX: scale,
          scaleY: scale + c * 0.14,
          scaleZ: scale * (0.94 + b * 0.12),
          variantIndex: Math.floor(d * TREE_VARIANT_COUNT) % TREE_VARIANT_COUNT,
        },
      });
    }
  }

  allCandidates.sort((a, b) => a.score - b.score);
  const minSlots =
    tile.tileType === TileType.FOREST && tile.maxMaterial > 0
      ? Math.min(TREE_SLOT_COUNT, Math.max(6, Math.round(5 + threshold * 7)))
      : 0;
  const accepted = allCandidates.filter((candidate) => candidate.accepted);
  const chosen = accepted.length >= minSlots ? accepted : allCandidates.slice(0, minSlots);
  for (const candidate of chosen) slots.push(candidate.slot);

  tile.treeSlots = slots;
  return slots;
}

export function ensureComputeSlots(tile: TileView): ComputeSlot[] {
  if (tile.computeSlots) return tile.computeSlots;

  const center = getTileCenter(tile.tx, tile.tz);
  const slots: ComputeSlot[] = [];
  const slotCount = 6;
  const tileSeed = tile.tx * 4517.19 + tile.tz * 7759.61 + tile.maxCompute * 0.19;

  for (let i = 0; i < slotCount; i++) {
    const a = treeJitter(tileSeed, i * 3 + 1);
    const b = treeJitter(tileSeed, i * 3 + 2);
    const c = treeJitter(tileSeed, i * 3 + 3);
    const radius = 1.5 + b * 2.2;
    const angle = a * Math.PI * 2;
    slots.push({
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
      rotationY: c * Math.PI * 2,
      scale: 0.88 + b * 0.45,
    });
  }

  tile.computeSlots = slots;
  return slots;
}

async function loadComputeMineVariant(): Promise<InstancedVariant> {
  const loader = createGLTFLoader();
  try {
    const gltf = await loader.loadAsync(COMPUTE_MINE_GLB);
    const root = gltf.scene.clone(true) as THREE.Group;
    fitGroundAndCenterXZ(root, COMPUTE_MINE_TARGET_HEIGHT);
    const parts = meshPartsFromObject(root);
    if (parts.length > 0) return { parts };
    console.warn(`[tile-visuals] Compute mine GLB had no mesh parts, using fallback: ${COMPUTE_MINE_GLB}`);
  } catch (err) {
    console.warn(`[tile-visuals] Could not load compute mine GLB, using fallback: ${COMPUTE_MINE_GLB}`, err);
  }
  return createDatacenterFallbackVariant();
}

async function loadGpuVariant(): Promise<InstancedVariant> {
  const loader = createGLTFLoader();
  try {
    const gltf = await loader.loadAsync(GPU_GLB);
    const root = gltf.scene.clone(true) as THREE.Group;
    fitGroundAndCenterXZ(root, GPU_TARGET_HEIGHT);
    const parts = meshPartsFromObject(root);
    if (parts.length > 0) return { parts };
    console.warn(`[tile-visuals] GPU GLB had no mesh parts, using procedural fallback: ${GPU_GLB}`);
  } catch (err) {
    console.warn(`[tile-visuals] Could not load GPU GLB, using procedural fallback: ${GPU_GLB}`, err);
  }
  return createComputeShardVariant();
}

function createForestLayer(): TileVisualLayer {
  const set = createInstancedVariantSet(createTreeVariants(), 8192);
  let lastCarrySignature = "";
  const previousCarriedByTile = new Map<string, number>();
  const regrowingByTile = new Map<string, RegrowingTree[]>();
  const REGROW_DURATION = 0.9;

  return {
    id: "forest",
    set,
    shouldRebuild(game) {
      const now = performance.now() / 1000;
      const carried = game.getCarriedTreeCountByTile();
      const signature = Array.from(carried.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => `${key}:${count}`)
        .join("|");
      const changed = signature !== lastCarrySignature;
      lastCarrySignature = signature;
      let animating = false;
      for (const [tileKey, entries] of Array.from(regrowingByTile.entries())) {
        const active = entries.filter((entry) => now - entry.startedAt < REGROW_DURATION);
        if (active.length > 0) {
          animating = true;
          regrowingByTile.set(tileKey, active);
        } else {
          regrowingByTile.delete(tileKey);
        }
      }
      return changed || animating;
    },
    rebuild(tiles, game) {
      const now = performance.now() / 1000;
      const carried = game.getCarriedTreeCountByTile();
      const tileMap = game.getTiles();
      const transformsByVariant: InstancedTransform[][] = Array.from({ length: TREE_VARIANT_COUNT }, () => []);
      for (const tile of tiles) {
        const slots = ensureTreeSlots(tile, tileMap);
        if (slots.length === 0) continue;
        const isResourceForest = tile.tileType === TileType.FOREST && tile.maxMaterial > 0;
        const fill = isResourceForest && tile.maxMaterial > 0 ? Math.max(0.12, tile.material / tile.maxMaterial) : 1;
        const baseVisibleCount = isResourceForest
          ? Math.max(2, Math.min(slots.length, Math.round(5 + fill * 11)))
          : slots.length;
        const hiddenCount = isResourceForest ? carried.get(tile.key) ?? 0 : 0;
        const previousHiddenCount = isResourceForest ? previousCarriedByTile.get(tile.key) ?? 0 : 0;
        if (isResourceForest) previousCarriedByTile.set(tile.key, hiddenCount);
        const clampedHiddenCount = Math.min(hiddenCount, slots.length);
        const visibleCount = Math.max(0, Math.min(baseVisibleCount, slots.length) - clampedHiddenCount);
        const previousVisibleCount = Math.max(0, Math.min(baseVisibleCount, slots.length) - Math.min(previousHiddenCount, slots.length));

        if (isResourceForest && visibleCount > previousVisibleCount) {
          const entries = regrowingByTile.get(tile.key) ?? [];
          for (let i = previousVisibleCount; i < visibleCount; i++) {
            entries.push({ slotIndex: i, startedAt: now });
          }
          regrowingByTile.set(tile.key, entries);
        } else if (isResourceForest && visibleCount < previousVisibleCount) {
          const entries = regrowingByTile.get(tile.key)?.filter((entry) => entry.slotIndex < visibleCount) ?? [];
          if (entries.length > 0) regrowingByTile.set(tile.key, entries);
          else regrowingByTile.delete(tile.key);
        }

        const regrowing = isResourceForest ? regrowingByTile.get(tile.key) ?? [] : [];
        const regrowingBySlot = new Map<number, number>();
        for (const entry of regrowing) {
          const t = Math.min(1, Math.max(0, (now - entry.startedAt) / REGROW_DURATION));
          if (t >= 1) continue;
          regrowingBySlot.set(entry.slotIndex, t);
        }

        for (let i = 0; i < Math.min(visibleCount, slots.length); i++) {
          const slot = slots[i]!;
          const regrowT = regrowingBySlot.get(i) ?? 1;
          const growth = regrowT >= 1 ? 1 : (0.18 + regrowT * regrowT * 0.82);
          transformsByVariant[slot.variantIndex]!.push({
            position: new THREE.Vector3(slot.x, getTerrainHeightAt(slot.x, slot.z, tileMap) + 0.06, slot.z),
            rotationY: slot.rotationY,
            scale: new THREE.Vector3(slot.scaleX * growth, slot.scaleY * growth, slot.scaleZ * growth),
          });
        }
      }
      syncInstancedVariantSet(set, transformsByVariant);
    },
  };
}

function createDatacenterLayer(): TileVisualLayer {
  const set = createInstancedVariantSet(
    [
      computeMineVariantTemplate ?? createDatacenterFallbackVariant(),
      gpuVariantTemplate ?? createComputeShardVariant(),
    ],
    64
  );
  let lastCarrySignature = "";
  const previousCarriedByTile = new Map<string, number>();
  const regrowingByTile = new Map<string, RegrowingCompute[]>();
  const REGROW_DURATION = 0.9;

  return {
    id: "datacenters",
    set,
    shouldRebuild(game) {
      const now = performance.now() / 1000;
      const carried = game.getCarriedComputeCountByTile();
      const signature = Array.from(carried.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => `${key}:${count}`)
        .join("|");
      const changed = signature !== lastCarrySignature;
      lastCarrySignature = signature;
      let animating = false;
      for (const [tileKey, entries] of Array.from(regrowingByTile.entries())) {
        const active = entries.filter((entry) => now - entry.startedAt < REGROW_DURATION);
        if (active.length > 0) {
          animating = true;
          regrowingByTile.set(tileKey, active);
        } else {
          regrowingByTile.delete(tileKey);
        }
      }
      return changed || animating;
    },
    rebuild(tiles, game) {
      const now = performance.now() / 1000;
      const mineTransforms: InstancedTransform[] = [];
      const shardTransforms: InstancedTransform[] = [];
      const carried = game.getCarriedComputeCountByTile();
      for (const tile of tiles) {
        const maxC = tile.maxCompute ?? 0;
        const c = tile.compute ?? 0;
        if (tile.isMountain || maxC <= 0 || c <= 0) continue;
        // Only render mine model on exact player-compute tiles; skip central server cluster
        if (maxC !== GAME_RULES.KOTH_PLAYER_COMPUTE) continue;
        const center = getTileCenter(tile.tx, tile.tz);
        const scale = 0.92 + hash01(tile.tx, tile.tz, 8811) * 0.14;
        mineTransforms.push({
          position: new THREE.Vector3(center.x, tile.height + 0.04, center.z),
          rotationY: hash01(tile.tx, tile.tz, 6021) * Math.PI * 2,
          scale: new THREE.Vector3(scale, scale, scale),
        });

        const fill = Math.max(0.12, c / maxC);
        const baseVisibleCount = Math.max(2, Math.round(3 + fill * 9));
        const hiddenCount = carried.get(tile.key) ?? 0;
        const previousHiddenCount = previousCarriedByTile.get(tile.key) ?? 0;
        previousCarriedByTile.set(tile.key, hiddenCount);
        const slots = ensureComputeSlots(tile);
        const visualHiddenCount = Math.ceil(hiddenCount * 0.4);
        const clampedHiddenCount = Math.min(visualHiddenCount, slots.length);
        const visibleCount = Math.max(0, Math.min(baseVisibleCount, slots.length) - clampedHiddenCount);
        const previousVisibleCount = Math.max(0, Math.min(baseVisibleCount, slots.length) - Math.min(previousHiddenCount, slots.length));

        if (visibleCount > previousVisibleCount) {
          const entries = regrowingByTile.get(tile.key) ?? [];
          for (let i = previousVisibleCount; i < visibleCount; i++) {
            entries.push({ slotIndex: i, startedAt: now });
          }
          regrowingByTile.set(tile.key, entries);
        } else if (visibleCount < previousVisibleCount) {
          const entries = regrowingByTile.get(tile.key)?.filter((entry) => entry.slotIndex < visibleCount) ?? [];
          if (entries.length > 0) regrowingByTile.set(tile.key, entries);
          else regrowingByTile.delete(tile.key);
        }

        const regrowing = regrowingByTile.get(tile.key) ?? [];
        const regrowingBySlot = new Map<number, number>();
        for (const entry of regrowing) {
          const t = Math.min(1, Math.max(0, (now - entry.startedAt) / REGROW_DURATION));
          if (t >= 1) continue;
          regrowingBySlot.set(entry.slotIndex, t);
        }

        for (let i = 0; i < Math.min(visibleCount, slots.length); i++) {
          const slot = slots[i]!;
          const regrowT = regrowingBySlot.get(i) ?? 1;
          const growth = regrowT >= 1 ? 1 : (0.22 + regrowT * regrowT * 0.78);
          shardTransforms.push({
            position: new THREE.Vector3(slot.x, tile.height + 0.05, slot.z),
            rotationY: slot.rotationY,
            scale: new THREE.Vector3(slot.scale * growth, slot.scale * growth, slot.scale * growth),
          });
        }
      }
      syncInstancedVariantSet(set, [mineTransforms, shardTransforms]);
    },
  };
}

export async function ensureTileVisualAssetsLoaded(): Promise<void> {
  if (computeMineVariantTemplate && gpuVariantTemplate) return;
  [computeMineVariantTemplate, gpuVariantTemplate] = await Promise.all([
    loadComputeMineVariant(),
    loadGpuVariant(),
  ]);
  tileVisualAssetVersion += 1;
}

export function getTileVisualAssetVersion(): number {
  return tileVisualAssetVersion;
}

export class TileVisualManager {
  public readonly root = new THREE.Group();
  private layers: TileVisualLayer[] = [];
  private assetVersion = -1;

  public constructor() {
    this.rebuildLayers();
  }

  private rebuildLayers(): void {
    for (const layer of this.layers) {
      this.root.remove(layer.set.root);
    }
    this.layers = [createForestLayer(), createDatacenterLayer()];
    this.assetVersion = getTileVisualAssetVersion();
    for (const layer of this.layers) this.root.add(layer.set.root);
  }

  public sync(game: Game): void {
    if (this.assetVersion !== getTileVisualAssetVersion()) {
      this.rebuildLayers();
      game.markAllTileVisualsDirty();
    }
    const dirty = game.consumeTileVisualDirty();
    const layerDirty = new Set<TileVisualLayerId>(dirty.layers);
    for (const layer of this.layers) {
      if (layer.shouldRebuild?.(game)) layerDirty.add(layer.id);
    }
    if (!dirty.all && layerDirty.size === 0) return;

    const tiles = game.getTilesOrdered();
    for (const layer of this.layers) {
      if (dirty.all || layerDirty.has(layer.id)) layer.rebuild(tiles, game);
    }
  }
}

import * as THREE from "three";
import { createGLTFLoader } from "./gltf-loader.js";
import { TileType, getTileCenter } from "../../shared/game-rules.js";
import { createInstancedVariantSet, syncInstancedVariantSet, type InstancedTransform, type InstancedVariant } from "./instancing.js";
import type { Game } from "./game.js";
import { applyStylizedShading, isStylizedLitMaterial } from "./stylized-shading.js";
import type { TileView, TreeSlot } from "./terrain.js";

const DATACENTER_GLB = "/models/buildings/datacenter.glb";
const DATACENTER_TARGET_HEIGHT = 10.5;
const TREE_VARIANT_COUNT = 3;

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

let datacenterVariantTemplate: InstancedVariant | null = null;

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

export function ensureTreeSlots(tile: TileView): TreeSlot[] {
  if (tile.treeSlots) return tile.treeSlots;

  const center = getTileCenter(tile.tx, tile.tz);
  const slots: TreeSlot[] = [];
  const slotCount = 10;
  const tileSeed = tile.tx * 9283.11 + tile.tz * 6899.37 + tile.maxMaterial * 0.17;

  for (let i = 0; i < slotCount; i++) {
    const a = treeJitter(tileSeed, i * 4 + 1);
    const b = treeJitter(tileSeed, i * 4 + 2);
    const c = treeJitter(tileSeed, i * 4 + 3);
    const d = treeJitter(tileSeed, i * 4 + 4);
    const scale = 0.9 + c * 0.45;
    const radius = 1.2 + b * 3.4;
    const angle = a * Math.PI * 2;
    slots.push({
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
      rotationY: d * Math.PI * 2,
      scaleX: scale,
      scaleY: scale + b * 0.08,
      scaleZ: scale,
      variantIndex: Math.floor(c * TREE_VARIANT_COUNT) % TREE_VARIANT_COUNT,
    });
  }

  tile.treeSlots = slots;
  return slots;
}

async function loadDatacenterVariant(): Promise<InstancedVariant> {
  const loader = createGLTFLoader();
  try {
    const gltf = await loader.loadAsync(DATACENTER_GLB);
    const root = gltf.scene.clone(true) as THREE.Group;
    fitGroundAndCenterXZ(root, DATACENTER_TARGET_HEIGHT);
    const parts = meshPartsFromObject(root);
    if (parts.length > 0) return { parts };
    console.warn(`[tile-visuals] Datacenter GLB had no mesh parts, using fallback: ${DATACENTER_GLB}`);
  } catch (err) {
    console.warn(`[tile-visuals] Could not load datacenter GLB, using fallback: ${DATACENTER_GLB}`, err);
  }
  return createDatacenterFallbackVariant();
}

function createForestLayer(): TileVisualLayer {
  const set = createInstancedVariantSet(createTreeVariants(), 1024);
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
      const transformsByVariant: InstancedTransform[][] = Array.from({ length: TREE_VARIANT_COUNT }, () => []);
      for (const tile of tiles) {
        if (tile.tileType !== TileType.FOREST || tile.maxMaterial <= 0 || tile.material <= 0) continue;
        const fill = Math.max(0.15, tile.material / tile.maxMaterial);
        const baseVisibleCount = Math.max(1, Math.round(2 + fill * 8));
        const hiddenCount = carried.get(tile.key) ?? 0;
        const previousHiddenCount = previousCarriedByTile.get(tile.key) ?? 0;
        previousCarriedByTile.set(tile.key, hiddenCount);
        const slots = ensureTreeSlots(tile);
        const clampedHiddenCount = Math.min(hiddenCount, slots.length);
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
          const growth = regrowT >= 1 ? 1 : (0.18 + regrowT * regrowT * 0.82);
          transformsByVariant[slot.variantIndex]!.push({
            position: new THREE.Vector3(slot.x, tile.height + 0.06, slot.z),
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
  const set = createInstancedVariantSet([datacenterVariantTemplate ?? createDatacenterFallbackVariant()], 64);

  return {
    id: "datacenters",
    set,
    rebuild(tiles, _game) {
      const transforms: InstancedTransform[] = [];
      for (const tile of tiles) {
        const maxC = tile.maxCompute ?? 0;
        const c = tile.compute ?? 0;
        if (tile.isMountain || maxC <= 0 || c <= 0) continue;
        const center = getTileCenter(tile.tx, tile.tz);
        const scale = 0.92 + hash01(tile.tx, tile.tz, 8811) * 0.14;
        transforms.push({
          position: new THREE.Vector3(center.x, tile.height + 0.04, center.z),
          rotationY: hash01(tile.tx, tile.tz, 6021) * Math.PI * 2,
          scale: new THREE.Vector3(scale, scale, scale),
        });
      }
      syncInstancedVariantSet(set, [transforms]);
    },
  };
}

export async function ensureTileVisualAssetsLoaded(): Promise<void> {
  if (datacenterVariantTemplate) return;
  datacenterVariantTemplate = await loadDatacenterVariant();
}

export class TileVisualManager {
  public readonly root = new THREE.Group();
  private readonly layers: TileVisualLayer[] = [createForestLayer(), createDatacenterLayer()];

  public constructor() {
    for (const layer of this.layers) this.root.add(layer.set.root);
  }

  public sync(game: Game): void {
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

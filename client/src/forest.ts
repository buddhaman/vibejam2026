import * as THREE from "three";
import { TileType, getTileCenter } from "../../shared/game-rules.js";
import { createInstancedVariantSet, syncInstancedVariantSet, type InstancedTransform, type InstancedVariant } from "./instancing.js";
import type { TileView } from "./terrain.js";

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453123;
  return x - Math.floor(x);
}

function treeJitter(seed: number, index: number) {
  return hash(seed * 0.173 + index * 13.37 + 0.91);
}

function createTreeVariants() {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6d4324, roughness: 1, metalness: 0 });
  const foliageMatA = new THREE.MeshStandardMaterial({ color: 0x4c7f38, roughness: 0.96, metalness: 0 });
  const foliageMatB = new THREE.MeshStandardMaterial({ color: 0x5e8f42, roughness: 0.94, metalness: 0 });
  const foliageMatC = new THREE.MeshStandardMaterial({ color: 0x6c9950, roughness: 0.94, metalness: 0 });

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

  const variants: InstancedVariant[] = [
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

  return variants;
}

export class ForestRenderer {
  public root: THREE.Group;
  private set = createInstancedVariantSet(createTreeVariants(), 4096);
  private lastSignature = "";

  public constructor() {
    this.root = this.set.root;
  }

  public sync(tiles: TileView[]) {
    const signature = tiles.map((tile) => `${tile.key}:${tile.material}`).join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const transformsByVariant: InstancedTransform[][] = [[], [], []];
    for (const tile of tiles) {
      if (tile.tileType !== TileType.FOREST || tile.maxMaterial <= 0 || tile.material <= 0) continue;
      const center = getTileCenter(tile.tx, tile.tz);
      const fill = Math.max(0.15, tile.material / tile.maxMaterial);
      const treeCount = Math.max(1, Math.round(2 + fill * 8));
      const tileSeed = tile.tx * 9283.11 + tile.tz * 6899.37 + tile.maxMaterial * 0.17;

      for (let i = 0; i < treeCount; i++) {
        const a = treeJitter(tileSeed, i * 4 + 1);
        const b = treeJitter(tileSeed, i * 4 + 2);
        const c = treeJitter(tileSeed, i * 4 + 3);
        const d = treeJitter(tileSeed, i * 4 + 4);
        const variantIndex = Math.floor(c * transformsByVariant.length) % transformsByVariant.length;
        const radius = 1.2 + b * 3.4;
        const angle = a * Math.PI * 2;
        transformsByVariant[variantIndex].push({
          position: new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            tile.height + 0.06,
            center.z + Math.sin(angle) * radius
          ),
          rotationY: d * Math.PI * 2,
          scale: new THREE.Vector3(0.9 + c * 0.45, 0.9 + c * 0.45 + b * 0.08, 0.9 + c * 0.45),
        });
      }
    }

    syncInstancedVariantSet(this.set, transformsByVariant);
  }
}

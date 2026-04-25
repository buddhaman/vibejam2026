import * as THREE from "three";
import { applyStylizedShading } from "./stylized-shading.js";

const DUMMY = new THREE.Object3D();
const _YXZ = "YXZ" as THREE.EulerOrder;

export type FarmingToolKind = "sword" | "bow";

export type FarmingToolInstance = {
  kind: FarmingToolKind;
  worldX: number;
  worldY: number;
  worldZ: number;
  sideX: number;
  sideZ: number;
  forwardX: number;
  forwardZ: number;
  animT: number;
  scale: number;
};

function makeMesh(geom: THREE.BufferGeometry, mat: THREE.Material, cap: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geom, mat, cap);
  m.count = 0;
  m.castShadow = true;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}

function buildSwordMeshes(cap: number): THREE.InstancedMesh[] {
  const handleMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x7a5c2e, roughness: 0.88, metalness: 0.04 })
  );
  const guardMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x8a9898, roughness: 0.62, metalness: 0.48 })
  );
  const bladeMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0xc8d8d0, roughness: 0.36, metalness: 0.74 })
  );
  // All geometry baked with handle base at Y=0, blade tip at top
  const handleGeom = new THREE.CylinderGeometry(0.042, 0.054, 0.78, 6).translate(0, 0.39, 0);
  const guardGeom = new THREE.BoxGeometry(0.50, 0.065, 0.088).translate(0, 0.815, 0);
  const bladeGeom = new THREE.BoxGeometry(0.065, 1.30, 0.042).translate(0, 0.815 + 0.65, 0);
  return [
    makeMesh(handleGeom, handleMat, cap),
    makeMesh(guardGeom, guardMat, cap),
    makeMesh(bladeGeom, bladeMat, cap),
  ];
}

function buildBowMeshes(cap: number): THREE.InstancedMesh[] {
  const arcMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x8b6a30, roughness: 0.82, metalness: 0.06 })
  );
  const stringMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.95, metalness: 0.0 })
  );
  // Arc: partial torus. Default torus is in XY plane (facing +Z).
  // rotateZ(π/2) makes it span vertically in local Y, opening facing local -X.
  // Translate so bottom of arc is near Y=0.
  const arcGeom = new THREE.TorusGeometry(0.42, 0.033, 6, 16, Math.PI * 1.06);
  arcGeom.rotateZ(Math.PI / 2);
  arcGeom.translate(0, 0.42, 0);
  // String: thin vertical cylinder spanning the bow's opening
  const stringGeom = new THREE.CylinderGeometry(0.009, 0.009, 0.86, 4);
  stringGeom.translate(0, 0.43, 0);
  return [
    makeMesh(arcGeom, arcMat, cap),
    makeMesh(stringGeom, stringMat, cap),
  ];
}

type Bank = { meshes: THREE.InstancedMesh[]; capacity: number };

function ensureCapacity(
  bank: Bank,
  required: number,
  build: (n: number) => THREE.InstancedMesh[],
  root: THREE.Group
): void {
  if (required <= bank.capacity) return;
  let n = Math.max(1, bank.capacity);
  while (n < required) n *= 2;
  bank.capacity = n;
  for (const m of bank.meshes) {
    root.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  bank.meshes = build(n);
  for (const m of bank.meshes) root.add(m);
}

function syncBank(
  meshes: THREE.InstancedMesh[],
  instances: FarmingToolInstance[],
  kind: FarmingToolKind
): void {
  const prev = meshes[0]?.count ?? 0;
  for (const m of meshes) m.count = instances.length;

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]!;
    const yaw = Math.atan2(inst.forwardX, inst.forwardZ);

    if (kind === "sword") {
      // Chop animation: swing forward/back around the side axis.
      // Euler YXZ: Y = yaw (face forward), X = tilt the blade toward/away from squad front.
      const chop = Math.sin(inst.animT * 3.4) * 0.55 + 0.25;
      DUMMY.rotation.order = _YXZ;
      DUMMY.rotation.set(chop, yaw, 0, _YXZ);
      DUMMY.position.set(
        inst.worldX + inst.sideX * 0.50 * inst.scale,
        inst.worldY + 0.36 * inst.scale,
        inst.worldZ + inst.sideZ * 0.50 * inst.scale
      );
    } else {
      // Bow: held upright on the other side, gentle sway.
      // The bow arc (after rotateZ) is vertical in local space; DUMMY yaw aligns it to face forward.
      const sway = Math.sin(inst.animT * 2.1) * 0.18;
      DUMMY.rotation.order = _YXZ;
      DUMMY.rotation.set(0, yaw + sway, 0, _YXZ);
      DUMMY.position.set(
        inst.worldX - inst.sideX * 0.50 * inst.scale,
        inst.worldY + 0.18 * inst.scale,
        inst.worldZ - inst.sideZ * 0.50 * inst.scale
      );
    }

    DUMMY.scale.setScalar(inst.scale);
    DUMMY.updateMatrix();
    for (const m of meshes) m.setMatrixAt(i, DUMMY.matrix);
  }

  // Hide surplus instances
  if (instances.length < prev) {
    DUMMY.position.set(0, -100_000, 0);
    DUMMY.scale.setScalar(0);
    DUMMY.updateMatrix();
    for (let i = instances.length; i < prev; i++) {
      for (const m of meshes) m.setMatrixAt(i, DUMMY.matrix);
    }
  }

  for (const m of meshes) m.instanceMatrix.needsUpdate = true;
}

export class FarmingToolRenderer {
  public readonly root = new THREE.Group();
  private readonly swordBank: Bank;
  private readonly bowBank: Bank;

  constructor(capacity: number) {
    this.swordBank = { meshes: buildSwordMeshes(capacity), capacity };
    this.bowBank   = { meshes: buildBowMeshes(capacity), capacity };
    for (const m of this.swordBank.meshes) this.root.add(m);
    for (const m of this.bowBank.meshes)   this.root.add(m);
  }

  sync(instances: FarmingToolInstance[]): void {
    const swords = instances.filter((i) => i.kind === "sword");
    const bows   = instances.filter((i) => i.kind === "bow");
    ensureCapacity(this.swordBank, swords.length, buildSwordMeshes, this.root);
    ensureCapacity(this.bowBank,   bows.length,   buildBowMeshes,   this.root);
    syncBank(this.swordBank.meshes, swords, "sword");
    syncBank(this.bowBank.meshes,   bows,   "bow");
  }
}

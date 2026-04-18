import * as THREE from "three";
import { GAME_RULES } from "../../shared/game-rules.js";
import { applyStylizedShading } from "./stylized-shading.js";

const DUMMY = new THREE.Object3D();

export type CarriedResourceKind = "tree" | "compute";

export type CarriedResourceInstance = {
  kind: CarriedResourceKind;
  localX: number;
  localY: number;
  localZ: number;
  sourceX?: number;
  sourceY?: number;
  sourceZ?: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  rotationY: number;
  tiltX: number;
  tiltZ?: number;
  scale: number;
  growT?: number;
  pickupT?: number;
  throwT?: number;
};

type MeshBank = {
  meshes: THREE.InstancedMesh[];
  capacity: number;
};

function buildTreeMeshes(capacity: number): THREE.InstancedMesh[] {
  const trunkMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x7c5632, roughness: 0.96, metalness: 0.02 })
  );
  const leafMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x6f9f58, roughness: 0.98, metalness: 0 })
  );
  const parts = [
    { geometry: new THREE.CylinderGeometry(0.22, 0.32, 2.5, 6).translate(0, 1.25, 0), material: trunkMat },
    { geometry: new THREE.SphereGeometry(0.88, 8, 7).scale(1, 1.15, 1).translate(0, 3.1, 0), material: leafMat },
    { geometry: new THREE.SphereGeometry(0.8, 8, 7).scale(1.15, 0.95, 1.05).translate(-0.55, 2.85, 0.2), material: leafMat },
    { geometry: new THREE.SphereGeometry(0.72, 8, 7).scale(0.95, 1.05, 1.1).translate(0.5, 2.78, -0.18), material: leafMat },
  ];
  return parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  });
}

function buildComputeMeshes(capacity: number): THREE.InstancedMesh[] {
  const crystalMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({
      color: 0x7be7ff,
      emissive: 0x2bb6d7,
      emissiveIntensity: 0.55,
      roughness: 0.32,
      metalness: 0.06,
    })
  );
  const baseMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x8ba9b1, roughness: 0.74, metalness: 0.08 })
  );
  const parts = [
    { geometry: new THREE.OctahedronGeometry(0.34, 0).scale(0.85, 1.5, 0.85).translate(0, 0.58, 0), material: crystalMat },
    { geometry: new THREE.CylinderGeometry(0.13, 0.18, 0.3, 6).translate(0, 0.16, 0), material: baseMat },
  ];
  return parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  });
}

function createBank(buildMeshes: (capacity: number) => THREE.InstancedMesh[], capacity: number): MeshBank {
  return { meshes: buildMeshes(capacity), capacity };
}

function rebuildBank(bank: MeshBank, buildMeshes: (capacity: number) => THREE.InstancedMesh[], root: THREE.Group): void {
  for (const mesh of bank.meshes) root.remove(mesh);
  for (const mesh of bank.meshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  bank.meshes = buildMeshes(bank.capacity);
  for (const mesh of bank.meshes) root.add(mesh);
}

function ensureCapacity(bank: MeshBank, required: number, buildMeshes: (capacity: number) => THREE.InstancedMesh[], root: THREE.Group): void {
  if (required <= bank.capacity) return;
  let nextCapacity = Math.max(1, bank.capacity);
  while (nextCapacity < required) nextCapacity *= 2;
  bank.capacity = nextCapacity;
  rebuildBank(bank, buildMeshes, root);
}

export class CarriedResourceRenderer {
  public readonly root = new THREE.Group();
  private readonly treeBank: MeshBank;
  private readonly computeBank: MeshBank;

  public constructor(capacity: number) {
    this.treeBank = createBank(buildTreeMeshes, capacity);
    this.computeBank = createBank(buildComputeMeshes, capacity);
    for (const mesh of this.treeBank.meshes) this.root.add(mesh);
    for (const mesh of this.computeBank.meshes) this.root.add(mesh);
  }

  public sync(instances: CarriedResourceInstance[]): void {
    const treeInstances = instances.filter((instance) => instance.kind === "tree");
    const computeInstances = instances.filter((instance) => instance.kind === "compute");

    ensureCapacity(this.treeBank, treeInstances.length, buildTreeMeshes, this.root);
    ensureCapacity(this.computeBank, computeInstances.length, buildComputeMeshes, this.root);

    this.syncBank(this.treeBank.meshes, treeInstances);
    this.syncBank(this.computeBank.meshes, computeInstances);
  }

  private syncBank(meshes: THREE.InstancedMesh[], instances: CarriedResourceInstance[]): void {
    const previousCount = meshes[0]?.count ?? 0;
    for (const mesh of meshes) mesh.count = instances.length;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i]!;
      const throwT = Math.max(0, Math.min(1, instance.throwT ?? 0));
      const pickupT = Math.max(0, Math.min(1, instance.pickupT ?? 1));
      const growT = Math.max(0, Math.min(1, instance.growT ?? 1));
      const pickupEase = 1 - Math.pow(1 - pickupT, 2);
      const throwEase = throwT * throwT * (3 - 2 * throwT);
      const posAfterPickupX =
        pickupT < 1 && typeof instance.sourceX === "number"
          ? THREE.MathUtils.lerp(instance.sourceX, instance.localX, pickupEase)
          : instance.localX;
      const posAfterPickupY =
        pickupT < 1 && typeof instance.sourceY === "number"
          ? THREE.MathUtils.lerp(instance.sourceY, instance.localY, pickupEase)
          : instance.localY;
      const posAfterPickupZ =
        pickupT < 1 && typeof instance.sourceZ === "number"
          ? THREE.MathUtils.lerp(instance.sourceZ, instance.localZ, pickupEase)
          : instance.localZ;
      const posX = throwT > 0 && typeof instance.targetX === "number"
        ? THREE.MathUtils.lerp(posAfterPickupX, instance.targetX, throwEase)
        : posAfterPickupX;
      const posYBase = throwT > 0 && typeof instance.targetY === "number"
        ? THREE.MathUtils.lerp(posAfterPickupY, instance.targetY, throwEase)
        : posAfterPickupY;
      const posZ = throwT > 0 && typeof instance.targetZ === "number"
        ? THREE.MathUtils.lerp(posAfterPickupZ, instance.targetZ, throwEase)
        : posAfterPickupZ;
      const throwDistance =
        throwT > 0 && typeof instance.targetX === "number" && typeof instance.targetZ === "number"
          ? Math.hypot(instance.targetX - posAfterPickupX, instance.targetZ - posAfterPickupZ)
          : 0;
      const arcPeak = Math.max(
        GAME_RULES.UNIT_HEIGHT * 1.35,
        Math.min(GAME_RULES.UNIT_HEIGHT * 3.4, throwDistance * 0.28)
      );
      const arcY = throwT > 0 ? Math.sin(throwEase * Math.PI) * arcPeak : 0;
      const carryTiltX =
        instance.kind === "tree"
          ? THREE.MathUtils.lerp(-0.72, instance.tiltX, pickupEase)
          : instance.tiltX;
      const carryRotationY =
        instance.kind === "tree" && pickupT < 1
          ? instance.rotationY + THREE.MathUtils.lerp(-0.6, 0, pickupEase)
          : instance.rotationY;
      const throwTiltX =
        throwT > 0 && instance.kind === "tree"
          ? THREE.MathUtils.lerp(carryTiltX, -1.02, throwEase)
          : carryTiltX;
      DUMMY.position.set(posX, posYBase + arcY, posZ);
      DUMMY.rotation.set(throwTiltX, carryRotationY + throwEase * 1.1, instance.tiltZ ?? 0);
      DUMMY.scale.setScalar(instance.scale * growT);
      DUMMY.updateMatrix();
      for (const mesh of meshes) mesh.setMatrixAt(i, DUMMY.matrix);
    }
    if (instances.length < previousCount) {
      DUMMY.position.set(0, -10_000, 0);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.setScalar(0);
      DUMMY.updateMatrix();
      for (let i = instances.length; i < previousCount; i++) {
        for (const mesh of meshes) mesh.setMatrixAt(i, DUMMY.matrix);
      }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

export function createDraggedTreeInstance(params: {
  localX: number;
  localZ: number;
  baseY: number;
  forwardX: number;
  forwardZ: number;
  sideX: number;
  sideZ: number;
  scale: number;
}): CarriedResourceInstance {
  const dragBack = GAME_RULES.UNIT_RADIUS * 2.35 * params.scale;
  const dragSide = GAME_RULES.UNIT_RADIUS * 0.58 * params.scale;
  return {
    kind: "tree",
    localX: params.localX - params.forwardX * dragBack + params.sideX * dragSide,
    localY: params.baseY,
    localZ: params.localZ - params.forwardZ * dragBack + params.sideZ * dragSide,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: -0.18,
    tiltZ: 0,
    scale: 1.18,
  };
}

export function createDraggedComputeInstance(params: {
  localX: number;
  localZ: number;
  baseY: number;
  forwardX: number;
  forwardZ: number;
  sideX: number;
  sideZ: number;
  scale: number;
}): CarriedResourceInstance {
  return {
    kind: "compute",
    localX: params.localX - params.forwardX * GAME_RULES.UNIT_RADIUS * 0.9 * params.scale + params.sideX * GAME_RULES.UNIT_RADIUS * 0.2 * params.scale,
    localY: params.baseY + GAME_RULES.UNIT_HEIGHT * 0.18 * params.scale,
    localZ: params.localZ - params.forwardZ * GAME_RULES.UNIT_RADIUS * 0.9 * params.scale + params.sideZ * GAME_RULES.UNIT_RADIUS * 0.2 * params.scale,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: Math.PI * 0.08,
    scale: 0.78 * params.scale,
  };
}

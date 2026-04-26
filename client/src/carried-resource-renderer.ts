import * as THREE from "three";
import { GAME_RULES } from "../../shared/game-rules.js";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { applyStylizedShading } from "./stylized-shading.js";
import { isStylizedLitMaterial } from "./stylized-shading.js";
import { createConstructionBlockMesh } from "./construction-blocks.js";

const DUMMY = new THREE.Object3D();
const START_EULER = new THREE.Euler();
const END_EULER = new THREE.Euler();
const START_QUAT = new THREE.Quaternion();
const END_QUAT = new THREE.Quaternion();
const RESULT_QUAT = new THREE.Quaternion();
const GPU_GLB = publicAssetUrl("models/buildings/gpu.glb");
const CARRIED_GPU_TARGET_HEIGHT = 0.82;

export type CarriedResourceKind = "tree" | "compute" | "plants" | "building_block";

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
  targetRotationY?: number;
  targetTiltX?: number;
  targetTiltZ?: number;
  scale: number;
  growT?: number;
  pickupT?: number;
  throwT?: number;
  bobPhase?: number;
};

type MeshBank = {
  meshes: THREE.InstancedMesh[];
  capacity: number;
};

let carriedGpuMeshesTemplate: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> | null = null;
let carriedGpuMeshesPromise: Promise<Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>> | null = null;

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
  if (carriedGpuMeshesTemplate && carriedGpuMeshesTemplate.length > 0) {
    return carriedGpuMeshesTemplate.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry.clone(), part.material.clone(), capacity);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    });
  }

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

function fitGroundAndCenterXZ(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxY = Math.max(size.y, 1e-3);
  const scale = targetHeight / maxY;
  root.scale.setScalar(scale);
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

function meshPartsFromObject(root: THREE.Object3D): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
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
      const nextMaterial = isStylizedLitMaterial(material)
        ? applyStylizedShading(material.clone())
        : material.clone();
      parts.push({ geometry, material: nextMaterial });
    }
  });
  return parts;
}

async function ensureCarriedGpuMeshesLoaded(): Promise<Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>> {
  if (carriedGpuMeshesTemplate) return carriedGpuMeshesTemplate;
  if (carriedGpuMeshesPromise) return carriedGpuMeshesPromise;
  carriedGpuMeshesPromise = (async () => {
    const loader = createGLTFLoader();
    try {
      const gltf = await loader.loadAsync(GPU_GLB);
      const root = gltf.scene.clone(true) as THREE.Group;
      fitGroundAndCenterXZ(root, CARRIED_GPU_TARGET_HEIGHT);
      const parts = meshPartsFromObject(root);
      if (parts.length > 0) {
        carriedGpuMeshesTemplate = parts;
        return parts;
      }
      console.warn(`[carried-resource-renderer] GPU GLB had no mesh parts, using fallback: ${GPU_GLB}`);
    } catch (err) {
      console.warn(`[carried-resource-renderer] Could not load GPU GLB, using fallback: ${GPU_GLB}`, err);
    }
    carriedGpuMeshesTemplate = [];
    return carriedGpuMeshesTemplate;
  })();
  return carriedGpuMeshesPromise;
}

function buildPlantMeshes(capacity: number): THREE.InstancedMesh[] {
  const stemMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x5ca23a, roughness: 0.92, metalness: 0.01 })
  );
  const leafMat = applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0x92df62, roughness: 0.88, metalness: 0 })
  );
  const parts = [
    { geometry: new THREE.CylinderGeometry(0.06, 0.1, 1.4, 6).translate(0, 0.7, 0), material: stemMat },
    { geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10).scale(1.7, 1, 0.28).rotateZ(Math.PI * 0.5).translate(0.45, 0.76, 0), material: leafMat },
    { geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10).scale(1.5, 1, 0.28).rotateZ(Math.PI * 0.5).translate(-0.38, 1.02, 0), material: leafMat },
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

function buildBuildingBlockMeshes(capacity: number): THREE.InstancedMesh[] {
  return [createConstructionBlockMesh(capacity)];
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
  private readonly plantsBank: MeshBank;
  private readonly blockBank: MeshBank;

  public constructor(capacity: number) {
    this.treeBank = createBank(buildTreeMeshes, capacity);
    this.computeBank = createBank(buildComputeMeshes, capacity);
    this.plantsBank = createBank(buildPlantMeshes, capacity);
    this.blockBank = createBank(buildBuildingBlockMeshes, capacity);
    for (const mesh of this.treeBank.meshes) this.root.add(mesh);
    for (const mesh of this.computeBank.meshes) this.root.add(mesh);
    for (const mesh of this.plantsBank.meshes) this.root.add(mesh);
    for (const mesh of this.blockBank.meshes) this.root.add(mesh);
    void this.loadComputeGpuMeshes();
  }

  private async loadComputeGpuMeshes(): Promise<void> {
    const parts = await ensureCarriedGpuMeshesLoaded();
    if (parts.length === 0) return;
    rebuildBank(this.computeBank, buildComputeMeshes, this.root);
  }

  public sync(instances: CarriedResourceInstance[]): void {
    const treeInstances = instances.filter((instance) => instance.kind === "tree");
    const computeInstances = instances.filter((instance) => instance.kind === "compute");
    const plantsInstances = instances.filter((instance) => instance.kind === "plants");
    const blockInstances = instances.filter((instance) => instance.kind === "building_block");

    ensureCapacity(this.treeBank, treeInstances.length, buildTreeMeshes, this.root);
    ensureCapacity(this.computeBank, computeInstances.length, buildComputeMeshes, this.root);
    ensureCapacity(this.plantsBank, plantsInstances.length, buildPlantMeshes, this.root);
    ensureCapacity(this.blockBank, blockInstances.length, buildBuildingBlockMeshes, this.root);

    this.syncBank(this.treeBank.meshes, treeInstances);
    this.syncBank(this.computeBank.meshes, computeInstances);
    this.syncBank(this.plantsBank.meshes, plantsInstances);
    this.syncBank(this.blockBank.meshes, blockInstances);
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
      const isBuildingBlock = instance.kind === "building_block";
      const arcY = throwT > 0
        ? Math.sin(throwEase * Math.PI) * arcPeak
        : 0;
      const landingT = throwT > 0 && isBuildingBlock
        ? Math.max(0, Math.min(1, (throwEase - 0.72) / 0.28))
        : 0;
      const settleBounce = throwT > 0 && isBuildingBlock
        ? Math.sin(landingT * Math.PI) * GAME_RULES.UNIT_HEIGHT * 0.18
        : 0;
      const bobPhase = instance.bobPhase ?? 0;
      const bobWave = Math.abs(Math.sin(bobPhase));
      const bobY = throwT > 0 ? 0 : bobWave * GAME_RULES.UNIT_HEIGHT * 0.18;
      const carryTiltX =
        instance.kind === "tree"
          ? THREE.MathUtils.lerp(-0.72, instance.tiltX, pickupEase)
          : instance.tiltX;
      const carryRotationY =
        instance.kind === "tree" && pickupT < 1
          ? instance.rotationY + THREE.MathUtils.lerp(-0.6, 0, pickupEase)
          : instance.rotationY;
      const throwTiltX =
        throwT > 0
          ? THREE.MathUtils.lerp(
              carryTiltX,
              instance.targetTiltX ?? (instance.kind === "tree" ? -1.02 : carryTiltX),
              throwEase
            )
          : carryTiltX;
      const throwTiltZ = throwT > 0
        ? THREE.MathUtils.lerp(instance.tiltZ ?? 0, instance.targetTiltZ ?? instance.tiltZ ?? 0, throwEase)
        : instance.tiltZ ?? 0;
      const placementPitch = throwT > 0 && isBuildingBlock
        ? (1 - throwEase) * 0.22 + Math.sin(landingT * Math.PI) * 0.08
        : 0;
      const settleScale = throwT > 0 && isBuildingBlock
        ? 1 + Math.sin(landingT * Math.PI) * 0.06
        : 1;
      DUMMY.position.set(posX, posYBase + arcY + settleBounce + bobY, posZ);
      if (throwT > 0 && isBuildingBlock) {
        const rotationEase = THREE.MathUtils.smoothstep(throwEase, 0.42, 1);
        START_EULER.set(carryTiltX, carryRotationY, instance.tiltZ ?? 0);
        END_EULER.set(instance.targetTiltX ?? 0, instance.targetRotationY ?? carryRotationY, instance.targetTiltZ ?? 0);
        START_QUAT.setFromEuler(START_EULER);
        END_QUAT.setFromEuler(END_EULER);
        RESULT_QUAT.slerpQuaternions(START_QUAT, END_QUAT, rotationEase);
        DUMMY.quaternion.copy(RESULT_QUAT);
        DUMMY.rotateX(placementPitch);
      } else {
        DUMMY.rotation.set(throwTiltX, carryRotationY, throwTiltZ);
      }
      DUMMY.scale.setScalar(instance.scale * growT * settleScale);
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
  return {
    kind: "tree",
    localX: params.localX + params.sideX * GAME_RULES.UNIT_RADIUS * 0.12 * params.scale,
    localY: params.baseY + GAME_RULES.UNIT_HEIGHT * 1.5 * params.scale,
    localZ: params.localZ + params.sideZ * GAME_RULES.UNIT_RADIUS * 0.12 * params.scale,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: 0.08,
    tiltZ: 0,
    scale: 0.92,
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
    localX: params.localX + params.sideX * GAME_RULES.UNIT_RADIUS * 0.1 * params.scale,
    localY: params.baseY + GAME_RULES.UNIT_HEIGHT * 1.42 * params.scale,
    localZ: params.localZ + params.sideZ * GAME_RULES.UNIT_RADIUS * 0.1 * params.scale,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: Math.PI * 0.03,
    scale: 1.55 * params.scale,
  };
}

export function createDraggedPlantsInstance(params: {
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
    kind: "plants",
    localX: params.localX + params.sideX * GAME_RULES.UNIT_RADIUS * 0.08 * params.scale,
    localY: params.baseY + GAME_RULES.UNIT_HEIGHT * 1.36 * params.scale,
    localZ: params.localZ + params.sideZ * GAME_RULES.UNIT_RADIUS * 0.08 * params.scale,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: Math.PI * 0.04,
    scale: 1.28 * params.scale,
  };
}

export function createDraggedBuildingBlockInstance(params: {
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
    kind: "building_block",
    localX: params.localX + params.sideX * GAME_RULES.UNIT_RADIUS * 0.1 * params.scale,
    localY: params.baseY + GAME_RULES.UNIT_HEIGHT * 1.28 * params.scale,
    localZ: params.localZ + params.sideZ * GAME_RULES.UNIT_RADIUS * 0.1 * params.scale,
    rotationY: Math.atan2(params.forwardX, params.forwardZ),
    tiltX: 0,
    tiltZ: 0,
    scale: 1,
  };
}

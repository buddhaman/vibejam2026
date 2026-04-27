import * as THREE from "three";
import { applyStylizedShading } from "./stylized-shading.js";

export const CONSTRUCTION_BLOCK_WIDTH = 1.9;
export const CONSTRUCTION_BLOCK_HEIGHT = 1.12;
export const CONSTRUCTION_BLOCK_DEPTH = 1.5;

const GEOMETRY = new THREE.BoxGeometry(
  CONSTRUCTION_BLOCK_WIDTH,
  CONSTRUCTION_BLOCK_HEIGHT,
  CONSTRUCTION_BLOCK_DEPTH
).translate(0, CONSTRUCTION_BLOCK_HEIGHT * 0.5, 0);

function createMaterial(): THREE.Material {
  return applyStylizedShading(
    new THREE.MeshStandardMaterial({ color: 0xc98b48, roughness: 0.9, metalness: 0.02 })
  );
}

export type ConstructionBlockPose = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
};

export function createConstructionBlockMesh(capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(GEOMETRY.clone(), createMaterial(), capacity);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function getConstructionBlockStackPose(stackIndex: number, required: number): ConstructionBlockPose {
  const perLayer = required <= 3 ? 3 : 6;
  const cols = required <= 3 ? 3 : 3;
  const rows = Math.ceil(perLayer / cols);
  const layer = Math.floor(stackIndex / perLayer);
  const layerIndex = stackIndex % perLayer;
  const col = layerIndex % cols;
  const row = Math.floor(layerIndex / cols);
  return {
    x: (col - (cols - 1) * 0.5) * (CONSTRUCTION_BLOCK_WIDTH * 1.08),
    y: 0.28 + layer * (CONSTRUCTION_BLOCK_HEIGHT * 1.04),
    z: (row - (rows - 1) * 0.5) * (CONSTRUCTION_BLOCK_DEPTH * 1.12),
    rotationY: (layer % 2 === 0 ? 0 : Math.PI * 0.5) + (stackIndex % 2) * 0.035,
  };
}

export function writeConstructionBlockMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  pose: ConstructionBlockPose,
  scratch: THREE.Object3D,
  scale = 1
): void {
  scratch.position.set(pose.x, pose.y, pose.z);
  scratch.rotation.set(0, pose.rotationY, 0);
  scratch.scale.setScalar(scale);
  scratch.updateMatrix();
  mesh.setMatrixAt(index, scratch.matrix);
}

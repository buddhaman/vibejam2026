import * as THREE from "three";

const DUMMY = new THREE.Object3D();

export type InstancedTransform = {
  position: THREE.Vector3;
  rotationY: number;
  scale: THREE.Vector3;
};

export type InstancedVariantPart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export type InstancedVariant = {
  parts: InstancedVariantPart[];
};

export type InstancedVariantSet = {
  root: THREE.Group;
  capacity: number;
  definitions: InstancedVariant[];
  variants: Array<{
    meshes: THREE.InstancedMesh[];
  }>;
};

export function createInstancedVariantSet(variants: InstancedVariant[], capacity: number): InstancedVariantSet {
  const root = new THREE.Group();
  const built = variants.map((variant) => {
    const meshes = variant.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.count = 0;
      mesh.castShadow = part.castShadow ?? true;
      mesh.receiveShadow = part.receiveShadow ?? true;
      // The same InstancedMesh is reused for trees/mines across the whole streamed world.
      // Dynamic instance matrices can leave Three.js with stale bounds, causing forests to
      // vanish at certain camera distances/angles. Keep these world-decoration sets visible.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
      return mesh;
    });
    return { meshes };
  });

  return { root, capacity, definitions: variants, variants: built };
}

function rebuildSet(set: InstancedVariantSet, capacity: number): void {
  while (set.root.children.length > 0) set.root.remove(set.root.children[0]!);
  set.capacity = capacity;
  set.variants = set.definitions.map((variant) => {
    const meshes = variant.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.count = 0;
      mesh.castShadow = part.castShadow ?? true;
      mesh.receiveShadow = part.receiveShadow ?? true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      set.root.add(mesh);
      return mesh;
    });
    return { meshes };
  });
}

function ensureCapacity(set: InstancedVariantSet, required: number): void {
  if (required <= set.capacity) return;
  let nextCapacity = Math.max(1, set.capacity);
  while (nextCapacity < required) nextCapacity *= 2;
  rebuildSet(set, nextCapacity);
}

export function syncInstancedVariantSet(
  set: InstancedVariantSet,
  transformsByVariant: InstancedTransform[][]
) {
  let maxCount = 0;
  for (const transforms of transformsByVariant) {
    if (transforms.length > maxCount) maxCount = transforms.length;
  }
  ensureCapacity(set, maxCount);

  for (let variantIndex = 0; variantIndex < set.variants.length; variantIndex++) {
    const transforms = transformsByVariant[variantIndex] ?? [];
    const variant = set.variants[variantIndex];
    const previousCount = variant.meshes[0]?.count ?? 0;
    for (const mesh of variant.meshes) {
      mesh.count = transforms.length;
    }
    for (let i = 0; i < transforms.length; i++) {
      const transform = transforms[i];
      DUMMY.position.copy(transform.position);
      DUMMY.rotation.set(0, transform.rotationY, 0);
      DUMMY.scale.copy(transform.scale);
      DUMMY.updateMatrix();
      for (const mesh of variant.meshes) {
        mesh.setMatrixAt(i, DUMMY.matrix);
      }
    }
    if (transforms.length < previousCount) {
      DUMMY.position.set(0, -10_000, 0);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.scale.set(0, 0, 0);
      DUMMY.updateMatrix();
      for (let i = transforms.length; i < previousCount; i++) {
        for (const mesh of variant.meshes) {
          mesh.setMatrixAt(i, DUMMY.matrix);
        }
      }
    }
    for (const mesh of variant.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
  }
}

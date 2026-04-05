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
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
      return mesh;
    });
    return { meshes };
  });

  return { root, variants: built };
}

export function syncInstancedVariantSet(
  set: InstancedVariantSet,
  transformsByVariant: InstancedTransform[][]
) {
  for (let variantIndex = 0; variantIndex < set.variants.length; variantIndex++) {
    const transforms = transformsByVariant[variantIndex] ?? [];
    const variant = set.variants[variantIndex];
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
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (let i = transforms.length; i < variant.meshes[0].count; i++) {
      for (const mesh of variant.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

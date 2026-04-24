import * as THREE from "three";

const OUTLINE_RENDER_ORDER = 1;
const TMP_MATRIX = new THREE.Matrix4();
const TMP_POSITION = new THREE.Vector3();
const TMP_QUATERNION = new THREE.Quaternion();
const TMP_SCALE = new THREE.Vector3();
const TMP_OUTLINE_COLOR = new THREE.Color();
const TMP_BOX = new THREE.Box3();
const TMP_CENTER = new THREE.Vector3();
const TMP_OFFSET = new THREE.Vector3();

function createOutlineMaterial(sourceMaterial: THREE.Material): THREE.Material {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: false,
    fog: false,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  material.name = `${sourceMaterial.name || "outline"}_selection_outline`;
  return material;
}

function applyOutlineAppearance(obj: THREE.Object3D): void {
  if (!(obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh)) return;
  const sourceMaterial = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  obj.material = createOutlineMaterial(sourceMaterial);
  obj.castShadow = false;
  obj.receiveShadow = false;
  obj.renderOrder = OUTLINE_RENDER_ORDER;
  obj.frustumCulled = false;
}

function recenterOutlineMeshPivot(mesh: THREE.Mesh | THREE.InstancedMesh): void {
  const geometry = mesh.geometry.clone();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return;
  TMP_BOX.copy(geometry.boundingBox);
  TMP_BOX.getCenter(TMP_CENTER);
  geometry.translate(-TMP_CENTER.x, -TMP_CENTER.y, -TMP_CENTER.z);
  TMP_OFFSET.copy(TMP_CENTER).multiply(mesh.scale).applyQuaternion(mesh.quaternion);
  mesh.geometry = geometry;
  mesh.position.add(TMP_OFFSET);
}

function visitOutlineMaterials(
  object: THREE.Object3D,
  fn: (material: THREE.Material) => void
): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) fn(material);
  });
}

export function createSelectionOutlineClone(source: THREE.Object3D, scaleMultiplier = 1): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((child) => {
    applyOutlineAppearance(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
      recenterOutlineMeshPivot(child);
      if (scaleMultiplier !== 1) child.scale.multiplyScalar(scaleMultiplier);
    }
  });
  clone.visible = false;
  clone.frustumCulled = false;
  return clone;
}

export function setSelectionOutlineColor(object: THREE.Object3D, color: THREE.ColorRepresentation): void {
  visitOutlineMaterials(object, (material) => {
    if ("color" in material && material.color instanceof THREE.Color) {
      material.color.set(color);
    }
  });
}

export function getBrightTeamSelectionColor(color: THREE.ColorRepresentation): THREE.Color {
  if (typeof color === "number") {
    return TMP_OUTLINE_COLOR.setHex(color, THREE.SRGBColorSpace);
  }
  return TMP_OUTLINE_COLOR.set(color);
}

export function createInstancedSelectionOutline(source: THREE.InstancedMesh): THREE.InstancedMesh {
  const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
  const capacity = source.instanceMatrix.count;
  const outline = new THREE.InstancedMesh(source.geometry, createOutlineMaterial(sourceMaterial), capacity);
  outline.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  outline.count = 0;
  outline.visible = false;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.frustumCulled = false;
  outline.renderOrder = OUTLINE_RENDER_ORDER;
  return outline;
}

export function syncInstancedSelectionOutline(
  source: THREE.InstancedMesh,
  outline: THREE.InstancedMesh,
  scaleMultiplier: number
): void {
  outline.visible = source.visible && source.count > 0;
  outline.count = source.count;
  for (let i = 0; i < source.count; i++) {
    source.getMatrixAt(i, TMP_MATRIX);
    TMP_MATRIX.decompose(TMP_POSITION, TMP_QUATERNION, TMP_SCALE);
    TMP_SCALE.multiplyScalar(scaleMultiplier);
    TMP_MATRIX.compose(TMP_POSITION, TMP_QUATERNION, TMP_SCALE);
    outline.setMatrixAt(i, TMP_MATRIX);
  }
  outline.instanceMatrix.needsUpdate = true;
}

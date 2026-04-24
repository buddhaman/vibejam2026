import * as THREE from "three";

const DEFAULT_SEGMENTS = 72;
const RING_GEOM_CACHE = new Map<string, THREE.RingGeometry>();

export function createSelectionRingMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
}

export function createSelectionFillMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
}

function getSelectionRingGeometry(innerRadius: number, segments = DEFAULT_SEGMENTS): THREE.RingGeometry {
  const quantized = Math.max(0.5, Math.min(0.995, Math.round(innerRadius * 1000) / 1000));
  const key = `${segments}:${quantized.toFixed(3)}`;
  let geom = RING_GEOM_CACHE.get(key);
  if (!geom) {
    geom = new THREE.RingGeometry(quantized, 1, segments);
    RING_GEOM_CACHE.set(key, geom);
  }
  return geom;
}

export function applySelectionRingScreenThickness(
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>,
  outerScaleX: number,
  outerScaleZ: number,
  worldUnitsPerPixel: number,
  thicknessPx: number,
  minWorldThickness = 0.025,
  segments = DEFAULT_SEGMENTS
): void {
  mesh.scale.set(outerScaleX, outerScaleZ, 1);
  const targetWorldThickness = Math.max(minWorldThickness, worldUnitsPerPixel * thicknessPx);
  const avgOuterRadius = Math.max(0.001, (outerScaleX + outerScaleZ) * 0.5);
  const localThickness = Math.max(0.01, Math.min(0.45, targetWorldThickness / avgOuterRadius));
  const innerRadius = 1 - localThickness;
  const geom = getSelectionRingGeometry(innerRadius, segments);
  if (mesh.geometry !== geom) mesh.geometry = geom;
}


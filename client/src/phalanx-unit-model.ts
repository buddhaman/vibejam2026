import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GAME_RULES } from "../../shared/game-rules.js";

const PHALANX_GLB = "/models/buildings/phalanx.glb";

/** Set on materials whose base red was neutralized — runtime `color` is filled from `getPlayerColor`. */
export const PHALANX_TEAM_TINT_USERDATA = "phalanxTeamTint" as const;

export type PhalanxPartTemplate = {
  geometry: THREE.BufferGeometry;
  /** Cloned per squad; flagged pieces get {@link PHALANX_TEAM_TINT_USERDATA}. */
  baseMaterial: THREE.MeshStandardMaterial;
};

let templates: PhalanxPartTemplate[] | null = null;

function fitGroundCenterScaleY(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const sy = Math.max(size.y, 1e-3);
  const s = targetHeight / sy;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const c = box3.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
}

function toStandardMaterial(m: THREE.Material): THREE.MeshStandardMaterial {
  if (m instanceof THREE.MeshStandardMaterial) return m.clone();
  if (m instanceof THREE.MeshPhysicalMaterial) {
    const s = new THREE.MeshStandardMaterial({
      color: m.color,
      map: m.map,
      normalMap: m.normalMap,
      roughness: m.roughness,
      metalness: m.metalness,
    });
    return s;
  }
  return new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.78, metalness: 0.08 });
}

const _hsl = { h: 0, s: 0, l: 0 };

function isRedFabricColor(color: THREE.Color, loose: boolean): boolean {
  color.getHSL(_hsl);
  const r = color.r;
  const g = color.g;
  const b = color.b;
  const rMin = loose ? 0.2 : 0.27;
  const gRat = loose ? 1.07 : 1.14;
  const bRat = loose ? 1.08 : 1.18;
  const redDominant = r > rMin && r > g * gRat && r > b * bRat;
  const h = _hsl.h;
  const s = _hsl.s;
  const inRedHue =
    (h < (loose ? 0.1 : 0.055) || h > (loose ? 0.9 : 0.97)) && s > (loose ? 0.07 : 0.11) && _hsl.l > 0.05;
  if (!redDominant && !inRedHue) return false;
  if (!redDominant && s < 0.12) return false;
  return true;
}

/**
 * Marks **material.color** reds so the squad can multiply by `getPlayerColor` each frame.
 * Sets albedo to white (full texture contribution); clears red **emissive** so glow stays neutral.
 * Red in **texture pixels** is not shifted without a shader.
 */
function remapRedFabricsOnMaterial(mat: THREE.MeshStandardMaterial, meshAndMaterialName: string): void {
  const loose = /cape|cloak|mantle|robe|fabric|cloth|banner|plume|feather/i.test(meshAndMaterialName);
  let teamTint = false;
  if (isRedFabricColor(mat.color, loose)) {
    mat.color.setRGB(1, 1, 1);
    teamTint = true;
  }
  if (isRedFabricColor(mat.emissive, loose)) {
    mat.emissive.setScalar(0);
  }
  if (teamTint) mat.userData[PHALANX_TEAM_TINT_USERDATA] = true;
}

function extractTemplates(root: THREE.Group): PhalanxPartTemplate[] {
  const out: PhalanxPartTemplate[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    const raw = obj.material;
    const src = Array.isArray(raw) ? raw[0]! : raw;
    const std = toStandardMaterial(src);
    const label = `${obj.name} ${src.name ?? ""}`;
    remapRedFabricsOnMaterial(std, label);
    out.push({ geometry: geom, baseMaterial: std });
  });
  return out;
}

/** Builds shared geometries + prototype materials (one load for the whole app). */
export async function ensurePhalanxUnitModelLoaded(): Promise<void> {
  if (templates !== null) return;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(PHALANX_GLB);
    const root = gltf.scene as THREE.Group;
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    fitGroundCenterScaleY(root, GAME_RULES.UNIT_HEIGHT * 1.08);
    templates = extractTemplates(root);
    if (templates.length === 0) {
      console.warn(`[phalanx-unit] "${PHALANX_GLB}" has no meshes — warbands use placeholder.`);
      templates = [];
    } else {
      console.log(`[phalanx-unit] Loaded ${templates.length} mesh part(s) from ${PHALANX_GLB}`);
    }
  } catch (e) {
    console.warn(`[phalanx-unit] Failed to load ${PHALANX_GLB}`, e);
    templates = [];
  }
}

/** Geometries are shared; clone `baseMaterial` per squad for tinting. */
export function createPhalanxInstancedMeshes(capacity: number): THREE.InstancedMesh[] {
  if (!templates || templates.length === 0) return [];
  return templates.map((t) => {
    const mesh = new THREE.InstancedMesh(t.geometry, t.baseMaterial.clone(), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}

export function hasPhalanxGlbMeshes(): boolean {
  return templates !== null && templates.length > 0;
}

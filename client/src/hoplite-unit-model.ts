import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GAME_RULES } from "../../shared/game-rules.js";
import { TEAM_FACTION_TEX_MARK, textureLikelyHasBrightFactionColors } from "./render-texture-recolor.js";
import { applyStylizedShading } from "./stylized-shading.js";

const HOPLITE_GLB = "/models/buildings/hoplite.glb";

export type HoplitePartTemplate = {
  geometry: THREE.BufferGeometry;
  baseMaterial: THREE.MeshStandardMaterial;
};

let templates: HoplitePartTemplate[] | null = null;

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
  if (m instanceof THREE.MeshStandardMaterial) return applyStylizedShading(m.clone());
  if (m instanceof THREE.MeshPhysicalMaterial) {
    const s = applyStylizedShading(new THREE.MeshStandardMaterial({
      color: m.color,
      map: m.map,
      normalMap: m.normalMap,
      roughness: m.roughness,
      metalness: m.metalness,
      emissive: m.emissive,
      emissiveMap: m.emissiveMap,
    }));
    return s;
  }
  return applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.78, metalness: 0.08 }));
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

const FABRIC_NAME =
  /cape|cloak|mantle|robe|fabric|cloth|banner|plume|feather|skirt|tabard|sash|trim|lining|undershirt/i;

/** Meshes that are unlikely to be recolorable livery (auto scan only). */
const SKIP_AUTO_TEX_REMAP =
  /skin|face|hair|scalp|metal|steel|iron|chain|buckler|wood|leather|eye|teeth|mouth|pupil|lash|brow/i;

function markTeamTextureRemap(std: THREE.MeshStandardMaterial, label: string): void {
  const loose = FABRIC_NAME.test(label);
  const hasMap = std.map !== null;
  const skipScan = SKIP_AUTO_TEX_REMAP.test(label);
  const autoFromTex = hasMap && !skipScan && textureLikelyHasBrightFactionColors(std.map!);

  if (isRedFabricColor(std.emissive, loose)) std.emissive.setScalar(0);

  if (hasMap && (loose || isRedFabricColor(std.color, true) || autoFromTex)) {
    std.userData[TEAM_FACTION_TEX_MARK] = true;
    std.color.setRGB(1, 1, 1);
  }
}

function extractTemplates(root: THREE.Group): HoplitePartTemplate[] {
  const out: HoplitePartTemplate[] = [];
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geom = obj.geometry.clone();
    geom.applyMatrix4(obj.matrixWorld);
    const raw = obj.material;
    const src = Array.isArray(raw) ? raw[0]! : raw;
    const std = toStandardMaterial(src);
    const label = `${obj.name} ${src.name ?? ""}`;
    markTeamTextureRemap(std, label);
    out.push({ geometry: geom, baseMaterial: std });
  });
  return out;
}

/** Builds shared geometries + prototype materials (one load for the whole app). */
export async function ensureHopliteUnitModelLoaded(): Promise<void> {
  if (templates !== null) return;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(HOPLITE_GLB);
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
      console.warn(`[hoplite-unit] "${HOPLITE_GLB}" has no meshes — warbands use placeholder.`);
      templates = [];
    } else {
      const remapParts = templates.filter((t) => t.baseMaterial.userData[TEAM_FACTION_TEX_MARK]).length;
      console.log(
        `[hoplite-unit] Loaded ${templates.length} mesh part(s) from ${HOPLITE_GLB} (${remapParts} with faction texture remap)`
      );
    }
  } catch (e) {
    console.warn(`[hoplite-unit] Failed to load ${HOPLITE_GLB}`, e);
    templates = [];
  }
}

/** Geometries are shared; clone `baseMaterial` per squad. */
export function createHopliteInstancedMeshes(capacity: number): THREE.InstancedMesh[] {
  if (!templates || templates.length === 0) return [];
  return templates.map((t) => {
    const mesh = new THREE.InstancedMesh(t.geometry, applyStylizedShading(t.baseMaterial.clone()), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}

export function hasHopliteGlbMeshes(): boolean {
  return templates !== null && templates.length > 0;
}

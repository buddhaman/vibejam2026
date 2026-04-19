import * as THREE from "three";
import { GAME_RULES, UnitType, getUnitRules } from "../../shared/game-rules.js";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { TEAM_FACTION_TEX_MARK, textureLikelyHasBrightFactionColors } from "./render-texture-recolor.js";
import { applyStylizedShading } from "./stylized-shading.js";

export type UnitPartTemplate = {
  geometry: THREE.BufferGeometry;
  baseMaterial: THREE.MeshStandardMaterial;
};

export type UnitModelSlot = "hoplite" | "agent" | "archer" | "synthaur";

const GLB_URL: Record<UnitModelSlot, string> = {
  hoplite: publicAssetUrl("models/units/hoplite.glb"),
  agent: publicAssetUrl("models/units/agent.glb"),
  archer: publicAssetUrl("models/units/archer.glb"),
  synthaur: publicAssetUrl("models/units/synthaur.glb"),
};

const templates: Record<UnitModelSlot, UnitPartTemplate[] | null> = {
  hoplite: null,
  agent: null,
  archer: null,
  synthaur: null,
};

let ensurePromise: Promise<void> | null = null;

function targetHeightForSlot(slot: UnitModelSlot): number {
  const rules =
    slot === "agent"
      ? getUnitRules(UnitType.VILLAGER)
      : slot === "archer"
        ? getUnitRules(UnitType.ARCHER)
        : slot === "synthaur"
          ? getUnitRules(UnitType.CENTAUR)
          : getUnitRules(UnitType.WARBAND);
  return GAME_RULES.UNIT_HEIGHT * rules.visualScale * 1.08;
}

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
    return applyStylizedShading(
      new THREE.MeshStandardMaterial({
        color: m.color,
        map: m.map,
        normalMap: m.normalMap,
        roughness: m.roughness,
        metalness: m.metalness,
        emissive: m.emissive,
        emissiveMap: m.emissiveMap,
      }),
    );
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

function extractTemplates(root: THREE.Group): UnitPartTemplate[] {
  const out: UnitPartTemplate[] = [];
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

async function loadSlot(slot: UnitModelSlot): Promise<void> {
  if (templates[slot] !== null) return;
  const url = GLB_URL[slot];
  const logTag = `[unit-model:${slot}]`;
  const loader = createGLTFLoader();
  try {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene as THREE.Group;
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    fitGroundCenterScaleY(root, targetHeightForSlot(slot));
    const parts = extractTemplates(root);
    if (parts.length === 0) {
      console.warn(`${logTag} "${url}" has no meshes — using placeholder.`);
      templates[slot] = [];
    } else {
      const remapParts = parts.filter((t) => t.baseMaterial.userData[TEAM_FACTION_TEX_MARK]).length;
      console.log(`${logTag} Loaded ${parts.length} mesh part(s) from ${url} (${remapParts} with faction texture remap)`);
      templates[slot] = parts;
    }
  } catch (e) {
    console.warn(`${logTag} Failed to load ${url}`, e);
    templates[slot] = [];
  }
}

/** Loads unit GLBs from `public/models/units/` (compressed from `models-source/units/`). */
export async function ensureUnitInstancedModelsLoaded(): Promise<void> {
  ensurePromise ??= Promise.all([
    loadSlot("hoplite"),
    loadSlot("agent"),
    loadSlot("archer"),
    loadSlot("synthaur"),
  ]).then(() => undefined);
  await ensurePromise;
}

export function createUnitInstancedMeshes(slot: UnitModelSlot, capacity: number): THREE.InstancedMesh[] {
  const t = templates[slot];
  if (!t || t.length === 0) return [];
  return t.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.baseMaterial.clone(), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}

export function createWarbandInstancedMeshes(capacity: number): THREE.InstancedMesh[] {
  return createUnitInstancedMeshes("hoplite", capacity);
}

export function createVillagerInstancedMeshes(capacity: number): THREE.InstancedMesh[] {
  return createUnitInstancedMeshes("agent", capacity);
}

export function hasUnitInstancedGlb(slot: UnitModelSlot): boolean {
  return templates[slot] !== null && templates[slot].length > 0;
}

export function hasWarbandInstancedGlb(): boolean {
  return hasUnitInstancedGlb("hoplite");
}

export function hasVillagerInstancedGlb(): boolean {
  return hasUnitInstancedGlb("agent");
}

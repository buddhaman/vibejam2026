import * as THREE from "three";
import { BuildingType, getBuildingRules, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { createProceduralBuildingSet, type BuildingSet, type BuildingVariant, type TintableMaterial } from "./building-visuals.js";
import { applyStylizedShading, isStylizedLitMaterial, stylizeObjectMaterials } from "./stylized-shading.js";

/**
 * Map each building type to a compressed GLB URL (`client/public/models/buildings/`, from `models-source/buildings/`).
 * Same URL can be reused for multiple types — the file is fetched and decoded only once.
 * Omit a type or leave a path unused to keep the procedural placeholder for that type.
 */
export const BUILDING_GLB_PATHS: Partial<Record<BuildingTypeValue, string>> = {
  [BuildingType.BARRACKS]: publicAssetUrl("models/buildings/armory.glb"),
  [BuildingType.TOWER]: publicAssetUrl("models/buildings/tower.glb"),
  [BuildingType.TOWN_CENTER]: publicAssetUrl("models/buildings/town_center.glb"),
};

/** One prototype per building type (never added to the scene; clone per `BuildingEntity`). */
let templateBuildingSet: BuildingSet | null = null;

function isTintable(m: THREE.Material): m is TintableMaterial {
  return m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial;
}

/**
 * Scale to gameplay height, sit on y=0, and put the world-space AABB center on x=0, z=0
 * so `mesh.position.set(tileX, …, tileZ)` places the building on the tile center.
 */
function fitGroundAndCenterXZ(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxY = Math.max(size.y, 1e-3);
  const s = targetHeight / maxY;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const center = box3.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
}

/**
 * `Object3D.clone(true)` keeps **material references** from the source — every building
 * would otherwise share one set of materials with the template and each other, so team
 * texture recolor would apply once globally.
 */
function deepCloneMeshMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const m = obj.material;
    if (Array.isArray(m)) {
      obj.material = m.map((mat) => {
        if (!mat || !("clone" in mat)) return mat!;
        const clone = (mat as THREE.Material).clone();
        return isStylizedLitMaterial(clone) ? applyStylizedShading(clone) : clone;
      });
    } else if (m && "clone" in m) {
      const clone = (m as THREE.Material).clone();
      obj.material = isStylizedLitMaterial(clone) ? applyStylizedShading(clone) : clone;
    }
  });
}

function classifyMaterials(root: THREE.Object3D): { tintMaterials: TintableMaterial[]; accentMaterials: TintableMaterial[] } {
  const tintMaterials: TintableMaterial[] = [];
  const accentMaterials: TintableMaterial[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!isTintable(m)) continue;
      const hay = `${obj.name} ${m.name}`.toLowerCase();
      const isAccent = hay.includes("accent") || hay.includes("trim") || hay.includes("detail");
      (isAccent ? accentMaterials : tintMaterials).push(m);
    }
  });

  if (tintMaterials.length === 0 && accentMaterials.length > 0) {
    return { tintMaterials: accentMaterials, accentMaterials: [] };
  }
  return { tintMaterials, accentMaterials };
}

function variantFromGltfScene(source: THREE.Object3D, buildingType: BuildingTypeValue): BuildingVariant {
  const root = source.clone(true) as THREE.Group;
  deepCloneMeshMaterials(root);
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  stylizeObjectMaterials(root);

  const rules = getBuildingRules(buildingType);
  fitGroundAndCenterXZ(root, rules.height);

  const { tintMaterials, accentMaterials } = classifyMaterials(root);
  return { root, tintMaterials, accentMaterials };
}

async function loadAllGltfOnce(): Promise<Partial<Record<BuildingTypeValue, BuildingVariant>>> {
  const paths = BUILDING_GLB_PATHS;
  const entries = (Object.keys(paths) as BuildingTypeValue[])
    .map((type) => ({ type, url: paths[type] }))
    .filter((e): e is { type: BuildingTypeValue; url: string } => typeof e.url === "string" && e.url.length > 0);

  const uniqueUrls = [...new Set(entries.map((e) => e.url))];
  const loader = createGLTFLoader();
  const urlToScene = new Map<string, THREE.Object3D>();

  await Promise.all(
    uniqueUrls.map(async (url) => {
      try {
        const gltf = await loader.loadAsync(url);
        urlToScene.set(url, gltf.scene);
      } catch (err) {
        console.warn(`[building-model] Could not load "${url}" — using procedural mesh for that type.`, err);
      }
    })
  );

  const out: Partial<Record<BuildingTypeValue, BuildingVariant>> = {};
  for (const { type, url } of entries) {
    const scene = urlToScene.get(url);
    if (!scene) continue;
    out[type] = variantFromGltfScene(scene, type);
  }
  return out;
}

function mergeTemplateSet(gltf: Partial<Record<BuildingTypeValue, BuildingVariant>>, procedural: BuildingSet): BuildingSet {
  return {
    [BuildingType.BARRACKS]: gltf[BuildingType.BARRACKS] ?? procedural[BuildingType.BARRACKS],
    [BuildingType.TOWER]: gltf[BuildingType.TOWER] ?? procedural[BuildingType.TOWER],
    [BuildingType.TOWN_CENTER]: gltf[BuildingType.TOWN_CENTER] ?? procedural[BuildingType.TOWN_CENTER],
    [BuildingType.ARCHERY_RANGE]: gltf[BuildingType.ARCHERY_RANGE] ?? procedural[BuildingType.ARCHERY_RANGE],
    [BuildingType.STABLE]: gltf[BuildingType.STABLE] ?? procedural[BuildingType.STABLE],
    [BuildingType.FARM]: gltf[BuildingType.FARM] ?? procedural[BuildingType.FARM],
  };
}

function cloneBuildingVariant(template: BuildingVariant): BuildingVariant {
  const root = template.root.clone(true) as THREE.Group;
  deepCloneMeshMaterials(root);
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  stylizeObjectMaterials(root);
  return { root, ...classifyMaterials(root) };
}

/** Independent copy for one on-screen building (geometry/materials duplicated per instance). */
export function instantiateBuildingSet(templates: BuildingSet): BuildingSet {
  return {
    [BuildingType.BARRACKS]: cloneBuildingVariant(templates[BuildingType.BARRACKS]),
    [BuildingType.TOWER]: cloneBuildingVariant(templates[BuildingType.TOWER]),
    [BuildingType.TOWN_CENTER]: cloneBuildingVariant(templates[BuildingType.TOWN_CENTER]),
    [BuildingType.ARCHERY_RANGE]: cloneBuildingVariant(templates[BuildingType.ARCHERY_RANGE]),
    [BuildingType.STABLE]: cloneBuildingVariant(templates[BuildingType.STABLE]),
    [BuildingType.FARM]: cloneBuildingVariant(templates[BuildingType.FARM]),
  };
}

/** Clone only the single variant needed for a given building type. Much cheaper than cloning all three. */
export function instantiateBuildingVariant(type: BuildingTypeValue): BuildingVariant {
  const templates = getBuildingVariantTemplates();
  return cloneBuildingVariant(templates[type]);
}

/**
 * Fetch each GLB URL once, build shared templates, merge with procedural fallbacks.
 * Call once before spawning entities (e.g. from `main.ts` after network sync).
 */
export async function ensureBuildingModelsLoaded(): Promise<void> {
  if (templateBuildingSet) return;
  const procedural = createProceduralBuildingSet();
  const gltf = await loadAllGltfOnce();
  templateBuildingSet = mergeTemplateSet(gltf, procedural);
}

/** Throws if `ensureBuildingModelsLoaded` has not completed. */
export function getBuildingVariantTemplates(): BuildingSet {
  if (!templateBuildingSet) {
    throw new Error("getBuildingVariantTemplates() called before ensureBuildingModelsLoaded()");
  }
  return templateBuildingSet;
}

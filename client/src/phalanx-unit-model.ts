import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GAME_RULES } from "../../shared/game-rules.js";

const PHALANX_GLB = "/models/buildings/phalanx.glb";

/**
 * Template / instanced materials: this part should get CPU albedo/emissive faction recolor
 * when the squad is first rendered (per-player textures).
 */
export const PHALANX_TEAM_TEXTURE_REMAP = "phalanxTeamTexRemap" as const;

/** After `applyPhalanxTeamTextureReplacements`, guards double processing. */
const PHALANX_TEAM_TEX_APPLIED = "phalanxTeamTexApplied" as const;

export type PhalanxPartTemplate = {
  geometry: THREE.BufferGeometry;
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
      emissive: m.emissive,
      emissiveMap: m.emissiveMap,
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

/** sRGB 0–1 samples from canvas `getImageData` (approx). */
function pixelIsFactionRed(r: number, g: number, b: number): boolean {
  return r > 0.22 && r - Math.max(g, b) > 0.07 && r > g * 1.08 && r > b * 1.1;
}

function pixelIsFactionBlue(r: number, g: number, b: number): boolean {
  return b > 0.2 && b - Math.max(r, g) > 0.06 && b > r * 1.08 && b > g * 1.05;
}

const _srgbOut: THREE.RGB = { r: 0, g: 0, b: 0 };

function writeSrgbBytes(hex: number, data: Uint8ClampedArray, i: number): void {
  const c = new THREE.Color(hex);
  c.getRGB(_srgbOut, THREE.SRGBColorSpace);
  data[i] = Math.round(_srgbOut.r * 255);
  data[i + 1] = Math.round(_srgbOut.g * 255);
  data[i + 2] = Math.round(_srgbOut.b * 255);
}

/**
 * Replace baked “enemy” albedo texels with team palette (no multiply — literal RGB swap).
 */
function replaceFactionPixels(imgData: ImageData, primaryHex: number, secondaryHex: number): number {
  const d = imgData.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 4) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const red = pixelIsFactionRed(r, g, b);
    const blue = pixelIsFactionBlue(r, g, b);
    if (!red && !blue) continue;
    const rs = r - Math.max(g, b);
    const bs = b - Math.max(r, g);
    let usePrimary = red;
    if (red && blue) usePrimary = rs >= bs;
    else if (blue) usePrimary = false;
    if (usePrimary) writeSrgbBytes(primaryHex, d, i);
    else writeSrgbBytes(secondaryHex, d, i);
    n++;
  }
  return n;
}

function getDrawableImageSize(image: unknown): { w: number; h: number } | null {
  if (
    image instanceof HTMLImageElement ||
    image instanceof HTMLCanvasElement ||
    image instanceof ImageBitmap ||
    (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas)
  ) {
    const w = image.width;
    const h = image.height;
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
}

/** Downsampled scan: any noticeable red / blue faction pixels in albedo? */
function albedoTextureHasFactionPixels(tex: THREE.Texture): boolean {
  const size = getDrawableImageSize(tex.image);
  if (!size) return false;
  const tw = size.w;
  const th = size.h;
  const maxSide = 96;
  const scale = Math.min(1, maxSide / Math.max(tw, th));
  const w = Math.max(2, Math.round(tw * scale));
  const h = Math.max(2, Math.round(th * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  try {
    ctx.drawImage(tex.image as CanvasImageSource, 0, 0, tw, th, 0, 0, w, h);
  } catch {
    return false;
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  let hits = 0;
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    opaque++;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    if (pixelIsFactionRed(r, g, b) || pixelIsFactionBlue(r, g, b)) hits++;
  }
  return opaque > 80 && hits / opaque > 0.004;
}

function cloneTextureWithFactionReplace(
  src: THREE.Texture,
  primaryHex: number,
  secondaryHex: number,
): THREE.Texture {
  const size = getDrawableImageSize(src.image);
  if (!size) return src.clone();

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src.clone();
  try {
    ctx.drawImage(src.image as CanvasImageSource, 0, 0, size.w, size.h);
  } catch {
    return src.clone();
  }
  const imgData = ctx.getImageData(0, 0, size.w, size.h);
  replaceFactionPixels(imgData, primaryHex, secondaryHex);
  ctx.putImageData(imgData, 0, 0);

  const tex = src.clone();
  tex.image = canvas;
  tex.needsUpdate = true;
  tex.colorSpace = src.colorSpace;
  return tex;
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
  const autoFromTex = hasMap && !skipScan && albedoTextureHasFactionPixels(std.map!);

  if (isRedFabricColor(std.emissive, loose)) std.emissive.setScalar(0);

  if (hasMap && (loose || isRedFabricColor(std.color, true) || autoFromTex)) {
    std.userData[PHALANX_TEAM_TEXTURE_REMAP] = true;
    std.color.setRGB(1, 1, 1);
  }
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
    markTeamTextureRemap(std, label);
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
      const remapParts = templates.filter((t) => t.baseMaterial.userData[PHALANX_TEAM_TEXTURE_REMAP]).length;
      console.log(
        `[phalanx-unit] Loaded ${templates.length} mesh part(s) from ${PHALANX_GLB} (${remapParts} with faction texture remap)`
      );
    }
  } catch (e) {
    console.warn(`[phalanx-unit] Failed to load ${PHALANX_GLB}`, e);
    templates = [];
  }
}

/** Geometries are shared; clone `baseMaterial` per squad. */
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

/** Second accent derived from the player’s primary hex (one palette slot in game state). */
export function phalanxSecondaryTeamHex(primaryHex: number): number {
  const c = new THREE.Color(primaryHex);
  c.offsetHSL(0.11, 0.08, 0.03);
  return c.getHex();
}

/**
 * One squad = one palette. Clones albedo/emissive maps and rewrites faction pixels (CPU).
 * Safe to call once per `BlobEntity` when `ownerId` is known.
 */
export function applyPhalanxTeamTextureReplacements(
  meshes: THREE.InstancedMesh[],
  primaryHex: number,
  secondaryHex: number,
): void {
  const sec = secondaryHex;
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.userData[PHALANX_TEAM_TEXTURE_REMAP]) continue;
    if (mat.userData[PHALANX_TEAM_TEX_APPLIED]) continue;

    if (mat.map) {
      mat.map = cloneTextureWithFactionReplace(mat.map, primaryHex, sec);
    }
    if (mat.emissiveMap) {
      mat.emissiveMap = cloneTextureWithFactionReplace(mat.emissiveMap, primaryHex, sec);
    }

    mat.userData[PHALANX_TEAM_TEX_APPLIED] = true;
  }
}

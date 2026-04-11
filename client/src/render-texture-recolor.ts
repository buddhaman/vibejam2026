import * as THREE from "three";

/**
 * CPU texture rewrite: strict bright red and cyan–blue marker texels → team hue; each texel keeps
 * its saturation & lightness. Never use `texture.clone()` then assign `.image` (clones share `source`).
 */

export const TEAM_TEX_RECOLOR_APPLIED = "teamTexRecolorApplied" as const;

/** Set on a material’s `userData` when its maps should get `applyTeamColorTexturesToMarkedMeshes`. */
export const TEAM_FACTION_TEX_MARK = "teamFactionTexRemap" as const;

export type TeamTextureRecolorOptions = {
  /**
   * When true (default), source-blue texels use the secondary accent hue.
   * When false, both faction red and faction blue map to `primaryHex` (typical for buildings).
   */
  blueChannelUsesSecondary?: boolean;
};

const _srgbOut: THREE.RGB = { r: 0, g: 0, b: 0 };
const _pix = /* @__PURE__ */ new THREE.Color();
const _hslPix = { h: 0, s: 0, l: 0 };
const _hslPri = { h: 0, s: 0, l: 0 };
const _hslSec = { h: 0, s: 0, l: 0 };

/** RGB 0–1 → HSL with h,s,l in [0,1] (same convention as `THREE.Color.getHSL`). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

/** ~±15° around pure red — excludes orange/gold/yellow. */
const RED_HUE_HALF_WIDTH = 0.042;

/** Cyan / electric blue through “true” blue (°167–~258). Catches light blue flames. */
const CYAN_BLUE_HUE_MIN = 0.465;
const BLUE_HUE_MAX = 0.715;

const MIN_GRAY_DELTA = 0.055;
const MIN_SAT_FOR_REMAP = 0.17;
const MIN_CHANNEL_FOR_REMAP = 0.1;

/**
 * Faction red: narrow cap around pure red, not orange/bronze/gold.
 */
export function pixelIsBrightFactionRed(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < MIN_CHANNEL_FOR_REMAP || max - min < MIN_GRAY_DELTA) return false;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < MIN_SAT_FOR_REMAP) return false;
  const inRedCap = h <= RED_HUE_HALF_WIDTH || h >= 1 - RED_HUE_HALF_WIDTH;
  if (!inRedCap) return false;
  if (l > 0.82 && r - Math.max(g, b) < 0.05) return false;
  return true;
}

/**
 * Cyan / blue band; stricter in very light areas so cold marble grays aren’t remapped.
 */
export function pixelIsBrightFactionBlue(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < MIN_CHANNEL_FOR_REMAP || max - min < MIN_GRAY_DELTA) return false;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < MIN_SAT_FOR_REMAP) return false;
  if (h < CYAN_BLUE_HUE_MIN || h > BLUE_HUE_MAX) return false;
  const bLead = b - Math.max(r, g);
  if (l > 0.78 && bLead < 0.052) return false;
  return true;
}

function writeHueRemapSrgb(
  r: number,
  g: number,
  b: number,
  targetHue01: number,
  data: Uint8ClampedArray,
  i: number,
): void {
  _pix.setRGB(r, g, b, THREE.SRGBColorSpace);
  _pix.getHSL(_hslPix, THREE.SRGBColorSpace);
  _pix.setHSL(targetHue01, _hslPix.s, _hslPix.l, THREE.SRGBColorSpace);
  _pix.getRGB(_srgbOut, THREE.SRGBColorSpace);
  data[i] = Math.round(THREE.MathUtils.clamp(_srgbOut.r, 0, 1) * 255);
  data[i + 1] = Math.round(THREE.MathUtils.clamp(_srgbOut.g, 0, 1) * 255);
  data[i + 2] = Math.round(THREE.MathUtils.clamp(_srgbOut.b, 0, 1) * 255);
}

/** @returns number of pixels rewritten */
export function replaceTeamColorPixelsInImageData(
  imgData: ImageData,
  primaryHex: number,
  secondaryHex: number,
  options?: TeamTextureRecolorOptions,
): number {
  const blueUsesSecondary = options?.blueChannelUsesSecondary !== false;

  const pri = new THREE.Color(primaryHex);
  const sec = new THREE.Color(secondaryHex);
  pri.getHSL(_hslPri, THREE.SRGBColorSpace);
  sec.getHSL(_hslSec, THREE.SRGBColorSpace);

  const d = imgData.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 4) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const isRed = pixelIsBrightFactionRed(r, g, b);
    const isBlue = pixelIsBrightFactionBlue(r, g, b);
    if (!isRed && !isBlue) continue;

    let targetH = _hslPri.h;
    if (isBlue && !isRed) {
      targetH = blueUsesSecondary ? _hslSec.h : _hslPri.h;
    } else if (isRed && !isBlue) {
      targetH = _hslPri.h;
    } else {
      const rs = r - Math.max(g, b);
      const bs = b - Math.max(r, g);
      if (bs > rs && blueUsesSecondary) targetH = _hslSec.h;
      else targetH = _hslPri.h;
    }

    writeHueRemapSrgb(r, g, b, targetH, d, i);
    n++;
  }
  return n;
}

export function getDrawableImageSize(image: unknown): { w: number; h: number } | null {
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

export function newTextureFromCanvasLike(src: THREE.Texture, canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.Texture(canvas);
  tex.name = src.name;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.magFilter = src.magFilter;
  tex.minFilter = src.minFilter;
  tex.anisotropy = src.anisotropy;
  tex.format = src.format;
  tex.type = src.type;
  tex.offset.copy(src.offset);
  tex.repeat.copy(src.repeat);
  tex.center.copy(src.center);
  tex.rotation = src.rotation;
  tex.matrixAutoUpdate = src.matrixAutoUpdate;
  tex.matrix.copy(src.matrix);
  tex.generateMipmaps = src.generateMipmaps;
  tex.premultiplyAlpha = src.premultiplyAlpha;
  tex.flipY = src.flipY;
  tex.unpackAlignment = src.unpackAlignment;
  tex.colorSpace = src.colorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function remapBrightFactionTexture(
  src: THREE.Texture,
  primaryHex: number,
  secondaryHex: number,
  options?: TeamTextureRecolorOptions,
): THREE.Texture {
  const size = getDrawableImageSize(src.image);
  if (!size) return src;

  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  try {
    ctx.drawImage(src.image as CanvasImageSource, 0, 0, size.w, size.h);
  } catch {
    return src;
  }
  const imgData = ctx.getImageData(0, 0, size.w, size.h);
  replaceTeamColorPixelsInImageData(imgData, primaryHex, secondaryHex, options);
  ctx.putImageData(imgData, 0, 0);

  return newTextureFromCanvasLike(src, canvas);
}

/** Fast scan for map-based heuristics (e.g. which meshes are “faction” tinted). */
export function textureLikelyHasBrightFactionColors(tex: THREE.Texture): boolean {
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
    if (pixelIsBrightFactionRed(r, g, b) || pixelIsBrightFactionBlue(r, g, b)) hits++;
  }
  return opaque > 80 && hits / opaque > 0.004;
}

export function secondaryTeamHexFromPrimary(primaryHex: number): number {
  const c = new THREE.Color(primaryHex);
  c.offsetHSL(0.11, 0.08, 0.03);
  return c.getHex();
}

export function isTintableTexturedMaterial(
  m: THREE.Material,
): m is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  return m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial;
}

export function applyTeamColorTexturesToMaterial(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  primaryHex: number,
  secondaryHex: number,
  options?: TeamTextureRecolorOptions,
): boolean {
  if (mat.userData[TEAM_TEX_RECOLOR_APPLIED]) return false;

  let changed = false;
  if (mat.map) {
    const next = remapBrightFactionTexture(mat.map, primaryHex, secondaryHex, options);
    if (next !== mat.map) {
      mat.map = next;
      changed = true;
    }
  }
  if (mat.emissiveMap) {
    const next = remapBrightFactionTexture(mat.emissiveMap, primaryHex, secondaryHex, options);
    if (next !== mat.emissiveMap) {
      mat.emissiveMap = next;
      changed = true;
    }
  }

  if (changed) mat.userData[TEAM_TEX_RECOLOR_APPLIED] = true;
  return changed;
}

export function applyTeamColorTexturesToObject3D(
  root: THREE.Object3D,
  primaryHex: number,
  secondaryHex: number,
  options?: TeamTextureRecolorOptions,
): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (isTintableTexturedMaterial(m)) {
        applyTeamColorTexturesToMaterial(m, primaryHex, secondaryHex, options);
      }
    }
  });
}

/**
 * Map/emissive hue remap on materials marked with `userData[TEAM_FACTION_TEX_MARK]`.
 * Defaults like buildings: strict red and strict blue texels both use `primaryHex` (blue does not
 * use the gold-shifted `secondaryHex`). Pass `{ blueChannelUsesSecondary: true }` for two-tone.
 */
export function applyTeamColorTexturesToMarkedMeshes(
  meshes: readonly THREE.Mesh[],
  primaryHex: number,
  secondaryHex: number,
  options?: TeamTextureRecolorOptions,
): void {
  const resolved: TeamTextureRecolorOptions = { blueChannelUsesSecondary: false, ...options };
  for (const mesh of meshes) {
    const raw = mesh.material;
    const mats = Array.isArray(raw) ? raw : [raw];
    for (const m of mats) {
      if (!isTintableTexturedMaterial(m)) continue;
      if (!m.userData[TEAM_FACTION_TEX_MARK]) continue;
      applyTeamColorTexturesToMaterial(m, primaryHex, secondaryHex, resolved);
    }
  }
}

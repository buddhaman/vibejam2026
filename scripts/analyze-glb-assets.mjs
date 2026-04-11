#!/usr/bin/env node
/**
 * Scans .glb files under client/public (default), e.g. models/buildings + models/units.
 * Parses the JSON chunk only — no extra npm deps.
 *
 * Reports:
 *   - File size on disk
 *   - Bytes referenced by `images[].bufferView` (embedded textures)
 *   - Rough "rest" = embedded buffer total − textures (mesh/animation/etc., approximate)
 *
 * Run: npm run analyze:glb
 *      ROOT=client/public/models node scripts/analyze-glb-assets.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || process.env.ROOT || path.join(process.cwd(), "client/public");

const JSON_CHUNK = 0x4e4f534a; // "JSON"

function walkGlbFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walkGlbFiles(p, out);
    else if (name.isFile() && p.toLowerCase().endsWith(".glb")) out.push(p);
  }
  return out;
}

function readGltfJsonFromGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 20) return { error: "too small", buf };
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) return { error: "not GLB", buf };
  let o = 12;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.readUInt32LE(o + 4);
    const start = o + 8;
    const end = start + len;
    if (end > buf.length) return { error: "truncated chunk", buf };
    if (type === JSON_CHUNK) {
      const raw = buf.subarray(start, end);
      try {
        return { json: JSON.parse(raw.toString("utf8")), buf };
      } catch {
        return { error: "invalid JSON chunk", buf };
      }
    }
    o = end;
  }
  return { error: "no JSON chunk", buf };
}

function dataUriBytes(uri) {
  if (!uri?.startsWith("data:")) return 0;
  const i = uri.indexOf(",");
  if (i < 0) return 0;
  const b64 = uri.slice(i + 1);
  try {
    return Buffer.byteLength(Buffer.from(b64, "base64"));
  } catch {
    return 0;
  }
}

function analyzeJson(json) {
  const bufferViews = json.bufferViews || [];
  const embeddedBufferTotal = (json.buffers || []).reduce((s, b) => {
    if (b.uri && b.uri.length > 0) return s;
    return s + (b.byteLength || 0);
  }, 0);

  const imageBvSeen = new Set();
  let textureBytes = 0;
  const byMime = new Map();

  for (const img of json.images || []) {
    if (typeof img.bufferView === "number") {
      if (imageBvSeen.has(img.bufferView)) continue;
      imageBvSeen.add(img.bufferView);
      const bv = bufferViews[img.bufferView];
      const n = bv?.byteLength || 0;
      textureBytes += n;
      const mime = img.mimeType || "unknown";
      byMime.set(mime, (byMime.get(mime) || 0) + n);
    } else {
      textureBytes += dataUriBytes(img.uri);
    }
  }

  const meshPrimitives = (json.meshes || []).reduce((n, m) => n + (m.primitives?.length || 0), 0);
  const hasDraco = !!(json.extensionsUsed || []).includes("KHR_draco_mesh_compression");
  const hasMeshopt = !!(json.extensionsUsed || []).includes("EXT_meshopt_compression");

  let restBytes = embeddedBufferTotal - textureBytes;
  if (restBytes < 0) restBytes = 0;

  return {
    embeddedBufferTotal,
    textureBytes,
    restBytes,
    byMime,
    meshPrimitives,
    accessors: (json.accessors || []).length,
    images: (json.images || []).length,
    hasDraco,
    hasMeshopt,
 };
}

function fmtMb(n) {
  return (n / (1024 * 1024)).toFixed(2);
}

function main() {
  const files = walkGlbFiles(path.resolve(ROOT)).sort();
  if (files.length === 0) {
    console.error(`No .glb files under ${ROOT}`);
    process.exit(1);
  }

  const rows = [];
  let grandFile = 0;
  let grandTex = 0;
  let grandRest = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file) || file;
    const disk = fs.statSync(file).size;
    const { json, error } = readGltfJsonFromGlb(file);
    if (error || !json) {
      rows.push({ rel, disk, error: error || "no json", textureBytes: 0, restBytes: 0 });
      grandFile += disk;
      continue;
    }
    const a = analyzeJson(json);
    rows.push({
      rel,
      disk,
      ...a,
      error: null,
    });
    grandFile += disk;
    grandTex += a.textureBytes;
    grandRest += a.restBytes;
  }

  rows.sort((a, b) => b.disk - a.disk);

  console.log(`\nGLB analysis — root: ${path.resolve(ROOT)}\n`);
  console.log(
    `${"MB (disk)".padStart(10)} ${"MB texture".padStart(10)} ${"% tex".padStart(7)} ${"compress?".padStart(10)}  file`,
  );
  console.log("-".repeat(92));

  for (const r of rows) {
    if (r.error) {
      console.log(`${fmtMb(r.disk).padStart(10)} ${"—".padStart(10)} ${"—".padStart(7)} ${"—".padStart(10)}  ${r.rel} (${r.error})`);
      continue;
    }
    const pct = r.disk > 0 ? ((r.textureBytes / r.disk) * 100).toFixed(0) : "0";
    const flags = [r.hasDraco ? "draco" : "", r.hasMeshopt ? "meshopt" : ""].filter(Boolean).join("+") || "—";
    console.log(
      `${fmtMb(r.disk).padStart(10)} ${fmtMb(r.textureBytes).padStart(10)} ${`${pct}%`.padStart(7)} ${flags.padStart(10)}  ${r.rel}`,
    );
  }

  console.log("-".repeat(92));
  const texPctAll = grandFile > 0 ? ((grandTex / grandFile) * 100).toFixed(0) : "0";
  console.log(
    `${fmtMb(grandFile).padStart(10)} ${fmtMb(grandTex).padStart(10)} ${`${texPctAll}%`.padStart(7)} ${"TOTAL".padStart(10)} (${files.length} files)`,
  );

  console.log(`
Notes:
  • "MB texture" column = embedded image bytes inside the GLB. High % tex => shrink/re-encode textures first.
  • "rest" is rough (embedded BIN minus those image views); big rest => mesh/animation data or compress mesh.
  • External image URIs are not counted (only in-glb bufferViews + data: URIs in JSON).

Suggested workflow (smallest effort → biggest payoff):
  1) Delete or stop shipping duplicate / unused .glb copies (check git + BUILDING_GLB_PATHS + unit URLs).
  2) In Blender (or your DCC): lower texture export resolution (e.g. 4K→1K/2K), merge materials where possible.
  3) Batch compress with gltf-transform (install once: npm i -D @gltf-transform/cli):
       npx gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp
     Or for KTX2: --texture-compress ktx2 (see gltf-transform docs).
  4) Point your code at the new files; the app already loads Draco + Meshopt if present.
`);
}

main();

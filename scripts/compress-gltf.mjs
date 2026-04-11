#!/usr/bin/env node
/**
 * Batch-compress GLBs from models-source → client/public (served assets).
 *
 * Layout:
 *   models-source/buildings/*.glb  →  client/public/models/buildings/
 *   models-source/units/*.glb      →  client/public/models/units/
 *
 * Usage:
 *   npm run models:compress
 *   npm run models:compress -- --force
 *   npm run models:compress:watch   (recompress when sources change)
 *
 * Env:
 *   GLTF_TEXTURE_SIZE — max texture edge (default: 1024)
 *   GLTF_FORCE=1 or --force — rebuild even if output is newer
 *
 * Git: track sources with Git LFS (see .gitattributes). Run once: git lfs install
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TEXTURE_SIZE = Number(process.env.GLTF_TEXTURE_SIZE || "1024") || 1024;
const FORCE = process.env.GLTF_FORCE === "1" || process.argv.includes("--force");
const WATCH = process.argv.includes("--watch");

/** @type {{ label: string; source: string; out: string }[]} */
const JOBS = [
  {
    label: "buildings",
    source: path.join(REPO_ROOT, "models-source/buildings"),
    out: path.join(REPO_ROOT, "client/public/models/buildings"),
  },
  {
    label: "units",
    source: path.join(REPO_ROOT, "models-source/units"),
    out: path.join(REPO_ROOT, "client/public/models/units"),
  },
];

function gltfTransformCli() {
  return path.join(REPO_ROOT, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
}

function listGlbs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".glb"))
    .map((f) => path.join(dir, f))
    .sort();
}

function fmtMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function runOptimize(input, output) {
  const cli = gltfTransformCli();
  if (!fs.existsSync(cli)) {
    console.error("Missing gltf-transform. Run: npm install");
    process.exit(1);
  }
  const args = [
    cli,
    "optimize",
    input,
    output,
    "--compress",
    "meshopt",
    "--texture-compress",
    "webp",
    "--texture-size",
    String(TEXTURE_SIZE),
  ];
  const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: REPO_ROOT });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

/**
 * @returns {{ name: string; before: number; after: number; skipped: boolean }[]}
 */
function compressJob(job) {
  const inputs = listGlbs(job.source);
  const rows = [];
  if (inputs.length === 0) {
    console.log(`[${job.label}] no .glb in ${path.relative(REPO_ROOT, job.source)} — skip`);
    return rows;
  }

  fs.mkdirSync(job.out, { recursive: true });

  console.log(`\n── ${job.label} ──`);
  console.log(`  source: ${path.relative(REPO_ROOT, job.source)}`);
  console.log(`  output: ${path.relative(REPO_ROOT, job.out)}`);

  for (const input of inputs) {
    const name = path.basename(input);
    const output = path.join(job.out, name);
    const before = fs.statSync(input).size;

    if (
      !FORCE &&
      fs.existsSync(output) &&
      fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs
    ) {
      const after = fs.statSync(output).size;
      rows.push({ name: `${job.label}/${name}`, before, after, skipped: true });
      continue;
    }

    runOptimize(input, output);
    const after = fs.statSync(output).size;
    rows.push({ name: `${job.label}/${name}`, before, after, skipped: false });
  }

  return rows;
}

function printReport(allRows) {
  if (allRows.length === 0) {
    console.log("\nNo GLB sources found under models-source/{buildings,units}/.");
    console.log("Add originals there, then run again (see repo .gitattributes for Git LFS).\n");
    return;
  }

  console.log(`\n${"═".repeat(88)}`);
  console.log("Compression report (source → compressed)");
  console.log(`${"file".padEnd(42)} ${"before MB".padStart(10)} ${"after MB".padStart(10)} ${"saved".padStart(8)}`);
  console.log("-".repeat(88));

  let sumBefore = 0;
  let sumAfter = 0;

  for (const r of allRows) {
    sumBefore += r.before;
    sumAfter += r.after;
    const tag = r.skipped ? "(cached)" : "";
    const pct = r.before > 0 ? (((r.before - r.after) / r.before) * 100).toFixed(0) : "0";
    console.log(
      `${(r.name + tag).slice(0, 42).padEnd(42)} ${fmtMb(r.before).padStart(10)} ${fmtMb(r.after).padStart(10)} ${(`${pct}%`).padStart(8)}`,
    );
  }

  console.log("-".repeat(88));
  const pctAll = sumBefore > 0 ? (((sumBefore - sumAfter) / sumBefore) * 100).toFixed(0) : "0";
  console.log(
    `${"TOTAL".padEnd(42)} ${fmtMb(sumBefore).padStart(10)} ${fmtMb(sumAfter).padStart(10)} ${(`${pctAll}%`).padStart(8)}`,
  );
  console.log(`${"═".repeat(88)}\n`);
}

function runAll() {
  if (!fs.existsSync(gltfTransformCli())) {
    console.error("Missing gltf-transform. Run: npm install");
    process.exit(1);
  }

  console.log(`gltf-transform | texture max ${TEXTURE_SIZE}px | meshopt + webp | force=${FORCE}`);

  const allRows = [];
  for (const job of JOBS) {
    allRows.push(...compressJob(job));
  }

  printReport(allRows);
}

async function runWatch() {
  let timer = null;
  const debounceMs = 600;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`\n[watch] sources changed — compressing… (${new Date().toISOString()})`);
      try {
        runAll();
      } catch (e) {
        console.error(e);
      }
    }, debounceMs);
  };

  let watch;
  try {
    const mod = await import("chokidar");
    watch = mod.watch ?? mod.default?.watch;
  } catch {
    console.error("Watch mode needs chokidar. Run: npm install");
    process.exit(1);
  }
  if (typeof watch !== "function") {
    console.error("chokidar.watch not found");
    process.exit(1);
  }

  const paths = JOBS.map((j) => j.source);
  for (const p of paths) {
    fs.mkdirSync(p, { recursive: true });
  }

  console.log("Watching for new/changed .glb in:");
  for (const p of paths) {
    console.log(`  ${path.relative(REPO_ROOT, p)}`);
  }
  console.log("(Ctrl+C to stop)\n");

  runAll();

  watch(paths, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 400 } })
    .on("add", schedule)
    .on("change", schedule)
    .on("unlink", schedule);
}

if (WATCH) {
  runWatch().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  runAll();
}

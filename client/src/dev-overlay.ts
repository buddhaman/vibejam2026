import type * as THREE from "three";
import type { NetworkPerfSnapshot } from "./network-perf.js";

export type DevOverlayStats = {
  fps: number;
  ms: number;
  totalWorkMs: number;
  idleBudgetMs: number;
  syncMs: number;
  tileVisualsMs: number;
  entityRenderMs: number;
  beamFlushMs: number;
  sceneRenderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  entities: number;
  beamBuckets: number;
};

function line(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, valueColor = "#f3ead7") {
  ctx.fillStyle = "#7bbbd4";
  ctx.fillText(label, x, y);
  ctx.fillStyle = valueColor;
  ctx.fillText(value, x + 134, y);
}

export function drawDevOverlay(
  ctx: CanvasRenderingContext2D,
  renderer: THREE.WebGLRenderer,
  stats: DevOverlayStats,
  net: NetworkPerfSnapshot,
  opts: { tileDebug: boolean; walkability: boolean }
) {
  const x = 16;
  const y = 16;
  const w = 430;
  const pad = 14;
  const lh = 18;
  const sections = [
    { label: "FPS", value: `${stats.fps.toFixed(0)}  (${stats.ms.toFixed(2)} ms)`, color: "#6ff0a4" },
    { label: "frame work", value: `${stats.totalWorkMs.toFixed(2)} ms`, color: "#f3ead7" },
    { label: "frame slack", value: `${stats.idleBudgetMs.toFixed(2)} ms`, color: stats.idleBudgetMs >= 0 ? "#6ff0a4" : "#ff9a8a" },
    { label: "sync()", value: `${stats.syncMs.toFixed(2)} ms`, color: "#f3ead7" },
    { label: "tileVisuals", value: `${stats.tileVisualsMs.toFixed(2)} ms`, color: "#f3ead7" },
    { label: "entity render", value: `${stats.entityRenderMs.toFixed(2)} ms`, color: "#f3ead7" },
    { label: "beam flush", value: `${stats.beamFlushMs.toFixed(2)} ms`, color: "#f3ead7" },
    { label: "renderer.render", value: `${stats.sceneRenderMs.toFixed(2)} ms`, color: "#f3ead7" },
    null,
    { label: "draw calls", value: `${stats.drawCalls}`, color: "#f3ead7" },
    { label: "triangles", value: `${stats.triangles}`, color: "#f3ead7" },
    { label: "geometries", value: `${stats.geometries}`, color: "#f3ead7" },
    { label: "textures", value: `${stats.textures}`, color: "#f3ead7" },
    { label: "programs", value: `${stats.programs}`, color: "#f3ead7" },
    { label: "entities", value: `${stats.entities}`, color: "#f3ead7" },
    { label: "beam buckets", value: `${stats.beamBuckets}`, color: "#f3ead7" },
    null,
    { label: "down", value: `${net.downKbps.toFixed(1)} KB/s`, color: "#f3ead7" },
    { label: "up", value: `${net.upKbps.toFixed(1)} KB/s`, color: "#f3ead7" },
    { label: "RTT", value: `${net.rttMs != null ? `${net.rttMs} ms` : "—"}`, color: "#f3ead7" },
    { label: "state cb/s", value: `${net.stateCallbacksPerSec.toFixed(0)}`, color: "#f3ead7" },
    { label: "patch/full", value: `${net.patchPerSec.toFixed(0)} / ${net.fullStatePerSec.toFixed(0)}`, color: "#f3ead7" },
    { label: "roomData/s", value: `${net.roomDataPerSec.toFixed(1)}`, color: "#f3ead7" },
    { label: "world", value: `b:${net.blobs}  bld:${net.buildings}  p:${net.players}`, color: "#f3ead7" },
  ] as const;
  const footerLines = 3;
  const spacerCount = sections.filter((entry) => entry === null).length;
  const contentLines = sections.length - spacerCount + footerLines;
  const h = 58 + contentLines * lh + spacerCount * 6 + 14;

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#0b1a2e";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();

  ctx.fillStyle = "#1a3a5c";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 30, 10);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.font = "bold 12px monospace";
  ctx.fillStyle = "#7de8ff";
  ctx.fillText("DEVELOPER MODE", x + pad, y + 20);
  ctx.font = "12px monospace";

  let row = y + 48;
  for (const entry of sections) {
    if (entry === null) {
      row += 6;
      continue;
    }
    line(ctx, entry.label, entry.value, x + pad, row, entry.color);
    row += lh;
  }
  row += 8;

  ctx.fillStyle = "#8aaccc";
  ctx.fillText(`walkability overlay: ${opts.walkability ? "on" : "off"}   tile inspect: ${opts.tileDebug ? "on" : "off"}`, x + pad, row);
  row += lh;
  ctx.fillText(`top in: ${net.topIn}`, x + pad, row);
  row += lh;
  ctx.fillText(`top out: ${net.topOut}`, x + pad, row);
  ctx.restore();
}

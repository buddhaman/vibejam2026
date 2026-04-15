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
  const rows = 23;
  const h = 48 + rows * lh + 18;

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
  line(ctx, "FPS", `${stats.fps.toFixed(0)}  (${stats.ms.toFixed(2)} ms)`, x + pad, row, "#6ff0a4"); row += lh;
  line(ctx, "frame work", `${stats.totalWorkMs.toFixed(2)} ms`, x + pad, row); row += lh;
  line(ctx, "frame slack", `${stats.idleBudgetMs.toFixed(2)} ms`, x + pad, row, stats.idleBudgetMs >= 0 ? "#6ff0a4" : "#ff9a8a"); row += lh;
  line(ctx, "sync()", `${stats.syncMs.toFixed(2)} ms`, x + pad, row); row += lh;
  line(ctx, "tileVisuals", `${stats.tileVisualsMs.toFixed(2)} ms`, x + pad, row); row += lh;
  line(ctx, "entity render", `${stats.entityRenderMs.toFixed(2)} ms`, x + pad, row); row += lh;
  line(ctx, "beam flush", `${stats.beamFlushMs.toFixed(2)} ms`, x + pad, row); row += lh;
  line(ctx, "renderer.render", `${stats.sceneRenderMs.toFixed(2)} ms`, x + pad, row); row += lh + 6;

  const info = renderer.info;
  line(ctx, "draw calls", `${stats.drawCalls}`, x + pad, row); row += lh;
  line(ctx, "triangles", `${stats.triangles}`, x + pad, row); row += lh;
  line(ctx, "geometries", `${stats.geometries}`, x + pad, row); row += lh;
  line(ctx, "textures", `${stats.textures}`, x + pad, row); row += lh;
  line(ctx, "programs", `${stats.programs}`, x + pad, row); row += lh;
  line(ctx, "entities", `${stats.entities}`, x + pad, row); row += lh;
  line(ctx, "beam buckets", `${stats.beamBuckets}`, x + pad, row); row += lh + 6;

  line(ctx, "down", `${net.downKbps.toFixed(1)} KB/s`, x + pad, row); row += lh;
  line(ctx, "up", `${net.upKbps.toFixed(1)} KB/s`, x + pad, row); row += lh;
  line(ctx, "RTT", `${net.rttMs != null ? `${net.rttMs} ms` : "—"}`, x + pad, row); row += lh;
  line(ctx, "state cb/s", `${net.stateCallbacksPerSec.toFixed(0)}`, x + pad, row); row += lh;
  line(ctx, "patch/full", `${net.patchPerSec.toFixed(0)} / ${net.fullStatePerSec.toFixed(0)}`, x + pad, row); row += lh;
  line(ctx, "roomData/s", `${net.roomDataPerSec.toFixed(1)}`, x + pad, row); row += lh;
  line(ctx, "world", `b:${net.blobs}  bld:${net.buildings}  p:${net.players}`, x + pad, row); row += lh + 8;

  ctx.fillStyle = "#8aaccc";
  ctx.fillText(`walkability overlay: ${opts.walkability ? "on" : "off"}   tile inspect: ${opts.tileDebug ? "on" : "off"}`, x + pad, row);
  row += lh;
  ctx.fillText(`top in: ${net.topIn}`, x + pad, row);
  row += lh;
  ctx.fillText(`top out: ${net.topOut}`, x + pad, row);
  ctx.restore();
}

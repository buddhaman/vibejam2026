import * as THREE from "three";
import { GAME_RULES, getTileCenter } from "../../shared/game-rules.js";
import { getTerrainHeightAt, type TileView } from "./terrain.js";

const TILE = GAME_RULES.TILE_SIZE;
const Y_FILL = 0.10;
const Y_HIGHLIGHT = 0.14;
const Y_GRID = 0.06;

const COL_WALK_BUILD   = new THREE.Color(0x44ee77); // green  — walkable + buildable
const COL_WALK_NOBUILD = new THREE.Color(0xffdd22); // yellow — walkable, no build
const COL_BLOCKED      = new THREE.Color(0xff3333); // red    — not walkable
const COL_MOUNTAIN     = new THREE.Color(0x8899bb); // blue-gray — mountain

/** All Three.js objects for the tile debug overlay. Lives in its own Group. */
export class TileDebugOverlay {
  readonly root: THREE.Group;

  private fillMesh: THREE.InstancedMesh;
  private highlightMesh: THREE.Mesh;
  private gridLines: THREE.LineSegments;
  private dummy = new THREE.Object3D();

  private _visible = false;
  private _inspectedKey: string | null = null;

  constructor(tiles: TileView[], tileMap: Map<string, TileView>) {
    this.root = new THREE.Group();
    this.root.visible = false;

    // ── instanced fill quads ──────────────────────────────────────────────
    const fillGeo = new THREE.PlaneGeometry(TILE * 0.95, TILE * 0.95);
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.fillMesh = new THREE.InstancedMesh(fillGeo, fillMat, Math.max(1, tiles.length));
    this.fillMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fillMesh.frustumCulled = false;

    // ── selected tile highlight ──────────────────────────────────────────
    const hlGeo = new THREE.PlaneGeometry(TILE * 0.95, TILE * 0.95);
    this.highlightMesh = new THREE.Mesh(
      hlGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.60,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.highlightMesh.visible = false;
    this.highlightMesh.frustumCulled = false;

    // ── grid lines ───────────────────────────────────────────────────────
    const positions: number[] = [];
    for (const tile of tiles) {
      const c = getTileCenter(tile.tx, tile.tz);
      const h = getTerrainHeightAt(c.x, c.z, tileMap) + Y_GRID;
      const x0 = c.x - TILE / 2, x1 = c.x + TILE / 2;
      const z0 = c.z - TILE / 2, z1 = c.z + TILE / 2;
      positions.push(x0, h, z0,  x1, h, z0);
      positions.push(x1, h, z0,  x1, h, z1);
      positions.push(x1, h, z1,  x0, h, z1);
      positions.push(x0, h, z1,  x0, h, z0);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.gridLines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.28, transparent: true })
    );
    this.gridLines.frustumCulled = false;

    this.root.add(this.fillMesh, this.highlightMesh, this.gridLines);
    this._syncFill(tiles, tileMap);
  }

  // ── public API ────────────────────────────────────────────────────────

  get visible() { return this._visible; }

  toggle(tiles: TileView[], tileMap: Map<string, TileView>) {
    this._visible = !this._visible;
    this.root.visible = this._visible;
    if (this._visible) this._syncFill(tiles, tileMap);
    if (!this._visible) this.clearInspect();
  }

  /** Call when tile walkability/buildability changes. */
  refresh(tiles: TileView[], tileMap: Map<string, TileView>) {
    if (this._visible) this._syncFill(tiles, tileMap);
  }

  inspectTile(tile: TileView | null, tileMap: Map<string, TileView>) {
    this._inspectedKey = tile?.key ?? null;
    if (!tile) {
      this.highlightMesh.visible = false;
      return;
    }
    const c = getTileCenter(tile.tx, tile.tz);
    const h = getTerrainHeightAt(c.x, c.z, tileMap) + Y_HIGHLIGHT;
    this.highlightMesh.position.set(c.x, h, c.z);
    this.highlightMesh.rotation.set(-Math.PI / 2, 0, 0);
    this.highlightMesh.visible = true;
  }

  clearInspect() {
    this._inspectedKey = null;
    this.highlightMesh.visible = false;
  }

  get inspectedKey() { return this._inspectedKey; }

  // ── private ────────────────────────────────────────────────────────────

  private _syncFill(tiles: TileView[], tileMap: Map<string, TileView>) {
    let i = 0;
    for (const tile of tiles) {
      const c = getTileCenter(tile.tx, tile.tz);
      const h = getTerrainHeightAt(c.x, c.z, tileMap) + Y_FILL;
      this.dummy.position.set(c.x, h, c.z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.fillMesh.setMatrixAt(i, this.dummy.matrix);

      const col = tile.isMountain
        ? COL_MOUNTAIN
        : !tile.canWalk
          ? COL_BLOCKED
          : !tile.canBuild
            ? COL_WALK_NOBUILD
            : COL_WALK_BUILD;
      this.fillMesh.setColorAt(i, col);
      i++;
    }
    this.fillMesh.count = i;
    this.fillMesh.instanceMatrix.needsUpdate = true;
    if (this.fillMesh.instanceColor) this.fillMesh.instanceColor.needsUpdate = true;
  }
}

// ── Canvas 2D info panel ─────────────────────────────────────────────────────

const PANEL_W = 280;
const PANEL_H = 260;
const PAD = 14;
const LINE_H = 19;

function tag(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, valueColor = "#e8f4ff") {
  ctx.fillStyle = "#7bbbd4";
  ctx.fillText(label, x, y);
  ctx.fillStyle = valueColor;
  ctx.fillText(value, x + 108, y);
}

export function drawTileDebugPanel(
  ctx: CanvasRenderingContext2D,
  tile: TileView,
  canvasW: number,
  canvasH: number
) {
  const x = 16;
  const y = canvasH - PANEL_H - 16;

  // backdrop
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#0b1a2e";
  roundRect(ctx, x, y, PANEL_W, PANEL_H, 8);
  ctx.fill();
  ctx.globalAlpha = 1;

  // header bar
  ctx.fillStyle = "#1a3a5c";
  roundRect(ctx, x, y, PANEL_W, 30, { tl: 8, tr: 8, br: 0, bl: 0 });
  ctx.fill();

  ctx.font = "bold 12px monospace";
  ctx.fillStyle = "#7de8ff";
  ctx.fillText(`TILE DEBUG  [${tile.tx}, ${tile.tz}]`, x + PAD, y + 20);

  ctx.font = "12px monospace";
  let row = y + 46;

  const walkColor  = tile.canWalk  ? "#44ee77" : "#ff5555";
  const buildColor = tile.canBuild ? "#44ee77" : "#ff5555";
  const mountColor = tile.isMountain ? "#8899bb" : "#44ee77";

  tag(ctx, "canWalk",   tile.canWalk  ? "yes" : "no",  x + PAD, row, walkColor);  row += LINE_H;
  tag(ctx, "canBuild",  tile.canBuild ? "yes" : "no",  x + PAD, row, buildColor); row += LINE_H;
  tag(ctx, "isMountain",tile.isMountain ? "yes" : "no",x + PAD, row, mountColor); row += LINE_H;
  tag(ctx, "tileType",  String(tile.tileType),          x + PAD, row); row += LINE_H;
  tag(ctx, "height",    tile.height.toFixed(2),          x + PAD, row); row += LINE_H;
  tag(ctx, "h corners", `${tile.h00.toFixed(1)} ${tile.h10.toFixed(1)} ${tile.h11.toFixed(1)} ${tile.h01.toFixed(1)}`, x + PAD, row); row += LINE_H;
  tag(ctx, "material",  `${tile.material} / ${tile.maxMaterial}`,  x + PAD, row); row += LINE_H;
  tag(ctx, "compute",   `${tile.compute} / ${tile.maxCompute}`,    x + PAD, row); row += LINE_H;
  tag(ctx, "trees",     String(tile.treeSlots?.length ?? 0),        x + PAD, row); row += LINE_H;

  // legend
  row += 4;
  const entries: [string, string][] = [
    ["#44ee77", "walk+build"], ["#ffdd22", "walk only"],
    ["#ff3333", "blocked"],    ["#8899bb", "mountain"],
  ];
  let lx = x + PAD;
  ctx.font = "10px monospace";
  for (const [color, label] of entries) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, row - 9, 10, 10);
    ctx.fillStyle = "#8aaccc";
    ctx.fillText(label, lx + 13, row);
    lx += 66;
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number }
) {
  const tl = typeof r === "number" ? r : r.tl;
  const tr = typeof r === "number" ? r : r.tr;
  const br = typeof r === "number" ? r : r.br;
  const bl = typeof r === "number" ? r : r.bl;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

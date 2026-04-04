/**
 * 2D canvas HUD — drawn over the Three.js canvas each frame.
 * pointer-events: none so clicks fall through to the 3D layer.
 * All hit-testing is done manually in render.ts.
 */

import { BuildingType } from "../../shared/game-rules.js";

type Rect = { x: number; y: number; w: number; h: number };

const BUILD_ITEMS = [
  { label: "Barracks", icon: "⚔", type: BuildingType.BARRACKS },
  { label: "Tower",    icon: "🗼", type: BuildingType.TOWER },
] as const;

/** Numeric building type returned by hitTestMenu when a build item is clicked. */
export type BuildAction = (typeof BUILD_ITEMS)[number]["type"];

export type SelectedBlobInfo = {
  unitCount: number;
  health: number;
  maxHealth: number;
  color: number;
};

export type HudState = {
  buildMenu: {
    visible: boolean;
    screenX: number;
    screenY: number;
    worldX: number;
    worldZ: number;
  };
};

export function createHudState(): HudState {
  return { buildMenu: { visible: false, screenX: 0, screenY: 0, worldX: 0, worldZ: 0 } };
}

export function createHudCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10;";
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  document.body.appendChild(c);
  window.addEventListener("resize", () => {
    c.width = window.innerWidth;
    c.height = window.innerHeight;
  });
  return c;
}

// ─── layout constants ──────────────────────────────────────────────────────────

const BAR_H = 50;
const CARD_W = 200;
const CARD_H = 76;
const CARD_PAD = 10;
const CLOSE_SIZE = 20;

function selectionCardRect(W: number, H: number) {
  const x = CARD_PAD;
  const y = H - BAR_H - CARD_H - 8;
  return { x, y, w: CARD_W, h: CARD_H } as Rect;
}

function closeBtnRect(W: number, H: number): Rect {
  const card = selectionCardRect(W, H);
  return {
    x: card.x + card.w - CLOSE_SIZE - 6,
    y: card.y + 6,
    w: CLOSE_SIZE,
    h: CLOSE_SIZE,
  };
}

function menuLayout(sx: number, sy: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ITEM_W = 96, ITEM_H = 74, PAD = 12, GAP = 8;
  const TITLE_H = 30;
  const count = BUILD_ITEMS.length;
  const menuW = PAD * 2 + count * ITEM_W + (count - 1) * GAP;
  const menuH = TITLE_H + ITEM_H + PAD;

  let mx = sx - menuW / 2;
  let my = sy - menuH - 18;
  mx = Math.max(8, Math.min(W - menuW - 8, mx));
  my = Math.max(8, Math.min(H - menuH - 8, my));

  const items = BUILD_ITEMS.map((item, i) => ({
    ...item,
    rect: {
      x: mx + PAD + i * (ITEM_W + GAP),
      y: my + TITLE_H,
      w: ITEM_W,
      h: ITEM_H,
    } as Rect,
  }));

  return {
    panel: { x: mx, y: my, w: menuW, h: menuH } as Rect,
    items,
    anchor: { x: sx, y: sy },
  };
}

// ─── hit-testing ──────────────────────────────────────────────────────────────

function inRect(px: number, py: number, r: Rect) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Returns true if the click landed on the deselect × button. */
export function hitTestDeselect(x: number, y: number, selected: boolean): boolean {
  if (!selected) return false;
  return inRect(x, y, closeBtnRect(window.innerWidth, window.innerHeight));
}

/** Returns a numeric BuildingType, "dismiss", or null if the menu wasn't hit. */
export function hitTestMenu(
  hud: HudState,
  x: number,
  y: number
): BuildAction | "dismiss" | null {
  if (!hud.buildMenu.visible) return null;
  const { panel, items } = menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY);
  for (const item of items) {
    if (inRect(x, y, item.rect)) return item.type;
  }
  if (inRect(x, y, panel)) return "dismiss";
  return null;
}

// ─── drawing ──────────────────────────────────────────────────────────────────

export function drawHUD(
  canvas: HTMLCanvasElement,
  hud: HudState,
  myColor: number,
  myBlobCount: number,
  selected: SelectedBlobInfo | null,
  t: number
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawBottomBar(ctx, W, H, myColor, myBlobCount, selected !== null);

  if (selected !== null) {
    drawSelectionCard(ctx, W, H, selected);
  }

  if (hud.buildMenu.visible) {
    const layout = menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY);
    drawBuildMenu(ctx, layout, t);
  }
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: number,
  count: number,
  hasSelection: boolean
) {
  const top = H - BAR_H;

  ctx.fillStyle = "rgba(8,12,22,0.78)";
  ctx.fillRect(0, top, W, BAR_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(W, top);
  ctx.stroke();

  const mid = top + BAR_H / 2;

  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  ctx.save();
  ctx.beginPath();
  ctx.arc(22, mid, 9, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = "bold 13px system-ui,sans-serif";
  ctx.fillStyle = "#dde4f0";
  ctx.textBaseline = "middle";
  ctx.fillText(`${count} blob${count !== 1 ? "s" : ""}`, 40, mid);
  ctx.restore();

  ctx.save();
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillStyle = "rgba(180,200,230,0.38)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(
    hasSelection
      ? "click ground → move  ·  double-click ground → build"
      : "click blob → select  ·  double-click ground → build  ·  drag → pan  ·  scroll → zoom",
    W - 14,
    mid
  );
  ctx.restore();
}

function drawSelectionCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  info: SelectedBlobInfo
) {
  const card = selectionCardRect(W, H);
  const close = closeBtnRect(W, H);

  // card background
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(10,16,32,0.92)";
  rr(ctx, card.x, card.y, card.w, card.h, 10);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  rr(ctx, card.x, card.y, card.w, card.h, 10);
  ctx.stroke();
  ctx.restore();

  // "SELECTED" label
  ctx.save();
  ctx.font = "9px system-ui,sans-serif";
  ctx.fillStyle = "rgba(120,160,220,0.5)";
  ctx.textBaseline = "top";
  ctx.fillText("S E L E C T E D", card.x + 10, card.y + 8);
  ctx.restore();

  // color dot
  const dotX = card.x + 14;
  const dotY = card.y + 32;
  const cr = (info.color >> 16) & 0xff;
  const cg = (info.color >> 8) & 0xff;
  const cb = info.color & 0xff;
  ctx.save();
  ctx.beginPath();
  ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // unit count
  ctx.save();
  ctx.font = "bold 14px system-ui,sans-serif";
  ctx.fillStyle = "#dde4f0";
  ctx.textBaseline = "middle";
  ctx.fillText(`${info.unitCount} units`, dotX + 14, dotY);
  ctx.restore();

  // health bar
  const barX = card.x + 10;
  const barY = card.y + CARD_H - 18;
  const barW = card.w - 20;
  const barH2 = 6;
  const pct = Math.max(0, Math.min(1, info.health / info.maxHealth));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  rr(ctx, barX, barY, barW, barH2, 3);
  ctx.fill();

  const hue = pct > 0.5 ? 120 : pct > 0.25 ? 50 : 0;
  ctx.fillStyle = `hsl(${hue},70%,48%)`;
  rr(ctx, barX, barY, barW * pct, barH2, 3);
  ctx.fill();
  ctx.restore();

  // × close button
  ctx.save();
  ctx.fillStyle = "rgba(255,80,80,0.15)";
  rr(ctx, close.x, close.y, close.w, close.h, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,100,100,0.5)";
  ctx.lineWidth = 1;
  rr(ctx, close.x, close.y, close.w, close.h, 5);
  ctx.stroke();

  const cx = close.x + close.w / 2;
  const cy = close.y + close.h / 2;
  const arm = 4.5;
  ctx.strokeStyle = "rgba(255,160,160,0.9)";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy - arm); ctx.lineTo(cx + arm, cy + arm);
  ctx.moveTo(cx + arm, cy - arm); ctx.lineTo(cx - arm, cy + arm);
  ctx.stroke();
  ctx.restore();
}

function drawBuildMenu(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof menuLayout>,
  t: number
) {
  const { panel, items, anchor } = layout;

  ctx.save();
  ctx.strokeStyle = "rgba(90,150,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(panel.x + panel.w / 2, panel.y + panel.h);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(12,18,34,0.95)";
  rr(ctx, panel.x, panel.y, panel.w, panel.h, 10);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  rr(ctx, panel.x, panel.y, panel.w, panel.h, 10);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(150,180,230,0.55)";
  ctx.font = "10px system-ui,sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("B U I L D", panel.x + panel.w / 2, panel.y + 15);
  ctx.restore();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { rect } = item;
    const glowA = 0.38 + 0.22 * Math.sin(t * 2.4 + i * 1.3);
    const pulse = 1 + 0.05 * Math.sin(t * 3.6 + i * 0.8);

    ctx.save();
    ctx.fillStyle = "rgba(22,38,72,0.9)";
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = `rgba(80,140,255,${glowA})`;
    ctx.lineWidth = 1.5;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 7);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = `${22 * pulse}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.icon, rect.x + rect.w / 2, rect.y + rect.h * 0.42);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#b8ccf8";
    ctx.font = "bold 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(item.label, rect.x + rect.w / 2, rect.y + rect.h - 6);
    ctx.restore();
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

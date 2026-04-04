/**
 * 2D canvas HUD — drawn over the Three.js canvas each frame.
 * pointer-events: none so clicks fall through to the 3D layer.
 * All hit-testing is done manually in render.ts.
 */

import { BuildingType } from "../../shared/game-rules.js";
import type { SelectionInfo } from "./entity.js";

type Rect = { x: number; y: number; w: number; h: number };

const BUILD_ITEMS = [
  { label: "Barracks", icon: "⚔", type: BuildingType.BARRACKS },
  { label: "Tower", icon: "🗼", type: BuildingType.TOWER },
] as const;

export type BuildAction = (typeof BUILD_ITEMS)[number]["type"];

export type HudState = {
  buildMenu: {
    visible: boolean;
    screenX: number;
    screenY: number;
    worldX: number;
    worldZ: number;
  };
};

const BAR_H = 50;
const CARD_W = 220;
const CARD_H = 98;
const CARD_PAD = 10;
const CLOSE_SIZE = 20;
const ACTION_SIZE = 52;

export function createHudState(): HudState {
  return { buildMenu: { visible: false, screenX: 0, screenY: 0, worldX: 0, worldZ: 0 } };
}

export function createHudCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10;";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
  return canvas;
}

function selectionCardRect(W: number, H: number): Rect {
  return { x: CARD_PAD, y: H - BAR_H - CARD_H - 8, w: CARD_W, h: CARD_H };
}

function closeBtnRect(W: number, H: number): Rect {
  const card = selectionCardRect(W, H);
  return { x: card.x + card.w - CLOSE_SIZE - 6, y: card.y + 6, w: CLOSE_SIZE, h: CLOSE_SIZE };
}

function selectionActionRect(W: number, H: number): Rect {
  const card = selectionCardRect(W, H);
  return { x: card.x + card.w - ACTION_SIZE - 12, y: card.y + 34, w: ACTION_SIZE, h: ACTION_SIZE };
}

function menuLayout(sx: number, sy: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ITEM_W = 96;
  const ITEM_H = 74;
  const PAD = 12;
  const GAP = 8;
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
    rect: { x: mx + PAD + i * (ITEM_W + GAP), y: my + TITLE_H, w: ITEM_W, h: ITEM_H } as Rect,
  }));

  return {
    panel: { x: mx, y: my, w: menuW, h: menuH } as Rect,
    items,
    anchor: { x: sx, y: sy },
  };
}

function inRect(px: number, py: number, rect: Rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

export function hitTestDeselect(x: number, y: number, selected: boolean): boolean {
  return selected && inRect(x, y, closeBtnRect(window.innerWidth, window.innerHeight));
}

export function hitTestSelectionAction(x: number, y: number, selected: SelectionInfo | null): string | null {
  if (!selected?.action) return null;
  return inRect(x, y, selectionActionRect(window.innerWidth, window.innerHeight)) ? selected.action.id : null;
}

export function hitTestMenu(hud: HudState, x: number, y: number): BuildAction | "dismiss" | null {
  if (!hud.buildMenu.visible) return null;
  const { panel, items } = menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY);
  for (const item of items) {
    if (inRect(x, y, item.rect)) return item.type;
  }
  return inRect(x, y, panel) ? "dismiss" : null;
}

export function drawHUD(
  canvas: HTMLCanvasElement,
  hud: HudState,
  myColor: number,
  mySquadCount: number,
  selected: SelectionInfo | null,
  t: number
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawBottomBar(ctx, W, H, myColor, mySquadCount, selected !== null);
  if (selected) drawSelectionCard(ctx, W, H, selected);
  if (hud.buildMenu.visible) drawBuildMenu(ctx, menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY), t);
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
  const mid = top + BAR_H / 2;

  ctx.fillStyle = "rgba(8,12,22,0.78)";
  ctx.fillRect(0, top, W, BAR_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(W, top);
  ctx.stroke();

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
  ctx.fillText(`${count} squad${count !== 1 ? "s" : ""}`, 40, mid);
  ctx.restore();

  ctx.save();
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillStyle = "rgba(180,200,230,0.38)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(
    hasSelection
      ? "click ground → move  ·  double-click ground → build"
      : "click squad or building → select  ·  double-click ground → build  ·  drag → pan  ·  scroll → zoom",
    W - 14,
    mid
  );
  ctx.restore();
}

function drawSelectionCard(ctx: CanvasRenderingContext2D, W: number, H: number, info: SelectionInfo) {
  const card = selectionCardRect(W, H);
  const close = closeBtnRect(W, H);
  const action = selectionActionRect(W, H);

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

  ctx.save();
  ctx.font = "9px system-ui,sans-serif";
  ctx.fillStyle = "rgba(120,160,220,0.5)";
  ctx.textBaseline = "top";
  ctx.fillText("S E L E C T E D", card.x + 10, card.y + 8);
  ctx.restore();

  const dotX = card.x + 14;
  const dotY = card.y + 34;
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

  ctx.save();
  ctx.font = "bold 14px system-ui,sans-serif";
  ctx.fillStyle = "#dde4f0";
  ctx.textBaseline = "middle";
  ctx.fillText(info.title, dotX + 14, dotY - 8);
  ctx.font = "12px system-ui,sans-serif";
  ctx.fillStyle = "rgba(210,220,240,0.72)";
  ctx.fillText(info.detail, dotX + 14, dotY + 12);
  ctx.restore();

  const barX = card.x + 10;
  const barY = card.y + CARD_H - 18;
  const barW = info.action ? card.w - ACTION_SIZE - 28 : card.w - 20;
  const barH = 6;
  const pct = Math.max(0, Math.min(1, info.health / info.maxHealth));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  rr(ctx, barX, barY, barW, barH, 3);
  ctx.fill();
  const hue = pct > 0.5 ? 120 : pct > 0.25 ? 50 : 0;
  ctx.fillStyle = `hsl(${hue},70%,48%)`;
  rr(ctx, barX, barY, barW * pct, barH, 3);
  ctx.fill();
  ctx.restore();

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
  ctx.moveTo(cx - arm, cy - arm);
  ctx.lineTo(cx + arm, cy + arm);
  ctx.moveTo(cx + arm, cy - arm);
  ctx.lineTo(cx - arm, cy + arm);
  ctx.stroke();
  ctx.restore();

  if (info.action) {
    ctx.save();
    ctx.fillStyle = "rgba(45,78,138,0.95)";
    rr(ctx, action.x, action.y, action.w, action.h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(140,190,255,0.6)";
    ctx.lineWidth = 1.2;
    rr(ctx, action.x, action.y, action.w, action.h, 8);
    ctx.stroke();
    ctx.fillStyle = "#eef5ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 22px system-ui,sans-serif";
    ctx.fillText("+", action.x + action.w / 2, action.y + 18);
    ctx.font = "bold 10px system-ui,sans-serif";
    ctx.fillText(info.action.label, action.x + action.w / 2, action.y + 38);
    ctx.restore();
  }
}

function drawBuildMenu(ctx: CanvasRenderingContext2D, layout: ReturnType<typeof menuLayout>, t: number) {
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
    const glowA = 0.38 + 0.22 * Math.sin(t * 2.4 + i * 1.3);
    const pulse = 1 + 0.05 * Math.sin(t * 3.6 + i * 0.8);

    ctx.save();
    ctx.fillStyle = "rgba(22,38,72,0.9)";
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 7);
    ctx.fill();
    ctx.strokeStyle = `rgba(80,140,255,${glowA})`;
    ctx.lineWidth = 1.5;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 7);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = `${22 * pulse}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.icon, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h * 0.42);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#b8ccf8";
    ctx.font = "bold 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(item.label, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h - 6);
    ctx.restore();
  }
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

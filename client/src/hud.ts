/**
 * 2D canvas HUD — drawn over the Three.js canvas each frame.
 * pointer-events: none so clicks fall through to the 3D layer.
 * All hit-testing is done manually in render.ts.
 */

import { BuildingType, formatResourceCost, getBuildingRules, type ResourceCost } from "../../shared/game-rules.js";
import type { SelectionInfo } from "./entity.js";

type Rect = { x: number; y: number; w: number; h: number };

const BUILD_ITEMS = [
  {
    label: getBuildingRules(BuildingType.BARRACKS).label,
    icon: "⚔",
    type: BuildingType.BARRACKS,
    color: "#c03510",
    glow: "#ff5522",
    cost: getBuildingRules(BuildingType.BARRACKS).cost,
  },
  {
    label: getBuildingRules(BuildingType.TOWER).label,
    icon: "🗼",
    type: BuildingType.TOWER,
    color: "#1050c8",
    glow: "#3a80ff",
    cost: getBuildingRules(BuildingType.TOWER).cost,
  },
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

// Layout constants
const BAR_H      = 54;
const CARD_W     = 330;
const CARD_H     = 124;
const CARD_PAD   = 10;
const CARD_R     = 14;
const CLOSE_SIZE = 22;
const ACTION_SIZE = 58;
const ACTION_GAP  = 8;
const RESOURCE_PILL_W = 88;
const RESOURCE_PILL_H = 28;

// Palette — AoM warm dark panels + Snakebird saturated accents
const PANEL_BG         = "rgba(18, 11, 4, 0.97)";
const BORDER_GOLD      = "#c8911e";
const BORDER_GOLD_DIM  = "rgba(255,210,80,0.18)";
const TEXT_GOLD        = "#ffd060";
const TEXT_CREAM       = "#ffe8b0";
const TEXT_MUTED       = "rgba(255,210,130,0.40)";

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

// ─── Layout helpers ─────────────────────────────────────────────────────────

function selectionCardRect(W: number, H: number): Rect {
  return { x: CARD_PAD, y: H - BAR_H - CARD_H - 8, w: CARD_W, h: CARD_H };
}

function closeBtnRect(W: number, H: number): Rect {
  const card = selectionCardRect(W, H);
  return { x: card.x + card.w - CLOSE_SIZE - 7, y: card.y + 7, w: CLOSE_SIZE, h: CLOSE_SIZE };
}

function selectionActionRects(W: number, H: number, count: number): Rect[] {
  const card = selectionCardRect(W, H);
  const totalW = count * ACTION_SIZE + Math.max(0, count - 1) * ACTION_GAP;
  const startX = card.x + card.w - totalW - 12;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * (ACTION_SIZE + ACTION_GAP),
    y: card.y + 40,
    w: ACTION_SIZE,
    h: ACTION_SIZE,
  }));
}

function menuLayout(sx: number, sy: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ITEM_W   = 108;
  const ITEM_H   = 88;
  const PAD      = 14;
  const GAP      = 10;
  const TITLE_H  = 34;
  const count    = BUILD_ITEMS.length;
  const menuW    = PAD * 2 + count * ITEM_W + (count - 1) * GAP;
  const menuH    = TITLE_H + ITEM_H + PAD;

  let mx = sx - menuW / 2;
  let my = sy - menuH - 18;
  mx = Math.max(8, Math.min(W - menuW - 8, mx));
  my = Math.max(8, Math.min(H - menuH - 8, my));

  const items = BUILD_ITEMS.map((item, i) => ({
    ...item,
    rect: { x: mx + PAD + i * (ITEM_W + GAP), y: my + TITLE_H, w: ITEM_W, h: ITEM_H } as Rect,
  }));

  return { panel: { x: mx, y: my, w: menuW, h: menuH } as Rect, items, anchor: { x: sx, y: sy } };
}

function inRect(px: number, py: number, r: Rect) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ─── Hit-testing (public) ────────────────────────────────────────────────────

export function hitTestDeselect(x: number, y: number, selected: boolean): boolean {
  return selected && inRect(x, y, closeBtnRect(window.innerWidth, window.innerHeight));
}

export function hitTestSelectionAction(x: number, y: number, selected: SelectionInfo | null): string | null {
  if (!selected || selected.actions.length === 0) return null;
  const rects = selectionActionRects(window.innerWidth, window.innerHeight, selected.actions.length);
  for (let i = 0; i < rects.length; i++) {
    if (inRect(x, y, rects[i])) return selected.actions[i].id;
  }
  return null;
}

export function hitTestMenu(hud: HudState, x: number, y: number): BuildAction | "dismiss" | null {
  if (!hud.buildMenu.visible) return null;
  const { panel, items } = menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY);
  for (const item of items) {
    if (inRect(x, y, item.rect)) return item.type;
  }
  return inRect(x, y, panel) ? "dismiss" : null;
}

// ─── Main draw ───────────────────────────────────────────────────────────────

export function drawHUD(
  canvas: HTMLCanvasElement,
  hud: HudState,
  myColor: number,
  mySquadCount: number,
  resources: ResourceCost,
  selected: SelectionInfo | null,
  t: number
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawBottomBar(ctx, W, H, myColor, mySquadCount, resources, selected !== null);
  if (selected) drawSelectionCard(ctx, W, H, selected);
  if (hud.buildMenu.visible) drawBuildMenu(ctx, menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY), t);
}

// ─── Draw helpers ────────────────────────────────────────────────────────────

/** AoM-style dark panel with gold double-border. */
function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.80)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = PANEL_BG;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();

  // Outer gold border
  ctx.save();
  ctx.strokeStyle = BORDER_GOLD;
  ctx.lineWidth = 2;
  rr(ctx, x, y, w, h, r);
  ctx.stroke();

  // Inner subtle highlight (inset 3.5 px)
  ctx.strokeStyle = BORDER_GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, x + 3.5, y + 3.5, w - 7, h - 7, Math.max(r - 3, 4));
  ctx.stroke();
  ctx.restore();
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: number,
  count: number,
  resources: ResourceCost,
  hasSelection: boolean
) {
  const top = H - BAR_H;
  const mid = top + BAR_H / 2;

  // Background
  ctx.save();
  ctx.fillStyle = "rgba(16, 9, 3, 0.92)";
  ctx.fillRect(0, top, W, BAR_H);

  // Gold top edge
  ctx.strokeStyle = "rgba(175, 120, 25, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.stroke();

  // Subtle warm inner line
  ctx.strokeStyle = "rgba(255,170,50,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, top + 2); ctx.lineTo(W, top + 2); ctx.stroke();
  ctx.restore();

  // Player color — gold ring + inner color fill
  const r = (color >> 16) & 0xff;
  const g = (color >> 8)  & 0xff;
  const b =  color        & 0xff;
  ctx.save();
  ctx.beginPath(); ctx.arc(26, mid, 13, 0, Math.PI * 2);
  ctx.fillStyle = BORDER_GOLD; ctx.fill();
  ctx.beginPath(); ctx.arc(26, mid, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
  ctx.restore();

  // Squad count
  ctx.save();
  ctx.font = "bold 14px system-ui,sans-serif";
  ctx.fillStyle = TEXT_CREAM;
  ctx.textBaseline = "middle";
  ctx.fillText(`${count} squad${count !== 1 ? "s" : ""}`, 48, mid);
  ctx.restore();

  drawResourcePill(ctx, 156, mid, "#8bcf57", "Food", resources.food);
  drawResourcePill(ctx, 252, mid, "#c8954d", "Wood", resources.wood);
  drawResourcePill(ctx, 348, mid, "#f0d46f", "Gold", resources.gold);

  // Hint text (touch-friendly copy)
  ctx.save();
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillStyle = TEXT_MUTED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(
    hasSelection
      ? "tap ground → move  ·  double-tap → build"
      : "tap unit/building → select  ·  double-tap ground → build  ·  drag → pan  ·  pinch → zoom",
    W - 14, mid
  );
  ctx.restore();
}

function drawSelectionCard(ctx: CanvasRenderingContext2D, W: number, H: number, info: SelectionInfo) {
  const card      = selectionCardRect(W, H);
  const close     = closeBtnRect(W, H);
  const actionRects = selectionActionRects(W, H, info.actions.length);

  // Panel frame
  drawPanel(ctx, card.x, card.y, card.w, card.h, CARD_R);

  // "◆ SELECTED ◆" header label
  ctx.save();
  ctx.font = "bold 9px system-ui,sans-serif";
  ctx.fillStyle = "rgba(195,145,28,0.70)";
  ctx.textBaseline = "top";
  ctx.letterSpacing = "2px";
  ctx.fillText("◆  SELECTED  ◆", card.x + 12, card.y + 9);
  ctx.restore();

  if (info.production) {
    drawProductionPanel(ctx, card.x + 12, card.y + 74, card.w - 24, 24, info.production);
  }

  // Gold divider
  ctx.save();
  ctx.strokeStyle = "rgba(180,130,28,0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(card.x + 10, card.y + 24);
  ctx.lineTo(card.x + card.w - 10, card.y + 24);
  ctx.stroke();
  ctx.restore();

  // Entity color dot — gold ring + player color
  const dotX = card.x + 18;
  const dotY = card.y + 48;
  const cr = (info.color >> 16) & 0xff;
  const cg = (info.color >> 8)  & 0xff;
  const cb =  info.color        & 0xff;
  ctx.save();
  ctx.beginPath(); ctx.arc(dotX, dotY, 10, 0, Math.PI * 2);
  ctx.fillStyle = BORDER_GOLD; ctx.fill();
  ctx.beginPath(); ctx.arc(dotX, dotY, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`; ctx.fill();
  ctx.restore();

  // Title + detail
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = "bold 15px system-ui,sans-serif";
  ctx.fillStyle = TEXT_CREAM;
  ctx.fillText(info.title, dotX + 17, dotY - 8);
  ctx.font = "12px system-ui,sans-serif";
  ctx.fillStyle = "rgba(255,215,130,0.62)";
  ctx.fillText(info.detail, dotX + 17, dotY + 10);
  ctx.restore();

  // Health bar
  const actionTotalW = info.actions.length > 0
    ? info.actions.length * ACTION_SIZE + (info.actions.length - 1) * ACTION_GAP + 8
    : 0;
  const barX = card.x + 12;
  const barY = card.y + CARD_H - 20;
  const barW = card.w - 24 - actionTotalW;
  const pct  = Math.max(0, Math.min(1, info.health / info.maxHealth));

  ctx.save();
  // Track
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  rr(ctx, barX, barY, barW, 8, 4); ctx.fill();
  ctx.strokeStyle = "rgba(175,130,28,0.40)";
  ctx.lineWidth = 1;
  rr(ctx, barX, barY, barW, 8, 4); ctx.stroke();
  // Fill — bright Snakebird colors
  if (pct > 0) {
    const hue = pct > 0.5 ? 108 : pct > 0.25 ? 42 : 4;
    ctx.fillStyle = `hsl(${hue},88%,50%)`;
    rr(ctx, barX, barY, barW * pct, 8, 4); ctx.fill();
  }
  ctx.restore();

  // Close button — bright red X
  ctx.save();
  ctx.fillStyle = "rgba(205, 32, 32, 0.88)";
  rr(ctx, close.x, close.y, close.w, close.h, 6); ctx.fill();
  ctx.strokeStyle = "rgba(255,100,100,0.75)";
  ctx.lineWidth = 1.5;
  rr(ctx, close.x, close.y, close.w, close.h, 6); ctx.stroke();
  const cx = close.x + close.w / 2;
  const cy = close.y + close.h / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5);
  ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5);
  ctx.stroke();
  ctx.restore();

  // Action buttons — chunky Snakebird colors
  for (let i = 0; i < info.actions.length; i++) {
    const action = info.actions[i];
    const rect   = actionRects[i];
    const bg     = action.disabled ? "#484848" : action.active ? "#36b818" : "#1a58e0";
    const border = action.disabled ? "#8e8e8e" : action.active ? "#7cf04a" : "#60a6ff";
    const glow   = action.disabled ? "rgba(80,80,80,0.20)" : action.active ? "rgba(50,190,20,0.40)" : "rgba(26,80,220,0.40)";

    ctx.save();
    ctx.shadowColor = glow; ctx.shadowBlur = 12;
    ctx.fillStyle = bg;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 12); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = border; ctx.lineWidth = 2;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 12); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (info.actions.length > 1) {
      ctx.font = "bold 10px system-ui,sans-serif";
      ctx.fillText(action.label, rect.x + rect.w / 2, rect.y + 16);
      ctx.font = "9px system-ui,sans-serif";
      ctx.fillText(action.cost ? formatResourceCost(action.cost) : "", rect.x + rect.w / 2, rect.y + 31);
      ctx.fillText(action.timeMs ? `${Math.ceil(action.timeMs / 1000)}s` : "", rect.x + rect.w / 2, rect.y + 44);
      if ((action.queueCount ?? 0) > 0) {
        ctx.font = "bold 10px system-ui,sans-serif";
        ctx.fillText(`x${action.queueCount}`, rect.x + rect.w / 2, rect.y + 55);
      }
    } else {
      ctx.font = "bold 26px system-ui,sans-serif";
      ctx.fillText("+", rect.x + rect.w / 2, rect.y + 15);
      ctx.font = "bold 10px system-ui,sans-serif";
      ctx.fillText(action.label, rect.x + rect.w / 2, rect.y + 30);
      ctx.font = "9px system-ui,sans-serif";
      ctx.fillText(action.cost ? formatResourceCost(action.cost) : "", rect.x + rect.w / 2, rect.y + 43);
      ctx.fillText(action.timeMs ? `${Math.ceil(action.timeMs / 1000)}s` : "", rect.x + rect.w / 2, rect.y + 54);
    }
    ctx.restore();
  }
}

function drawBuildMenu(ctx: CanvasRenderingContext2D, layout: ReturnType<typeof menuLayout>, t: number) {
  const { panel, items, anchor } = layout;

  // Amber dashed connector line
  ctx.save();
  ctx.strokeStyle = "rgba(200,140,28,0.55)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(panel.x + panel.w / 2, panel.y + panel.h);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Panel frame
  drawPanel(ctx, panel.x, panel.y, panel.w, panel.h, 14);

  // "BUILD" gold title
  ctx.save();
  ctx.font = "bold 12px system-ui,sans-serif";
  ctx.fillStyle = TEXT_GOLD;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.letterSpacing = "3px";
  ctx.fillText("BUILD", panel.x + panel.w / 2, panel.y + 17);
  ctx.restore();

  // Divider under title
  ctx.save();
  ctx.strokeStyle = "rgba(175,128,28,0.36)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panel.x + 14, panel.y + 28);
  ctx.lineTo(panel.x + panel.w - 14, panel.y + 28);
  ctx.stroke();
  ctx.restore();

  for (let i = 0; i < items.length; i++) {
    const item  = items[i];
    const pulse = 1 + 0.04 * Math.sin(t * 3.2 + i * 1.1);
    const glowA = 0.45 + 0.28 * Math.sin(t * 2.6 + i * 1.3);

    ctx.save();
    // Colored card with glow
    ctx.shadowColor = item.glow;
    ctx.shadowBlur  = 14 * glowA;
    ctx.fillStyle   = item.color;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 12); ctx.fill();
    ctx.shadowBlur = 0;

    // Snakebird top-highlight sheen
    const shine = ctx.createLinearGradient(item.rect.x, item.rect.y, item.rect.x, item.rect.y + item.rect.h * 0.55);
    shine.addColorStop(0, "rgba(255,255,255,0.24)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 12); ctx.fill();

    // White border
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1.5;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 12); ctx.stroke();
    ctx.restore();

    // Icon (pulsing scale)
    ctx.save();
    ctx.font = `${28 * pulse}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.icon, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h * 0.42);
    ctx.restore();

    // Label
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
    ctx.fillText(item.label, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h - 18);
    ctx.font = "10px system-ui,sans-serif";
    ctx.fillText(formatResourceCost(item.cost), item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h - 5);
    ctx.restore();
  }
}

function drawResourcePill(
  ctx: CanvasRenderingContext2D,
  x: number,
  midY: number,
  color: string,
  label: string,
  value: number
) {
  const y = midY - RESOURCE_PILL_H * 0.5;
  ctx.save();
  ctx.fillStyle = "rgba(42,26,10,0.95)";
  rr(ctx, x, y, RESOURCE_PILL_W, RESOURCE_PILL_H, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,214,120,0.2)";
  ctx.lineWidth = 1;
  rr(ctx, x, y, RESOURCE_PILL_W, RESOURCE_PILL_H, 14);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 16, midY, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = TEXT_CREAM;
  ctx.font = "bold 10px system-ui,sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 28, midY - 6);
  ctx.font = "bold 12px system-ui,sans-serif";
  ctx.fillText(String(value), x + 28, midY + 7);
  ctx.restore();
}

function drawProductionPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  production: NonNullable<SelectionInfo["production"]>
) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  rr(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,205,90,0.18)";
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 8);
  ctx.stroke();

  const barX = x + 122;
  const barY = y + 7;
  const barW = Math.max(60, w - 206);

  ctx.fillStyle = TEXT_CREAM;
  ctx.font = "bold 10px system-ui,sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(`${production.label} x${production.queueCount}`, x + 10, y + h / 2);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.ceil(production.remainingMs / 1000)}s`, x + w - 10, y + h / 2);

  ctx.fillStyle = "rgba(28,18,6,0.85)";
  rr(ctx, barX, barY, barW, 10, 5);
  ctx.fill();
  ctx.fillStyle = "#e5b949";
  rr(ctx, barX, barY, barW * production.progress, 10, 5);
  ctx.fill();
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 8) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

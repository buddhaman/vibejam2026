/**
 * 2D canvas HUD — drawn over the Three.js canvas each frame.
 * pointer-events: none so clicks fall through to the 3D layer.
 * All hit-testing is done manually in render.ts.
 *
 * Visual theme: Neo-Hellas — Digital Antiquity
 * Ancient Greek marble aesthetics fused with post-AGI radiance.
 */

import { BuildingType, formatResourceCost, getBuildingRules, type ResourceCost } from "../../shared/game-rules.js";
import type { SelectionInfo } from "./entity.js";
import type { TileView } from "./terrain.js";

type Rect = { x: number; y: number; w: number; h: number };

const BUILD_ITEMS = [
  {
    label: getBuildingRules(BuildingType.BARRACKS).label,
    icon: "⚔",
    type: BuildingType.BARRACKS,
    color: "#7A1A1A",
    colorLight: "#B82626",
    glow: "#FF4040",
    cost: getBuildingRules(BuildingType.BARRACKS).cost,
  },
  {
    label: getBuildingRules(BuildingType.TOWER).label,
    icon: "🏛",
    type: BuildingType.TOWER,
    color: "#0F2E5A",
    colorLight: "#1B6CA8",
    glow: "#3AA8FF",
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
  _cardKey: string;
  _cardEnterT: number;
  _menuWasVisible: boolean;
  _menuOpenT: number;
  _moveMarkers: Array<{ sx: number; sy: number; born: number }>;
  _resourceBounce: { biomass: number; material: number; compute: number };
  _prevResources: { biomass: number; material: number; compute: number };
  _warning: { text: string; born: number };
};

// ─── Layout constants ────────────────────────────────────────────────────────

const BAR_H        = 62; // two rows: resources + hint line
const CARD_W       = 340;
const CARD_H       = 130;
const CARD_PAD     = 10;
const CARD_R       = 4;
const CLOSE_SIZE   = 22;
const ACTION_SIZE  = 60;
const ACTION_GAP   = 8;
const RESOURCE_W   = 96;
const RESOURCE_H   = 32;

// ─── Neo-Hellas palette ──────────────────────────────────────────────────────

// Backgrounds — lapis lazuli depths
const LAPIS_DEEP   = "rgba(8, 16, 34, 0.97)";
const LAPIS_MID    = "rgba(12, 22, 46, 0.98)";
const MARBLE_BG    = "rgba(242, 237, 215, 0.06)"; // subtle marble wash

// Gold — Olympic flame
const GOLD_BRIGHT  = "#C9911E";
const GOLD_DIM     = "rgba(201, 145, 30, 0.20)";
const GOLD_TEXT    = "#F0C060";
const GOLD_FAINT   = "rgba(240, 192, 96, 0.38)";

// Marble — Pentelic warmth
const MARBLE_TEXT  = "#F2EDD7";
const MARBLE_DIM   = "rgba(242, 237, 215, 0.55)";
const MARBLE_MUTED = "rgba(242, 237, 215, 0.28)";

// Azure — Aegean sea / Hellenic flag
const AZURE        = "#1B6CA8";
const AZURE_GLOW   = "rgba(27, 108, 168, 0.50)";

// Cyan — divine post-AGI radiance (Zeus's electricity, now digital)
const DIVINE_CYAN  = "#00D4FF";
const CYAN_GLOW    = "rgba(0, 212, 255, 0.45)";
const CYAN_DIM     = "rgba(0, 212, 255, 0.18)";

// Crimson — Spartan war standard
const CRIMSON      = "#B82020";
const CRIMSON_GLOW = "rgba(184, 32, 32, 0.50)";

// ─── Fonts ───────────────────────────────────────────────────────────────────

const F_CINZEL_SM   = "600 10px 'Cinzel', serif";
const F_CINZEL_MD   = "600 13px 'Cinzel', serif";
const F_CINZEL_LG   = "700 16px 'Cinzel', serif";
const F_CINZEL_XL   = "700 18px 'Cinzel', serif";
const F_NUM_SM      = "bold 11px system-ui, sans-serif";
const F_NUM_MD      = "bold 13px system-ui, sans-serif";
const F_NUM_LG      = "bold 16px system-ui, sans-serif";
const F_BODY_SM     = "11px system-ui, sans-serif";
const F_BODY_XS     = "10px system-ui, sans-serif";

// ─── State ───────────────────────────────────────────────────────────────────

export function createHudState(): HudState {
  return {
    buildMenu: { visible: false, screenX: 0, screenY: 0, worldX: 0, worldZ: 0 },
    _cardKey: "",
    _cardEnterT: -999,
    _menuWasVisible: false,
    _menuOpenT: -999,
    _moveMarkers: [],
    _resourceBounce: { biomass: -999, material: -999, compute: -999 },
    _prevResources: { biomass: 0, material: 0, compute: 0 },
    _warning: { text: "", born: -999 },
  };
}

export function addMoveMarker(hud: HudState, sx: number, sy: number, t: number): void {
  hud._moveMarkers.push({ sx, sy, born: t });
  if (hud._moveMarkers.length > 6) hud._moveMarkers.shift();
}

export function showWarning(hud: HudState, text: string, t: number): void {
  hud._warning = { text, born: t };
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

// ─── Layout helpers ──────────────────────────────────────────────────────────

function selectionCardRect(W: number, H: number): Rect {
  return { x: CARD_PAD, y: H - BAR_H - CARD_H - 10, w: CARD_W, h: CARD_H };
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
    y: card.y + 44,
    w: ACTION_SIZE,
    h: ACTION_SIZE,
  }));
}

function menuLayout(sx: number, sy: number) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const ITEM_W   = 112;
  const ITEM_H   = 92;
  const PAD      = 16;
  const GAP      = 10;
  const TITLE_H  = 38;
  const count    = BUILD_ITEMS.length;
  const menuW    = PAD * 2 + count * ITEM_W + (count - 1) * GAP;
  const menuH    = TITLE_H + ITEM_H + PAD;

  let mx = sx - menuW / 2;
  let my = sy - menuH - 20;
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

// ─── Hit-testing (public) ─────────────────────────────────────────────────────

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

// ─── Main draw ────────────────────────────────────────────────────────────────

export function drawHUD(
  canvas: HTMLCanvasElement,
  hud: HudState,
  myColor: number,
  mySquadCount: number,
  resources: ResourceCost,
  selected: SelectionInfo | null,
  selectedTile: TileView | null,
  t: number
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Track animation state
  const cardKey = selected ? `${selected.title}:${selected.color}` : "";
  if (cardKey !== hud._cardKey) {
    hud._cardKey = cardKey;
    hud._cardEnterT = cardKey ? t : -999;
  }

  if (hud.buildMenu.visible && !hud._menuWasVisible) hud._menuOpenT = t;
  hud._menuWasVisible = hud.buildMenu.visible;

  if (resources.biomass > hud._prevResources.biomass) hud._resourceBounce.biomass = t;
  if (resources.material > hud._prevResources.material) hud._resourceBounce.material = t;
  if (resources.compute > hud._prevResources.compute) hud._resourceBounce.compute = t;
  hud._prevResources = { biomass: resources.biomass, material: resources.material, compute: resources.compute };

  // Draw layers
  drawMoveMarkers(ctx, hud, t);
  drawWarningToast(ctx, W, H, hud, t);
  drawBottomBar(ctx, W, H, myColor, mySquadCount, resources, hud._resourceBounce, selected !== null, t);
  if (selected) drawSelectionCard(ctx, W, H, selected, t, hud._cardEnterT);
  if (!selected && selectedTile) drawTileCard(ctx, W, H, selectedTile);
  if (hud.buildMenu.visible) drawBuildMenu(ctx, menuLayout(hud.buildMenu.screenX, hud.buildMenu.screenY), t, hud._menuOpenT);
}

// ─── Move markers — divine cyan ripples ──────────────────────────────────────

function drawMoveMarkers(ctx: CanvasRenderingContext2D, hud: HudState, t: number): void {
  const life = 0.9;
  hud._moveMarkers = hud._moveMarkers.filter((m) => t - m.born < life);

  for (const m of hud._moveMarkers) {
    const u = Math.min(1, (t - m.born) / life);
    const alpha = (1 - u) * 0.72;

    ctx.save();
    // Outer ring — divine cyan
    ctx.beginPath();
    ctx.arc(m.sx, m.sy, 10 + u * 50, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner ring — white flash
    ctx.beginPath();
    ctx.arc(m.sx, m.sy, (10 + u * 50) * 0.4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Cross-hair center dot
    if (u < 0.15) {
      const dotAlpha = (1 - u / 0.15) * 0.85;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 212, 255, ${dotAlpha})`;
      ctx.fill();
    }
    ctx.restore();
  }
}

// ─── Warning toast — marble panel ────────────────────────────────────────────

function drawWarningToast(ctx: CanvasRenderingContext2D, W: number, H: number, hud: HudState, t: number): void {
  if (!hud._warning.text) return;
  const age = t - hud._warning.born;
  if (age > 2.2) return;

  const fadeIn  = Math.min(1, age / 0.10);
  const fadeOut = Math.min(1, (2.2 - age) / 0.30);
  const alpha   = Math.max(0, Math.min(fadeIn, fadeOut));
  const ySlide  = Math.max(0, 1 - fadeIn) * 12;
  const w = 300; const h = 36;
  const x = (W - w) * 0.5;
  const y = H - BAR_H - 92 - ySlide;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 22;

  // Marble background
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "rgba(242, 237, 215, 0.97)");
  grad.addColorStop(1, "rgba(220, 214, 192, 0.97)");
  ctx.fillStyle = grad;
  rr(ctx, x, y, w, h, 3); ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = CRIMSON;
  ctx.lineWidth = 2;
  rr(ctx, x, y, w, h, 3); ctx.stroke();

  ctx.fillStyle = "#1A0A0A";
  ctx.font = F_CINZEL_SM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "1px";
  ctx.fillText(hud._warning.text.toUpperCase(), x + w / 2, y + h / 2);
  ctx.restore();
}

// ─── Panel helpers ────────────────────────────────────────────────────────────

/** Lapis panel with gold double-rule border — the classical Neo-Hellas frame. */
function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = LAPIS_MID;
  rr(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();

  // Outer gold rule
  ctx.save();
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 1.5;
  rr(ctx, x, y, w, h, r); ctx.stroke();

  // Inner dim rule (inset 3px)
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, x + 3, y + 3, w - 6, h - 6, Math.max(r - 2, 2)); ctx.stroke();
  ctx.restore();

  // Marble wash over top-left
  ctx.save();
  const marbleGrad = ctx.createLinearGradient(x, y, x + w * 0.4, y + h * 0.3);
  marbleGrad.addColorStop(0, MARBLE_BG);
  marbleGrad.addColorStop(1, "rgba(242,237,215,0)");
  ctx.fillStyle = marbleGrad;
  rr(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();
}

/** Draws a Greek key fret as a top border stripe. */
function drawMeanderStripe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const unit = 10; // width per repeating unit
  const h    = 5;  // height of the fret

  ctx.save();
  ctx.strokeStyle = GOLD_FAINT;
  ctx.lineWidth = 1;
  ctx.lineCap = "square";
  ctx.beginPath();

  for (let cx = x; cx + unit <= x + w; cx += unit) {
    const even = Math.floor((cx - x) / unit) % 2 === 0;
    const topY  = y;
    const botY  = y + h;
    const midY  = y + h * 0.5;
    const halfX = cx + unit * 0.5;
    // L-hook alternating up / down
    ctx.moveTo(cx,      even ? botY : topY);
    ctx.lineTo(cx,      even ? topY : botY);
    ctx.lineTo(halfX,   even ? topY : botY);
    ctx.lineTo(halfX,   even ? midY : midY);
    ctx.lineTo(cx + unit, even ? midY : midY);
  }

  ctx.stroke();
  ctx.restore();
}

// ─── Bottom bar ───────────────────────────────────────────────────────────────

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: number,
  count: number,
  resources: ResourceCost,
  bounce: HudState["_resourceBounce"],
  hasSelection: boolean,
  t: number
) {
  const top = H - BAR_H;
  /** Vertically center squad marker + resource row in the upper band (hints sit below). */
  const rowMid = top + 24;
  const hintY = top + 50;

  // Background — lapis deep
  ctx.save();
  ctx.fillStyle = LAPIS_DEEP;
  ctx.fillRect(0, top, W, BAR_H);

  // Gold top rule
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.stroke();

  // Second rule — dim
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, top + 3); ctx.lineTo(W, top + 3); ctx.stroke();
  ctx.restore();

  // Meander pattern just below the top rule
  drawMeanderStripe(ctx, 0, top + 5, W);

  // Player color — angular diamond shape (laurel-wreath feel) + inner color
  const r = (color >> 16) & 0xff;
  const g = (color >> 8)  & 0xff;
  const b =  color        & 0xff;
  const cx = 28;
  const dotR = 11;
  ctx.save();
  ctx.beginPath();
  // Diamond outline
  ctx.moveTo(cx, rowMid - dotR - 2);
  ctx.lineTo(cx + dotR + 2, rowMid);
  ctx.lineTo(cx, rowMid + dotR + 2);
  ctx.lineTo(cx - dotR - 2, rowMid);
  ctx.closePath();
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, rowMid, dotR * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();
  ctx.restore();

  // Squad count with Cinzel
  ctx.save();
  ctx.font = F_CINZEL_SM;
  ctx.fillStyle = MARBLE_TEXT;
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "0.5px";
  ctx.fillText(`${count} ${count !== 1 ? "Squads" : "Squad"}`, 50, rowMid);
  ctx.restore();

  // Resource pills — spaced at 164, 268, 372
  drawResourcePill(ctx, 164, rowMid, "#3D9E47", DIVINE_CYAN, "Biomass",  resources.biomass,  bounce.biomass,  t, "B");
  drawResourcePill(ctx, 268, rowMid, "#8A7054", "#D4A84C",   "Material", resources.material, bounce.material, t, "M");
  drawResourcePill(ctx, 372, rowMid, "#00A8CC", DIVINE_CYAN, "Compute",  resources.compute,  bounce.compute,  t, "C");

  // Hint text — own row under pills so long copy never collides with resource boxes
  ctx.save();
  ctx.font = F_BODY_XS;
  ctx.fillStyle = MARBLE_MUTED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const hint =
    hasSelection
      ? "tap ground → move  ·  double-tap → construct"
      : "tap warrior → select  ·  double-tap ground → construct  ·  drag → pan  ·  pinch → zoom";
  ctx.fillText(hint, W * 0.5, hintY);
  ctx.restore();
}

function drawResourcePill(
  ctx: CanvasRenderingContext2D,
  x: number,
  midY: number,
  dotColor: string,
  glowColor: string,
  label: string,
  value: number,
  bounceT: number,
  t: number,
  _abbrev: string
) {
  const bounceAge = t - bounceT;
  const yBounce   = bounceAge < 0.45 ? -Math.sin((bounceAge / 0.45) * Math.PI) * 6 : 0;
  const y = midY - RESOURCE_H * 0.5 + yBounce;

  ctx.save();

  // Glow aura when bouncing
  if (bounceAge < 0.45) {
    const gAlpha = Math.sin((bounceAge / 0.45) * Math.PI) * 0.35;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 1 - (1 - gAlpha) * (1 - 1);
  }

  // Pill background
  ctx.fillStyle = "rgba(10, 20, 42, 0.90)";
  rr(ctx, x, y, RESOURCE_W, RESOURCE_H, 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Left accent stripe
  ctx.fillStyle = dotColor;
  rr(ctx, x, y, 3, RESOURCE_H, 2);
  ctx.fill();

  // Gold outline
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, x, y, RESOURCE_W, RESOURCE_H, 2); ctx.stroke();

  const labelY = midY + yBounce - 6;
  const valueY = midY + yBounce + 8;

  // Label — Cinzel tiny caps
  ctx.fillStyle = MARBLE_MUTED;
  ctx.font = "600 8.5px 'Cinzel', serif";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "1px";
  ctx.fillText(label.toUpperCase(), x + 10, labelY);

  // Value — bold system font for readability
  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = F_NUM_MD;
  ctx.letterSpacing = "0px";
  ctx.fillText(String(value), x + 10, valueY);

  ctx.restore();
}

// ─── Selection card ────────────────────────────────────────────────────────────

function drawSelectionCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  info: SelectionInfo,
  t: number,
  enterT: number
) {
  const card       = selectionCardRect(W, H);
  const close      = closeBtnRect(W, H);
  const actionRects = selectionActionRects(W, H, info.actions.length);

  // Slide-in from bottom
  const cardAge  = Math.max(0, t - enterT);
  const cardYOff = cardAge < 0.4 ? (1 - easeOutBack(Math.min(1, cardAge / 0.35))) * 42 : 0;

  ctx.save();
  ctx.translate(0, cardYOff);

  drawPanel(ctx, card.x, card.y, card.w, card.h, CARD_R);

  // "— CHOSEN —" header in Cinzel caps
  ctx.save();
  ctx.font = "600 8px 'Cinzel', serif";
  ctx.fillStyle = GOLD_TEXT;
  ctx.textBaseline = "top";
  ctx.letterSpacing = "3px";
  ctx.fillText("—  CHOSEN  —", card.x + 12, card.y + 10);
  ctx.restore();

  // Gold divider
  ctx.save();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(card.x + 10, card.y + 26);
  ctx.lineTo(card.x + card.w - 10, card.y + 26);
  ctx.stroke();
  ctx.restore();

  if (info.production) {
    drawProductionPanel(ctx, card.x + 12, card.y + 82, card.w - 24, 26, info.production);
  }

  // Entity color — diamond shape
  const dotX = card.x + 20;
  const dotY = card.y + 54;
  const cr = (info.color >> 16) & 0xff;
  const cg = (info.color >> 8)  & 0xff;
  const cb =  info.color        & 0xff;
  const dR = 10;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dotX, dotY - dR - 2);
  ctx.lineTo(dotX + dR + 2, dotY);
  ctx.lineTo(dotX, dotY + dR + 2);
  ctx.lineTo(dotX - dR - 2, dotY);
  ctx.closePath();
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, dotY, dR * 0.78, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.fill();
  ctx.restore();

  // Title — Cinzel
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = F_CINZEL_LG;
  ctx.fillStyle = MARBLE_TEXT;
  ctx.letterSpacing = "0.5px";
  ctx.fillText(info.title, dotX + 18, dotY - 9);

  // Detail — smaller, muted
  ctx.font = F_BODY_SM;
  ctx.fillStyle = MARBLE_DIM;
  ctx.letterSpacing = "0px";
  ctx.fillText(info.detail, dotX + 18, dotY + 10);
  ctx.restore();

  // Health bar
  const actionTotalW = info.actions.length > 0
    ? info.actions.length * ACTION_SIZE + (info.actions.length - 1) * ACTION_GAP + 8
    : 0;
  const barX = card.x + 12;
  const barY = card.y + CARD_H - 18;
  const barW = card.w - 24 - actionTotalW;
  const pct  = Math.max(0, Math.min(1, info.health / info.maxHealth));

  ctx.save();
  // Track
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  rr(ctx, barX, barY, barW, 7, 2); ctx.fill();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, barX, barY, barW, 7, 2); ctx.stroke();
  // Fill
  if (pct > 0) {
    let barColor: string;
    if (pct > 0.5) {
      barColor = "#2E9E42"; // healthy — forest green
    } else if (pct > 0.25) {
      barColor = "#C9911E"; // caution — Olympic gold
    } else {
      barColor = CRIMSON; // critical — Spartan red
      if (pct < 0.3) {
        ctx.shadowColor = `rgba(184,32,32,${0.3 + 0.25 * Math.sin(t * 9)})`;
        ctx.shadowBlur = 10;
      }
    }
    ctx.fillStyle = barColor;
    rr(ctx, barX, barY, barW * pct, 7, 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // Close button — crimson X
  ctx.save();
  ctx.fillStyle = "rgba(140, 18, 18, 0.92)";
  rr(ctx, close.x, close.y, close.w, close.h, 3); ctx.fill();
  ctx.strokeStyle = "rgba(255, 80, 80, 0.65)";
  ctx.lineWidth = 1.5;
  rr(ctx, close.x, close.y, close.w, close.h, 3); ctx.stroke();
  const ccx = close.x + close.w / 2;
  const ccy = close.y + close.h / 2;
  ctx.strokeStyle = MARBLE_TEXT;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ccx - 5, ccy - 5); ctx.lineTo(ccx + 5, ccy + 5);
  ctx.moveTo(ccx + 5, ccy - 5); ctx.lineTo(ccx - 5, ccy + 5);
  ctx.stroke();
  ctx.restore();

  // Action buttons
  for (let i = 0; i < info.actions.length; i++) {
    const action = info.actions[i];
    const rect   = actionRects[i];

    let bg: string, border: string, glow: string;
    if (action.disabled) {
      bg = "#1C1C28"; border = "#3A3A50"; glow = "transparent";
    } else if (action.active) {
      bg = "#1A4A1A"; border = "#3ABB44"; glow = "rgba(40,180,50,0.38)";
    } else {
      bg = "#0E2250"; border = AZURE; glow = AZURE_GLOW;
    }

    ctx.save();
    ctx.shadowColor = glow; ctx.shadowBlur = 12;
    ctx.fillStyle = bg;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 3); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = border; ctx.lineWidth = 1.5;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 3); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (info.actions.length > 1) {
      ctx.font = "600 9px 'Cinzel', serif";
      ctx.letterSpacing = "0.5px";
      ctx.fillText(action.label, rect.x + rect.w / 2, rect.y + 17);
      ctx.font = F_BODY_XS;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = MARBLE_DIM;
      ctx.fillText(action.cost ? formatResourceCost(action.cost) : "", rect.x + rect.w / 2, rect.y + 33);
      ctx.fillText(action.timeMs ? `${Math.ceil(action.timeMs / 1000)}s` : "", rect.x + rect.w / 2, rect.y + 46);
      if ((action.queueCount ?? 0) > 0) {
        ctx.font = F_NUM_SM;
        ctx.fillStyle = GOLD_TEXT;
        ctx.fillText(`×${action.queueCount}`, rect.x + rect.w / 2, rect.y + 56);
      }
    } else {
      ctx.font = "bold 24px system-ui";
      ctx.fillText("+", rect.x + rect.w / 2, rect.y + 16);
      ctx.font = "600 9px 'Cinzel', serif";
      ctx.letterSpacing = "0.5px";
      ctx.fillText(action.label, rect.x + rect.w / 2, rect.y + 31);
      ctx.font = F_BODY_XS;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = MARBLE_DIM;
      ctx.fillText(action.cost ? formatResourceCost(action.cost) : "", rect.x + rect.w / 2, rect.y + 44);
      ctx.fillText(action.timeMs ? `${Math.ceil(action.timeMs / 1000)}s` : "", rect.x + rect.w / 2, rect.y + 55);
    }
    ctx.restore();
  }

  ctx.restore(); // close slide-in transform
}

// ─── Build menu ───────────────────────────────────────────────────────────────

function drawBuildMenu(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof menuLayout>,
  t: number,
  openT: number
) {
  const { panel, items, anchor } = layout;

  const menuAge   = Math.max(0, t - openT);
  const menuScale = menuAge < 0.4 ? easeOutBack(Math.min(1, menuAge / 0.28)) : 1;

  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.scale(menuScale, menuScale);
  ctx.translate(-anchor.x, -anchor.y);

  // Connector line — cyan dashed
  ctx.save();
  ctx.strokeStyle = CYAN_DIM;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(panel.x + panel.w / 2, panel.y + panel.h);
  ctx.lineTo(anchor.x, anchor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawPanel(ctx, panel.x, panel.y, panel.w, panel.h, 4);

  // "CONSTRUCT" title in Cinzel
  ctx.save();
  ctx.font = "700 11px 'Cinzel', serif";
  ctx.fillStyle = GOLD_TEXT;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.letterSpacing = "4px";
  ctx.fillText("CONSTRUCT", panel.x + panel.w / 2, panel.y + 19);
  ctx.restore();

  // Divider with small laurel dots
  ctx.save();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panel.x + 14, panel.y + 32);
  ctx.lineTo(panel.x + panel.w - 14, panel.y + 32);
  ctx.stroke();
  // Small diamond accents at divider ends
  drawDiamond(ctx, panel.x + 14, panel.y + 32, 3, GOLD_BRIGHT);
  drawDiamond(ctx, panel.x + panel.w - 14, panel.y + 32, 3, GOLD_BRIGHT);
  ctx.restore();

  for (let i = 0; i < items.length; i++) {
    const item  = items[i];
    const pulse = 1 + 0.035 * Math.sin(t * 2.8 + i * 1.1);
    const glowA = 0.4 + 0.25 * Math.sin(t * 2.2 + i * 1.3);

    ctx.save();
    // Card with gradient — dark base to lighter at top
    ctx.shadowColor = item.glow;
    ctx.shadowBlur  = 12 * glowA;

    const grad = ctx.createLinearGradient(item.rect.x, item.rect.y, item.rect.x, item.rect.y + item.rect.h);
    grad.addColorStop(0, item.colorLight);
    grad.addColorStop(1, item.color);
    ctx.fillStyle = grad;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.fill();
    ctx.shadowBlur = 0;

    // Top marble sheen
    const shine = ctx.createLinearGradient(item.rect.x, item.rect.y, item.rect.x, item.rect.y + item.rect.h * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.18)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.fill();

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.stroke();
    ctx.restore();

    // Icon — pulsing
    ctx.save();
    ctx.font = `${30 * pulse}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.icon, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h * 0.40);
    ctx.restore();

    // Label in Cinzel
    ctx.save();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.font = "600 10px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.letterSpacing = "0.5px";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 5;
    ctx.fillText(item.label, item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h - 18);
    ctx.font = F_BODY_XS;
    ctx.letterSpacing = "0px";
    ctx.fillStyle = MARBLE_DIM;
    ctx.fillText(formatResourceCost(item.cost), item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h - 4);
    ctx.restore();
  }

  ctx.restore(); // close pop-in
}

// ─── Production panel ─────────────────────────────────────────────────────────

function drawProductionPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  production: NonNullable<SelectionInfo["production"]>
) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  rr(ctx, x, y, w, h, 2); ctx.fill();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 2); ctx.stroke();

  const barX = x + 128;
  const barY = y + 8;
  const barW = Math.max(60, w - 210);

  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = "600 9px 'Cinzel', serif";
  ctx.letterSpacing = "0.5px";
  ctx.textBaseline = "middle";
  ctx.fillText(`${production.label.toUpperCase()} ×${production.queueCount}`, x + 10, y + h / 2);
  ctx.textAlign = "right";
  ctx.letterSpacing = "0px";
  ctx.font = F_NUM_SM;
  ctx.fillText(`${Math.ceil(production.remainingMs / 1000)}s`, x + w - 10, y + h / 2);

  ctx.fillStyle = "rgba(22,14,6,0.88)";
  rr(ctx, barX, barY, barW, 10, 2); ctx.fill();

  // Progress bar — divine cyan
  ctx.fillStyle = DIVINE_CYAN;
  ctx.shadowColor = CYAN_GLOW;
  ctx.shadowBlur = 6;
  rr(ctx, barX, barY, barW * production.progress, 10, 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── Tile card ────────────────────────────────────────────────────────────────

function drawTileCard(ctx: CanvasRenderingContext2D, W: number, H: number, tile: TileView) {
  const card = selectionCardRect(W, H);
  drawPanel(ctx, card.x, card.y, card.w, 100, CARD_R);

  ctx.save();

  // Header
  ctx.fillStyle = GOLD_TEXT;
  ctx.font = "600 8px 'Cinzel', serif";
  ctx.textBaseline = "top";
  ctx.letterSpacing = "3px";
  ctx.fillText("—  TERRAIN  —", card.x + 12, card.y + 10);

  // Divider
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(card.x + 10, card.y + 26); ctx.lineTo(card.x + card.w - 10, card.y + 26);
  ctx.stroke();

  // Tile name
  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = F_CINZEL_LG;
  ctx.letterSpacing = "0.5px";
  ctx.textBaseline = "top";
  ctx.fillText(
    tile.isMountain
      ? "Mountain"
      : tile.material > 0
        ? "Forest"
        : tile.maxCompute > 0
          ? "Data center"
          : "Grassland",
    card.x + 14, card.y + 34
  );

  // Stats
  ctx.fillStyle = MARBLE_DIM;
  ctx.font = F_BODY_SM;
  ctx.letterSpacing = "0px";
  let statY = card.y + 60;
  if (!tile.isMountain && tile.material > 0) {
    ctx.fillText(`Material: ${tile.material} / ${tile.maxMaterial}`, card.x + 14, statY);
    statY += 18;
  }
  if (!tile.isMountain && tile.maxCompute > 0) {
    ctx.fillText(`Compute: ${tile.compute} / ${tile.maxCompute}`, card.x + 14, statY);
    statY += 18;
  }
  ctx.fillText(
    tile.isMountain
      ? `Impassable terrain  ·  Elevation: ${tile.height.toFixed(2)}`
      : `Elevation: ${tile.height.toFixed(2)}`,
    card.x + 14,
    statY
  );
  ctx.restore();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 4) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

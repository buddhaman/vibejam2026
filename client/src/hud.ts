/**
 * 2D canvas HUD — drawn over the Three.js canvas each frame.
 * pointer-events: none so clicks fall through to the 3D layer.
 * All hit-testing is done manually in render.ts.
 *
 * Visual theme: Neo-Hellas — Digital Antiquity
 * Ancient Greek marble aesthetics fused with post-AGI radiance.
 */

import { BuildingType, canAfford, formatResourceCost, getBuildingRules, type BuildingType as BuildingTypeValue, type ResourceCost } from "../../shared/game-rules.js";
import { CarriedResourceType } from "../../shared/protocol.js";
import type { SelectionInfo } from "./entity.js";
import type { TileView } from "./terrain.js";
import { publicAssetUrl } from "./asset-url.js";

type Rect = { x: number; y: number; w: number; h: number };
type ResourceIconKey = "biomass" | "material" | "gpu";

const BUILD_ITEM_THEME: Record<BuildingType, { icon: string; color: string; colorLight: string; glow: string }> = {
  [BuildingType.BARRACKS]: { icon: "⚔", color: "#7A1A1A", colorLight: "#B82626", glow: "#FF4040" },
  [BuildingType.TOWER]: { icon: "🏛", color: "#0F2E5A", colorLight: "#1B6CA8", glow: "#3AA8FF" },
  [BuildingType.TOWN_CENTER]: { icon: "⌂", color: "#6D4D1D", colorLight: "#D5A04A", glow: "#FFD27A" },
  [BuildingType.ARCHERY_RANGE]: { icon: "🏹", color: "#5C3B15", colorLight: "#B7752E", glow: "#FFC16A" },
  [BuildingType.STABLE]: { icon: "♞", color: "#3D244F", colorLight: "#7B51A6", glow: "#D0A6FF" },
  [BuildingType.FARM]: { icon: "☘", color: "#5D4116", colorLight: "#8F6A2B", glow: "#8BDB65" },
};

const BUILD_MENU_TYPES = [
  BuildingType.BARRACKS,
  BuildingType.ARCHERY_RANGE,
  BuildingType.STABLE,
  BuildingType.FARM,
  BuildingType.TOWER,
] as const;

const BUILD_ITEMS = BUILD_MENU_TYPES.map((type) => ({
  label: getBuildingRules(type).label,
  type,
  cost: getBuildingRules(type).cost,
  ...BUILD_ITEM_THEME[type],
})) as const;

export type BuildAction = (typeof BUILD_ITEMS)[number]["type"];

export type KothState = {
  ownerSessionId: string;
  ownerName: string;
  ownerColor: number;
  entries: Array<{ sessionId: string; name: string; color: number; timeMs: number }>;
};

export type FarmEntry = {
  farmGrowth: number;
  hasAgent: boolean;
  isHarvesting: boolean;
};

export type IdleAgentHudInfo = {
  count: number;
  available: boolean;
};

export type AgentStatusLabel = {
  sx: number;
  sy: number;
  resourceType: number;
};

export type HudState = {
  buildPanelOpen: boolean;
  activeBuildType: BuildingTypeValue | null;
  buildAnchorTileKey: string | null;
  _cardKey: string;
  _cardEnterT: number;
  _panelWasVisible: boolean;
  _panelOpenT: number;
  _moveMarkers: Array<{ sx: number; sy: number; born: number }>;
  _resourceBounce: { biomass: number; material: number; compute: number };
  _prevResources: { biomass: number; material: number; compute: number };
  _warning: { text: string; born: number };
};

// ─── Layout constants ────────────────────────────────────────────────────────

const BAR_H        = 62; // legacy floating panel layout
const CONTEXT_BTN_W = 64;
const CONTEXT_BTN_H = 46;
const CONTEXT_BTN_GAP = 6;
const CONTEXT_CANCEL_W = 44;
const VIBEJAM_W    = 108; // horizontal space reserved for the required vibejam widget
const CARD_W       = 428;
const CARD_H       = 130;
const CARD_PAD     = 10;
const CARD_R       = 4;
const CLOSE_SIZE   = 22;
const ACTION_SIZE  = 60;
const ACTION_GAP   = 8;
const RESOURCE_W   = 96;
const RESOURCE_H   = 32;
const BUILD_BTN_W  = 82;
const BUILD_BTN_H  = 34;
const BUILD_PANEL_ITEM_W   = 100;
const BUILD_PANEL_ITEM_H   = 82;
const BUILD_PANEL_PAD      = 14;
const BUILD_PANEL_GAP      = 8;
const BUILD_PANEL_TITLE_H  = 32;

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

const RESOURCE_ICON_PATHS: Record<ResourceIconKey, string> = {
  biomass: publicAssetUrl("assets/icons/biomass_icon.png"),
  material: publicAssetUrl("assets/icons/material_icon.png"),
  gpu: publicAssetUrl("assets/icons/gpu_icon.png"),
};

const RESOURCE_ICON_IMAGES: Record<ResourceIconKey, HTMLImageElement | null> = {
  biomass: null,
  material: null,
  gpu: null,
};

if (typeof Image !== "undefined") {
  for (const key of Object.keys(RESOURCE_ICON_PATHS) as ResourceIconKey[]) {
    const img = new Image();
    img.decoding = "async";
    img.src = RESOURCE_ICON_PATHS[key];
    RESOURCE_ICON_IMAGES[key] = img;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

export function createHudState(): HudState {
  return {
    buildPanelOpen: false,
    activeBuildType: null,
    buildAnchorTileKey: null,
    _cardKey: "",
    _cardEnterT: -999,
    _panelWasVisible: false,
    _panelOpenT: -999,
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


function inRect(px: number, py: number, r: Rect) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function clipText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

function bottomBarRect(W: number, H: number): Rect {
  const rows = contextActionRowCount(W, currentContextActionCount(), currentContextActionCompact());
  const h = contextBarHeightForRows(rows);
  return { x: 0, y: H - h, w: W, h };
}

function contextActionLeft(W: number, compact: boolean): number {
  if (compact) return 16;
  // On mobile: start buttons earlier so they fit in one row
  if (W < 500) return Math.min(108, Math.floor(W * 0.28));
  return Math.max(180, Math.min(300, Math.floor(W * 0.25)));
}

function contextCancelRect(W: number, H: number): Rect {
  const bar = bottomBarRect(W, H);
  return contextCancelRectForBar(W, bar);
}

// Minimum button width ensuring 44px touch targets even on narrow screens
const CONTEXT_BTN_MIN_W = 44;

function contextActionRects(W: number, H: number, count: number, compact = false): Rect[] {
  if (count <= 0) return [];
  const rows = contextActionRowCount(W, count, compact);
  const bar = { x: 0, y: H - contextBarHeightForRows(rows), w: W, h: contextBarHeightForRows(rows) };
  const cancel = contextCancelRectForBar(W, bar);
  const left = contextActionLeft(W, compact);
  const right = Math.max(left + CONTEXT_BTN_MIN_W, cancel.x - 10);
  const availableW = Math.max(CONTEXT_BTN_MIN_W, right - left);
  // Use min touch-target width for perRow so buttons flex to fill rather than stack
  const perRow = Math.max(1, Math.floor((availableW + CONTEXT_BTN_GAP) / (CONTEXT_BTN_MIN_W + CONTEXT_BTN_GAP)));
  const buttonW = Math.min(CONTEXT_BTN_W, (availableW - Math.max(0, Math.min(count, perRow) - 1) * CONTEXT_BTN_GAP) / Math.min(count, perRow));
  const startY = bar.y + 16;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const rowCount = Math.min(perRow, count - row * perRow);
    const totalW = rowCount * buttonW + Math.max(0, rowCount - 1) * CONTEXT_BTN_GAP;
    const startX = compact ? right - totalW : left;
    return {
      x: startX + col * (buttonW + CONTEXT_BTN_GAP),
      y: startY + row * (CONTEXT_BTN_H + CONTEXT_BTN_GAP),
      w: buttonW,
      h: CONTEXT_BTN_H,
    };
  });
}

let contextActionCountHint = 0;
let contextActionCompactHint = false;

function currentContextActionCount(): number {
  return contextActionCountHint;
}

function currentContextActionCompact(): boolean {
  return contextActionCompactHint;
}

function contextActionRowCount(W: number, count: number, compact = false): number {
  if (count <= 0) return 1;
  const right = W - VIBEJAM_W - CONTEXT_CANCEL_W - 18;
  const left = contextActionLeft(W, compact);
  const availableW = Math.max(CONTEXT_BTN_MIN_W, right - left);
  const perRow = Math.max(1, Math.floor((availableW + CONTEXT_BTN_GAP) / (CONTEXT_BTN_MIN_W + CONTEXT_BTN_GAP)));
  return Math.max(1, Math.ceil(count / perRow));
}

function contextBarHeightForRows(rows: number): number {
  return Math.min(188, 116 + Math.max(0, rows - 1) * (CONTEXT_BTN_H + CONTEXT_BTN_GAP));
}

function topResourceStackRect(): Rect {
  return { x: 10, y: 10, w: 118, h: 86 };
}

function contextCancelRectForBar(W: number, bar: Rect): Rect {
  return { x: W - VIBEJAM_W - CONTEXT_CANCEL_W - 8, y: bar.y + 16, w: CONTEXT_CANCEL_W, h: Math.min(50, bar.h - 30) };
}

// ─── Layout helpers — build button & panel ───────────────────────────────────

function buildButtonRect(W: number, H: number): Rect {
  const top = H - BAR_H;
  const rowMid = top + 24;
  return { x: W - 96, y: rowMid - BUILD_BTN_H / 2, w: BUILD_BTN_W, h: BUILD_BTN_H };
}

function buildPanelLayout(W: number, H: number) {
  const count = BUILD_ITEMS.length;
  const totalItemW = count * BUILD_PANEL_ITEM_W + (count - 1) * BUILD_PANEL_GAP;
  const panelW = totalItemW + BUILD_PANEL_PAD * 2;
  const panelH = BUILD_PANEL_TITLE_H + BUILD_PANEL_ITEM_H + BUILD_PANEL_PAD;
  const px = (W - panelW) * 0.5;
  const py = H - BAR_H - panelH - 10;
  const items = BUILD_ITEMS.map((item, i) => ({
    ...item,
    rect: {
      x: px + BUILD_PANEL_PAD + i * (BUILD_PANEL_ITEM_W + BUILD_PANEL_GAP),
      y: py + BUILD_PANEL_TITLE_H,
      w: BUILD_PANEL_ITEM_W,
      h: BUILD_PANEL_ITEM_H,
    } as Rect,
  }));
  return { panel: { x: px, y: py, w: panelW, h: panelH } as Rect, items };
}

// ─── Hit-testing (public) ─────────────────────────────────────────────────────

/** True when the tap lands anywhere on the selection card (excluding action buttons, which are checked first). */
export function hitTestSelectionCard(x: number, y: number, selected: SelectionInfo | null): boolean {
  if (!selected) return false;
  return inRect(x, y, selectionCardRect(window.innerWidth, window.innerHeight));
}

export function hitTestSelectionAction(x: number, y: number, selected: SelectionInfo | null): string | null {
  if (!selected || selected.actions.length === 0) return null;
  const rects = selectionActionRects(window.innerWidth, window.innerHeight, selected.actions.length);
  for (let i = 0; i < rects.length; i++) {
    if (inRect(x, y, rects[i])) return selected.actions[i].id;
  }
  return null;
}

export function hitTestBuildButton(x: number, y: number): boolean {
  return inRect(x, y, buildButtonRect(window.innerWidth, window.innerHeight));
}

/** Returns building type if a card was tapped, "inside" if tapped panel background, null if outside panel. */
export function hitTestBuildPanel(x: number, y: number): BuildingTypeValue | "inside" | null {
  const { panel, items } = buildPanelLayout(window.innerWidth, window.innerHeight);
  if (!inRect(x, y, panel)) return null;
  for (const item of items) {
    if (inRect(x, y, item.rect)) return item.type;
  }
  return "inside";
}

export function hitTestContextCancel(x: number, y: number): boolean {
  return inRect(x, y, contextCancelRect(window.innerWidth, window.innerHeight));
}

export function hitTestIdleAgentButton(x: number, y: number): boolean {
  return inRect(x, y, vibeJamZoneRect(window.innerWidth, window.innerHeight));
}

export function hitTestContextBar(x: number, y: number): boolean {
  return inRect(x, y, bottomBarRect(window.innerWidth, window.innerHeight));
}

export function hitTestContextSelectionAction(x: number, y: number, selected: SelectionInfo | null): string | null {
  if (!selected || selected.actions.length === 0) return null;
  const rects = contextActionRects(window.innerWidth, window.innerHeight, selected.actions.length, false);
  for (let i = 0; i < rects.length; i++) {
    if (inRect(x, y, rects[i]!)) return selected.actions[i]!.id;
  }
  return null;
}

export function hitTestContextBuildAction(x: number, y: number, buildOpen: boolean): BuildingTypeValue | null {
  if (!buildOpen) return null;
  const rects = contextActionRects(window.innerWidth, window.innerHeight, BUILD_ITEMS.length, true);
  for (let i = 0; i < rects.length; i++) {
    if (inRect(x, y, rects[i]!)) return BUILD_ITEMS[i]!.type;
  }
  return null;
}

export function getHudBottomInset(): number {
  return bottomBarRect(window.innerWidth, window.innerHeight).h;
}

// ─── Main draw ────────────────────────────────────────────────────────────────

export function drawHUD(
  canvas: HTMLCanvasElement,
  hud: HudState,
  myColor: number,
  mySquadCount: number,
  idleAgents: IdleAgentHudInfo,
  resources: ResourceCost,
  selected: SelectionInfo | null,
  selectedTile: TileView | null,
  t: number,
  koth: KothState | null,
) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cardKey = selected ? `${selected.title}:${selected.color}` : "";
  if (cardKey !== hud._cardKey) {
    hud._cardKey = cardKey;
    hud._cardEnterT = cardKey ? t : -999;
  }

  if (hud.buildPanelOpen && !hud._panelWasVisible) hud._panelOpenT = t;
  hud._panelWasVisible = hud.buildPanelOpen;

  if (resources.biomass > hud._prevResources.biomass) hud._resourceBounce.biomass = t;
  if (resources.material > hud._prevResources.material) hud._resourceBounce.material = t;
  if (resources.compute > hud._prevResources.compute) hud._resourceBounce.compute = t;
  hud._prevResources = { biomass: resources.biomass, material: resources.material, compute: resources.compute };

  drawMoveMarkers(ctx, hud, t);
  drawWarningToast(ctx, W, H, hud, t);
  drawContextBottomBar(ctx, W, H, myColor, mySquadCount, idleAgents, resources, hud._resourceBounce, selected, selectedTile, hud, t);
  if (koth) drawKothPanel(ctx, W, H, koth, t);
}

export function drawAgentStatusLabels(
  canvas: HTMLCanvasElement,
  labels: AgentStatusLabel[],
): void {
  if (labels.length === 0) return;
  const ctx = canvas.getContext("2d")!;
  for (const label of labels) {
    const h = 14;
    ctx.save();
    const w = 14;
    const x = label.sx - w * 0.5;
    const y = label.sy - h - 3;
    const accent = resourceColor(label.resourceType);
    ctx.fillStyle = "rgba(8, 16, 34, 0.86)";
    rr(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    rr(ctx, x, y, w, h, 6);
    ctx.stroke();
    const icon = resourceIconImage(label.resourceType);
    const drawn = drawResourceIcon(ctx, icon, x + 2, y + 2, 10);
    if (!drawn) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = accent;
      ctx.font = "700 9px system-ui, sans-serif";
      ctx.fillText(resourceGlyph(label.resourceType), label.sx, y + h * 0.5 + 0.5);
    }
    ctx.restore();
  }
}

export function drawFloatingResourceTexts(
  canvas: HTMLCanvasElement,
  texts: Array<{
    sx: number;
    sy: number;
    amount: number;
    resourceType: number;
    age: number;
  }>
): void {
  if (texts.length === 0) return;
  const ctx = canvas.getContext("2d")!;
  for (const text of texts) {
    const life = 1.15;
    const u = Math.max(0, Math.min(1, text.age / life));
    const rise = u * 42;
    const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    const scale = 0.92 + Math.sin(Math.min(1, u / 0.24) * Math.PI) * 0.08;
    const icon = resourceGlyph(text.resourceType);
    const iconImg = resourceIconImage(text.resourceType);
    const color = resourceColor(text.resourceType);
    const label = `+${text.amount} ${resourceLabel(text.resourceType)}`;
    const x = text.sx;
    const y = text.sy - rise;

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = F_NUM_LG;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(6, 12, 28, 0.78)";
    ctx.strokeText(label, 0, 0);
    ctx.fillStyle = MARBLE_TEXT;
    ctx.fillText(label, 0, 0);

    const iconDrawn = drawResourceIcon(ctx, iconImg, -11, -33, 22);
    if (!iconDrawn) {
      ctx.font = "700 18px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(6, 12, 28, 0.85)";
      ctx.strokeText(icon, 0, -18);
      ctx.fillStyle = color;
      ctx.fillText(icon, 0, -18);
    }
    ctx.restore();
  }
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

function resourceLabel(resourceType: number): string {
  switch (resourceType) {
    case CarriedResourceType.MATERIAL: return "material";
    case CarriedResourceType.COMPUTE: return "compute";
    case CarriedResourceType.BIOMASS: return "biomass";
    default: return "resource";
  }
}

function resourceGlyph(resourceType: number): string {
  switch (resourceType) {
    case CarriedResourceType.MATERIAL: return "◼";
    case CarriedResourceType.COMPUTE: return "◈";
    case CarriedResourceType.BIOMASS: return "✿";
    default: return "+";
  }
}

function resourceIconKey(resourceType: number): ResourceIconKey | null {
  switch (resourceType) {
    case CarriedResourceType.MATERIAL: return "material";
    case CarriedResourceType.COMPUTE: return "gpu";
    case CarriedResourceType.BIOMASS: return "biomass";
    default: return null;
  }
}

function resourceIconImage(resourceType: number): HTMLImageElement | null {
  const key = resourceIconKey(resourceType);
  return key ? RESOURCE_ICON_IMAGES[key] : null;
}

function drawResourceIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  size: number
): boolean {
  if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return false;
  ctx.drawImage(img, x, y, size, size);
  return true;
}

function resourceColor(resourceType: number): string {
  switch (resourceType) {
    case CarriedResourceType.MATERIAL: return "#D4A84C";
    case CarriedResourceType.COMPUTE: return DIVINE_CYAN;
    case CarriedResourceType.BIOMASS: return "#59B96A";
    default: return MARBLE_TEXT;
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

function drawContextBottomBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: number,
  count: number,
  idleAgents: IdleAgentHudInfo,
  resources: ResourceCost,
  bounce: HudState["_resourceBounce"],
  selected: SelectionInfo | null,
  selectedTile: TileView | null,
  hud: HudState,
  t: number
) {
  let title = `${count} ${count === 1 ? "Squad" : "Squads"}`;
  let detail = "Tap units to select. Double tap buildable ground to construct.";
  let actions: Array<{ label: string; sub?: string; disabled?: boolean; danger?: boolean; active?: boolean; kind: "selection" | "build"; build?: BuildingTypeValue }> = [];
  const compactActions = hud.buildPanelOpen;

  if (hud.buildPanelOpen) {
    title = "";
    detail = "";
    actions = BUILD_ITEMS.map((item) => ({
      label: item.label,
      sub: formatResourceCost(item.cost),
      disabled: !canAfford(resources, item.cost),
      danger: !canAfford(resources, item.cost),
      kind: "build" as const,
      build: item.type,
    }));
  } else if (selected) {
    title = selected.title;
    const hp = `${Math.ceil(selected.health)} / ${Math.ceil(selected.maxHealth)}`;
    detail = selected.production
      ? `Training ${selected.production.label} x${selected.production.queueCount} · ${Math.ceil(selected.production.remainingMs / 1000)}s left · HP ${hp}`
      : `${selected.detail}  ·  HP ${hp}`;
    actions = selected.actions.map((action) => ({
      label: action.label,
      sub: `${action.queueCount ? `x${action.queueCount} · ` : ""}${action.cost ? formatResourceCost(action.cost) : action.timeMs ? `${Math.ceil(action.timeMs / 1000)}s` : ""}`,
      disabled: action.disabled,
      danger: action.danger,
      active: action.active,
      kind: "selection" as const,
    }));
  } else if (selectedTile) {
    title = selectedTile.isMountain
      ? "Mountain"
      : selectedTile.material > 0
        ? "Forest"
        : selectedTile.maxCompute > 0
          ? "GPU Mine"
          : "Grassland";
    detail = selectedTile.isMountain
      ? "Impassable terrain."
      : selectedTile.material > 0
        ? `Material ${selectedTile.material} / ${selectedTile.maxMaterial}`
        : selectedTile.maxCompute > 0
          ? `Compute ${selectedTile.compute} / ${selectedTile.maxCompute}`
          : "Double tap buildable ground to construct.";
  }

  contextActionCountHint = actions.length;
  contextActionCompactHint = compactActions;
  const rows = contextActionRowCount(W, actions.length, compactActions);
  const bar = bottomBarRect(W, H);
  const rowMid = bar.y + 32;
  const hintY = bar.y + bar.h - 32;
  const selectedSummary = !compactActions && selected !== null;
  const bottomRightAvoid = selectedSummary && W < 980 ? 230 : 0;

  ctx.save();
  ctx.fillStyle = LAPIS_DEEP;
  ctx.fillRect(0, bar.y, W, bar.h);
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, bar.y); ctx.lineTo(W, bar.y); ctx.stroke();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, bar.y + 3); ctx.lineTo(W, bar.y + 3); ctx.stroke();
  ctx.restore();

  drawMeanderStripe(ctx, 0, bar.y + 5, W);
  drawTopResourceStack(ctx, color, resources, bounce, t);

  const summaryX = 16;
  const firstActionX = contextActionRects(W, H, Math.max(1, actions.length), compactActions)[0]?.x ?? contextCancelRect(W, H).x;
  const summaryW = Math.max(90, firstActionX - summaryX - 12);
  const titleY = selectedSummary ? bar.y + bar.h - 64 : rowMid - (rows > 1 ? 7 : 9);
  const detailY = selectedSummary ? bar.y + bar.h - 38 : rowMid + (rows > 1 ? 12 : 11);
  const detailMaxW = selectedSummary
    ? Math.max(120, W - summaryX - 16 - bottomRightAvoid)
    : Math.max(80, summaryW - 16);

  if (!compactActions) {
    ctx.save();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.font = F_CINZEL_MD;
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "0.5px";
    const clippedTitle = clipText(ctx, title, Math.max(80, summaryW - 16));
    ctx.fillText(clippedTitle, summaryX, titleY);
    ctx.fillStyle = MARBLE_DIM;
    ctx.font = F_BODY_XS;
    ctx.letterSpacing = "0px";
    ctx.fillText(clipText(ctx, detail, detailMaxW), summaryX, detailY);
    ctx.restore();
  }

  if (!compactActions && selected?.production) {
    const progressW = Math.max(80, Math.min(selectedSummary ? detailMaxW - 8 : summaryW - 20, W - summaryX - 40 - bottomRightAvoid));
    const progressY = selectedSummary ? bar.y + bar.h - 21 : rowMid + 25;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    rr(ctx, summaryX, progressY, progressW, 8, 2); ctx.fill();
    ctx.strokeStyle = GOLD_DIM;
    ctx.lineWidth = 1;
    rr(ctx, summaryX, progressY, progressW, 8, 2); ctx.stroke();
    ctx.fillStyle = DIVINE_CYAN;
    ctx.shadowColor = CYAN_GLOW;
    ctx.shadowBlur = 7;
    rr(ctx, summaryX, progressY, progressW * selected.production.progress, 8, 2); ctx.fill();
    ctx.restore();
  }

  const actionRects = contextActionRects(W, H, actions.length, compactActions);
  for (let i = 0; i < actions.length; i++) {
    const rect = actionRects[i]!;
    const action = actions[i]!;
    const item = action.kind === "build" && action.build !== undefined ? BUILD_ITEM_THEME[action.build] : null;
    const active = !!action.active || (action.kind === "build" && hud.activeBuildType === action.build);
    const disabled = !!action.disabled;
    const danger = !!action.danger;
    ctx.save();
    ctx.fillStyle = disabled
      ? danger
        ? "rgba(72, 18, 18, 0.95)"
        : "rgba(24, 26, 38, 0.92)"
      : active
        ? GOLD_BRIGHT
        : item?.color ?? "rgba(13, 32, 72, 0.95)";
    ctx.shadowColor = disabled ? (danger ? CRIMSON_GLOW : "transparent") : item?.glow ?? AZURE_GLOW;
    ctx.shadowBlur = disabled ? 0 : 10;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 4); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = active ? GOLD_BRIGHT : disabled ? (danger ? "rgba(255,120,120,0.72)" : "rgba(255,255,255,0.14)") : GOLD_DIM;
    ctx.lineWidth = active ? 2 : 1;
    rr(ctx, rect.x, rect.y, rect.w, rect.h, 4); ctx.stroke();
    ctx.fillStyle = active ? LAPIS_DEEP : danger ? "#FFD0D0" : MARBLE_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (action.kind === "build" && item) {
      ctx.font = "700 17px system-ui, sans-serif";
      ctx.letterSpacing = "0px";
      ctx.fillText(item.icon, rect.x + rect.w * 0.5, rect.y + 11);
      ctx.font = "700 8px 'Cinzel', serif";
      ctx.letterSpacing = "0.2px";
      ctx.fillText(clipText(ctx, action.label, rect.w - 8), rect.x + rect.w * 0.5, rect.y + 26);
      ctx.font = F_BODY_XS;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = active ? "rgba(8,16,34,0.74)" : danger ? "rgba(255, 184, 184, 0.88)" : MARBLE_DIM;
      if (action.sub) ctx.fillText(clipText(ctx, action.sub, rect.w - 8), rect.x + rect.w * 0.5, rect.y + 40);
    } else {
      ctx.font = "700 9px 'Cinzel', serif";
      ctx.letterSpacing = "0.2px";
      ctx.fillText(clipText(ctx, action.label, rect.w - 8), rect.x + rect.w * 0.5, rect.y + 20);
      ctx.font = F_BODY_XS;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = active ? "rgba(8,16,34,0.74)" : danger ? "rgba(255, 184, 184, 0.88)" : MARBLE_DIM;
      if (action.sub) ctx.fillText(clipText(ctx, action.sub, rect.w - 8), rect.x + rect.w * 0.5, rect.y + 39);
    }
    ctx.restore();
  }

  const cancel = contextCancelRect(W, H);
  const cancelActive = selected !== null || selectedTile !== null || hud.buildPanelOpen || hud.activeBuildType !== null;
  ctx.save();
  ctx.fillStyle = cancelActive ? "rgba(140, 18, 18, 0.94)" : "rgba(30, 34, 48, 0.78)";
  rr(ctx, cancel.x, cancel.y, cancel.w, cancel.h, 5); ctx.fill();
  ctx.strokeStyle = cancelActive ? "rgba(255, 80, 80, 0.78)" : GOLD_DIM;
  ctx.lineWidth = 1.5;
  rr(ctx, cancel.x, cancel.y, cancel.w, cancel.h, 5); ctx.stroke();
  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = "900 24px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("X", cancel.x + cancel.w * 0.5, cancel.y + cancel.h * 0.42);
  ctx.font = "700 8px 'Cinzel', serif";
  ctx.letterSpacing = "1px";
  ctx.fillText(cancelActive ? "CLEAR" : "IDLE", cancel.x + cancel.w * 0.5, cancel.y + cancel.h - 10);
  ctx.restore();

  drawVibeJamZoneInfo(ctx, W, bar, color, idleAgents);

  ctx.save();
  ctx.font = F_BODY_XS;
  ctx.fillStyle = MARBLE_MUTED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const hint = hud.buildPanelOpen
    ? "double tap ground to build  ·  tap icon to place  ·  X cancels"
    : selected
      ? ""
      : "tap to select  ·  double tap buildable ground to build  ·  drag to pan";
  const hintMaxW = Math.max(80, cancel.x - 44);
  if (hint) ctx.fillText(clipText(ctx, hint, hintMaxW), 16, hintY);
  ctx.restore();
}

function drawVibeJamZoneInfo(
  ctx: CanvasRenderingContext2D,
  W: number,
  bar: Rect,
  color: number,
  idleAgents: IdleAgentHudInfo,
): void {
  const zone = vibeJamZoneRect(W, bar.y + bar.h);
  const midY = zone.y + zone.h * 0.5;
  const cx = zone.x + zone.w * 0.5;

  ctx.save();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(zone.x - 4, bar.y + 10);
  ctx.lineTo(zone.x - 4, zone.y + zone.h - 4);
  ctx.stroke();
  rr(ctx, zone.x + 6, zone.y + 2, zone.w - 12, zone.h - 6, 6);
  ctx.fillStyle = idleAgents.available ? "rgba(12, 22, 46, 0.96)" : "rgba(20, 24, 34, 0.72)";
  ctx.fill();
  ctx.strokeStyle = idleAgents.available ? CYAN_GLOW : GOLD_DIM;
  rr(ctx, zone.x + 6, zone.y + 2, zone.w - 12, zone.h - 6, 6);
  ctx.stroke();
  drawDiamond(ctx, cx, midY - 11, 8, idleAgents.available ? DIVINE_CYAN : GOLD_BRIGHT);
  ctx.beginPath();
  ctx.arc(cx, midY - 11, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = idleAgents.available ? DIVINE_CYAN : `#${color.toString(16).padStart(6, "0")}`;
  ctx.fill();
  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = F_NUM_SM;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(idleAgents.count), cx, midY + 4);
  ctx.fillStyle = MARBLE_MUTED;
  ctx.font = "600 7px 'Cinzel', serif";
  ctx.letterSpacing = "0.8px";
  ctx.fillText("IDLE", cx, midY + 16);
  ctx.restore();
}

function vibeJamZoneRect(W: number, H: number): Rect {
  const bar = bottomBarRect(W, H);
  return {
    x: W - VIBEJAM_W + 4,
    y: bar.y + 2,
    w: VIBEJAM_W - 8,
    h: Math.max(20, bar.h - 36),
  };
}

function drawTopResourceStack(
  ctx: CanvasRenderingContext2D,
  color: number,
  resources: ResourceCost,
  bounce: HudState["_resourceBounce"],
  t: number
): void {
  const panel = topResourceStackRect();
  ctx.save();
  ctx.fillStyle = "rgba(8, 16, 34, 0.86)";
  rr(ctx, panel.x, panel.y, panel.w, panel.h, 5); ctx.fill();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, panel.x, panel.y, panel.w, panel.h, 5); ctx.stroke();
  drawDiamond(ctx, panel.x + 16, panel.y + 17, 7, `#${color.toString(16).padStart(6, "0")}`);
  ctx.fillStyle = GOLD_TEXT;
  ctx.font = "700 8px 'Cinzel', serif";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "1px";
  ctx.fillText("STOCK", panel.x + 30, panel.y + 17);
  ctx.restore();

  drawMiniResource(ctx, panel.x + 10, panel.y + 34, CarriedResourceType.BIOMASS, "#59B96A", "BIO", resources.biomass, bounce.biomass, t);
  drawMiniResource(ctx, panel.x + 10, panel.y + 52, CarriedResourceType.MATERIAL, "#D4A84C", "MAT", resources.material, bounce.material, t);
  drawMiniResource(ctx, panel.x + 10, panel.y + 70, CarriedResourceType.COMPUTE, DIVINE_CYAN, "GPU", resources.compute, bounce.compute, t);
}

function drawMiniResource(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  resourceType: number,
  color: string,
  label: string,
  value: number,
  bounceT: number,
  t: number
): void {
  const bounceAge = t - bounceT;
  const pulse = bounceAge < 0.45 ? Math.sin((bounceAge / 0.45) * Math.PI) : 0;
  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = pulse * 10;
  ctx.fillRect(x, y - 5, 3, 10);
  ctx.shadowBlur = 0;
  const iconDrawn = drawResourceIcon(ctx, resourceIconImage(resourceType), x + 7, y - 7, 14);
  ctx.fillStyle = MARBLE_MUTED;
  ctx.font = "700 8px 'Cinzel', serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, iconDrawn ? x + 24 : x + 10, y);
  ctx.fillStyle = MARBLE_TEXT;
  ctx.font = F_NUM_SM;
  ctx.textAlign = "right";
  ctx.fillText(String(value), x + 96, y);
  ctx.restore();
}

// ─── Farm world labels ────────────────────────────────────────────────────────

export type FarmWorldLabel = {
  sx: number;
  sy: number;
  farmGrowth: number;
  hasAgent: boolean;
  isHarvesting: boolean;
};

export function drawFarmWorldLabels(
  canvas: HTMLCanvasElement,
  labels: FarmWorldLabel[]
): void {
  if (labels.length === 0) return;
  const ctx = canvas.getContext("2d")!;
  for (const lbl of labels) {
    drawFarmWorldLabel(ctx, lbl);
  }
}

function drawFarmWorldLabel(ctx: CanvasRenderingContext2D, lbl: FarmWorldLabel): void {
  const W = 78;
  const H = 24;
  const x = lbl.sx - W / 2;
  const y = lbl.sy - H / 2;

  ctx.save();

  // Background pill
  ctx.fillStyle = "rgba(8, 16, 34, 0.82)";
  rr(ctx, x, y, W, H, 6);
  ctx.fill();

  // Border — green if active, dim gold otherwise
  ctx.strokeStyle = lbl.hasAgent
    ? "rgba(89, 185, 106, 0.72)"
    : "rgba(201, 145, 30, 0.22)";
  ctx.lineWidth = 1;
  rr(ctx, x, y, W, H, 6);
  ctx.stroke();

  // Growth ring
  const ringX = x + 14;
  const ringY = y + H / 2;
  const ringR = 8;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (lbl.farmGrowth > 0.01) {
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + lbl.farmGrowth * Math.PI * 2);
    ctx.strokeStyle = lbl.farmGrowth >= 0.999 ? "#8BDB65" : "#59B96A";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.font = "600 6px 'Cinzel', serif";
  ctx.fillStyle = "rgba(242,237,215,0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(lbl.farmGrowth * 100)}%`, ringX, ringY);

  // Status text
  ctx.font = "600 8px 'Cinzel', serif";
  ctx.textAlign = "left";
  ctx.fillStyle = lbl.hasAgent ? "#59B96A" : "rgba(242,237,215,0.45)";
  const status = !lbl.hasAgent ? "Idle" : lbl.isHarvesting ? "Harvesting" : "Farming";
  ctx.fillText(status, x + 28, ringY);

  ctx.restore();
}

function drawBottomBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  color: number,
  count: number,
  resources: ResourceCost,
  bounce: HudState["_resourceBounce"],
  hasSelection: boolean,
  hud: HudState,
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
  const cx = 58; // shifted right to leave room for chat button on the left
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
  ctx.fillText(`${count} ${count !== 1 ? "Squads" : "Squad"}`, 80, rowMid);
  ctx.restore();

  // Resource pills — spaced at 164, 268, 372
  drawResourcePill(ctx, 164, rowMid, "#3D9E47", DIVINE_CYAN, "Biomass",  resources.biomass,  bounce.biomass,  t, "B");
  drawResourcePill(ctx, 268, rowMid, "#8A7054", "#D4A84C",   "Material", resources.material, bounce.material, t, "M");
  drawResourcePill(ctx, 372, rowMid, "#00A8CC", DIVINE_CYAN, "Compute",  resources.compute,  bounce.compute,  t, "C");

  // BUILD button
  drawBuildButton(ctx, W, H, hud.buildPanelOpen || hud.activeBuildType !== null, t);

  // Hint text
  ctx.save();
  ctx.font = F_BODY_XS;
  ctx.fillStyle = MARBLE_MUTED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  let hint: string;
  if (hud.activeBuildType !== null && !hud.buildPanelOpen) {
    hint = "tap ground to place  ·  tap BUILD to cancel";
  } else if (hud.buildPanelOpen) {
    hint = "tap a building to place  ·  tap BUILD to cancel";
  } else if (hasSelection) {
    hint = "tap ground → move  ·  tap enemy → attack  ·  tap BUILD → construct";
  } else {
    hint = "tap unit → select  ·  tap BUILD → construct  ·  drag → pan  ·  pinch → zoom  ·  twist → rotate";
  }
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

// ─── Build button ─────────────────────────────────────────────────────────────

function drawBuildButton(ctx: CanvasRenderingContext2D, W: number, H: number, active: boolean, _t: number) {
  const btn = buildButtonRect(W, H);
  ctx.save();
  if (active) {
    ctx.shadowColor = GOLD_BRIGHT;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = active ? GOLD_BRIGHT : "rgba(10, 20, 42, 0.90)";
  rr(ctx, btn.x, btn.y, btn.w, btn.h, 3); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = active ? 2 : 1;
  rr(ctx, btn.x, btn.y, btn.w, btn.h, 3); ctx.stroke();
  ctx.fillStyle = active ? LAPIS_DEEP : GOLD_TEXT;
  ctx.font = "700 10px 'Cinzel', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "2px";
  ctx.fillText("BUILD", btn.x + btn.w * 0.5, btn.y + btn.h * 0.5);
  ctx.restore();
}

// ─── Build panel (fixed bottom) ───────────────────────────────────────────────

function drawBuildPanel(ctx: CanvasRenderingContext2D, W: number, H: number, hud: HudState, t: number) {
  const { panel, items } = buildPanelLayout(W, H);
  const panelAge = Math.max(0, t - hud._panelOpenT);
  const slideT   = panelAge < 0.32 ? easeOutBack(Math.min(1, panelAge / 0.26)) : 1;
  const yOff     = (1 - slideT) * (panel.h + 14);

  ctx.save();
  ctx.translate(0, yOff);

  drawPanel(ctx, panel.x, panel.y, panel.w, panel.h, 5);

  ctx.save();
  ctx.font = "700 11px 'Cinzel', serif";
  ctx.fillStyle = GOLD_TEXT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "4px";
  ctx.fillText("CONSTRUCT", panel.x + panel.w * 0.5, panel.y + 16);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panel.x + 14, panel.y + BUILD_PANEL_TITLE_H);
  ctx.lineTo(panel.x + panel.w - 14, panel.y + BUILD_PANEL_TITLE_H);
  ctx.stroke();
  drawDiamond(ctx, panel.x + 14, panel.y + BUILD_PANEL_TITLE_H, 3, GOLD_BRIGHT);
  drawDiamond(ctx, panel.x + panel.w - 14, panel.y + BUILD_PANEL_TITLE_H, 3, GOLD_BRIGHT);
  ctx.restore();

  for (let i = 0; i < items.length; i++) {
    const item     = items[i];
    const isActive = hud.activeBuildType === item.type;
    const pulse    = isActive ? 1.04 : 1 + 0.025 * Math.sin(t * 2.8 + i * 1.1);
    const glowA    = isActive ? 0.85 : 0.3 + 0.2 * Math.sin(t * 2.2 + i * 1.3);

    ctx.save();
    ctx.shadowColor = isActive ? GOLD_BRIGHT : item.glow;
    ctx.shadowBlur  = 14 * glowA;
    const grad = ctx.createLinearGradient(item.rect.x, item.rect.y, item.rect.x, item.rect.y + item.rect.h);
    grad.addColorStop(0, isActive ? "#C9911E" : item.colorLight);
    grad.addColorStop(1, isActive ? "#7A5A10" : item.color);
    ctx.fillStyle = grad;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.fill();
    ctx.shadowBlur = 0;
    const shine = ctx.createLinearGradient(item.rect.x, item.rect.y, item.rect.x, item.rect.y + item.rect.h * 0.4);
    shine.addColorStop(0, "rgba(255,255,255,0.16)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.fill();
    ctx.strokeStyle = isActive ? GOLD_BRIGHT : "rgba(255,255,255,0.2)";
    ctx.lineWidth = isActive ? 2 : 1.5;
    rr(ctx, item.rect.x, item.rect.y, item.rect.w, item.rect.h, 3); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = `${24 * pulse}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.icon, item.rect.x + item.rect.w * 0.5, item.rect.y + item.rect.h * 0.38);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.font = "600 9px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.letterSpacing = "0.5px";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 4;
    ctx.fillText(item.label, item.rect.x + item.rect.w * 0.5, item.rect.y + item.rect.h - 13);
    ctx.font = F_BODY_XS;
    ctx.letterSpacing = "0px";
    ctx.fillStyle = MARBLE_DIM;
    ctx.shadowBlur = 0;
    ctx.fillText(formatResourceCost(item.cost), item.rect.x + item.rect.w * 0.5, item.rect.y + item.rect.h - 1);
    ctx.restore();
  }

  ctx.restore();
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

// ─── KOTH panel ───────────────────────────────────────────────────────────────

function formatKothTime(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function drawKothPanel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  koth: KothState,
  t: number,
): void {
  const ROW_H = 22;
  const PAD = 10;
  const panelW = 188;
  const headerH = 46;
  const entryCount = koth.entries.length;
  const panelH = headerH + entryCount * ROW_H + PAD;
  const px = W - panelW - 10;
  const py = 10;

  // Panel background
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = LAPIS_MID;
  rr(ctx, px, py, panelW, panelH, 4); ctx.fill();
  ctx.restore();

  // Gold border
  ctx.save();
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 1.5;
  rr(ctx, px, py, panelW, panelH, 4); ctx.stroke();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  rr(ctx, px + 3, py + 3, panelW - 6, panelH - 6, 3); ctx.stroke();
  ctx.restore();

  // Header: "CENTRAL SERVER" label
  ctx.save();
  ctx.font = "700 9px 'Cinzel', serif";
  ctx.fillStyle = DIVINE_CYAN;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "2px";
  ctx.shadowColor = DIVINE_CYAN;
  ctx.shadowBlur = 8;
  ctx.fillText("CENTRAL SERVER", px + panelW / 2, py + 13);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Owner row
  ctx.save();
  const owned = koth.ownerSessionId !== "" && koth.ownerColor !== 0;
  if (owned) {
    const pulse = 0.7 + 0.3 * Math.sin(t * 4.5);
    const or = (koth.ownerColor >> 16) & 0xff;
    const og = (koth.ownerColor >> 8) & 0xff;
    const ob = koth.ownerColor & 0xff;
    ctx.shadowColor = `rgb(${or},${og},${ob})`;
    ctx.shadowBlur = 10 * pulse;
    ctx.font = "600 9px 'Cinzel', serif";
    ctx.fillStyle = `rgb(${or},${og},${ob})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "0.5px";
    ctx.fillText(`⬥ ${koth.ownerName} ⬥`, px + panelW / 2, py + 31);
  } else {
    ctx.font = "600 9px 'Cinzel', serif";
    ctx.fillStyle = MARBLE_MUTED;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "1px";
    ctx.fillText("UNCONTESTED", px + panelW / 2, py + 31);
  }
  ctx.restore();

  // Divider
  ctx.save();
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 8, py + headerH - 2);
  ctx.lineTo(px + panelW - 8, py + headerH - 2);
  ctx.stroke();
  ctx.restore();

  // Leaderboard rows
  for (let i = 0; i < koth.entries.length; i++) {
    const entry = koth.entries[i];
    const rowY = py + headerH + i * ROW_H + ROW_H / 2;
    const er = (entry.color >> 16) & 0xff;
    const eg = (entry.color >> 8) & 0xff;
    const eb = entry.color & 0xff;
    const isOwner = entry.sessionId === koth.ownerSessionId;

    // Row highlight for current owner
    if (isOwner) {
      ctx.save();
      ctx.fillStyle = `rgba(${er},${eg},${eb},0.10)`;
      ctx.fillRect(px + 4, py + headerH + i * ROW_H + 1, panelW - 8, ROW_H - 2);
      ctx.restore();
    }

    // Rank
    ctx.save();
    ctx.font = F_NUM_SM;
    ctx.fillStyle = i === 0 ? GOLD_TEXT : MARBLE_MUTED;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${i + 1}.`, px + 10, rowY);
    ctx.restore();

    // Color dot
    ctx.save();
    ctx.beginPath();
    ctx.arc(px + 32, rowY, 5, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${er},${eg},${eb})`;
    ctx.fill();
    ctx.restore();

    // Player name
    ctx.save();
    ctx.font = isOwner ? "700 10px system-ui, sans-serif" : "11px system-ui, sans-serif";
    ctx.fillStyle = isOwner ? MARBLE_TEXT : MARBLE_DIM;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // Clip long names
    const nameMax = 80;
    let name = entry.name;
    if (ctx.measureText(name).width > nameMax) {
      while (name.length > 0 && ctx.measureText(name + "…").width > nameMax) name = name.slice(0, -1);
      name += "…";
    }
    ctx.fillText(name, px + 42, rowY);
    ctx.restore();

    // Timer — pulsing red when < 30s and owning
    const isLow = entry.timeMs < 30_000 && isOwner;
    ctx.save();
    ctx.font = F_NUM_SM;
    if (isLow) {
      ctx.fillStyle = `rgba(220,60,60,${0.7 + 0.3 * Math.sin(t * 7)})`;
    } else {
      ctx.fillStyle = isOwner ? DIVINE_CYAN : MARBLE_MUTED;
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatKothTime(entry.timeMs), px + panelW - 10, rowY);
    ctx.restore();
  }
}

// ─── Victory overlay ─────────────────────────────────────────────────────────

export function drawVictoryOverlay(
  canvas: HTMLCanvasElement,
  winner: { name: string; color: number; isMe: boolean },
  t: number,
  startT: number
): void {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  const age = t - startT;
  const fadeIn = Math.min(1, age / 0.7);
  if (fadeIn <= 0) return;

  ctx.save();

  // Full-screen dark veil
  ctx.globalAlpha = fadeIn * 0.9;
  ctx.fillStyle = "#030810";
  ctx.fillRect(0, 0, W, H);

  // Scan-line grid — subtle post-AGI digital artifact
  ctx.globalAlpha = fadeIn * 0.035;
  ctx.fillStyle = DIVINE_CYAN;
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = fadeIn;

  // Winner color burst in background
  const wr = (winner.color >> 16) & 0xff;
  const wg = (winner.color >> 8) & 0xff;
  const wb = winner.color & 0xff;
  const burstAlpha = Math.max(0, 0.12 - age * 0.012);
  if (burstAlpha > 0) {
    const radial = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W * 0.6);
    radial.addColorStop(0, `rgba(${wr},${wg},${wb},${burstAlpha})`);
    radial.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, W, H);
  }

  // Meander ornament top
  ctx.save();
  ctx.globalAlpha = fadeIn * 0.6;
  drawMeanderStripe(ctx, W * 0.05, H * 0.28, W * 0.9);
  ctx.restore();

  // "AGI ACHIEVED" — main title
  const titleProgress = age < 0.55 ? easeOutBack(Math.min(1, age / 0.45)) : 1;
  const titleFontSize = Math.round(Math.min(90, W * 0.115));
  ctx.save();
  ctx.translate(W / 2, H * 0.38);
  ctx.scale(titleProgress, titleProgress);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Outer glow passes
  ctx.shadowColor = DIVINE_CYAN;
  ctx.shadowBlur = 60;
  ctx.font = `900 ${titleFontSize}px 'Cinzel Decorative', 'Cinzel', serif`;
  ctx.fillStyle = MARBLE_TEXT;
  ctx.fillText("AGI ACHIEVED", 0, 0);
  ctx.shadowBlur = 0;

  // Sub-label
  ctx.font = `600 ${Math.round(titleFontSize * 0.18)}px 'Cinzel', serif`;
  ctx.fillStyle = DIVINE_CYAN;
  ctx.letterSpacing = "6px";
  ctx.shadowColor = DIVINE_CYAN;
  ctx.shadowBlur = 10;
  ctx.fillText("TECHNOLOGICAL SINGULARITY", 0, titleFontSize * 0.65);
  ctx.shadowBlur = 0;
  ctx.restore();

  // Meander ornament bottom of title
  ctx.save();
  ctx.globalAlpha = fadeIn * 0.6;
  drawMeanderStripe(ctx, W * 0.05, H * 0.48, W * 0.9);
  ctx.restore();

  // Winner block — fades in after 0.6s
  const winnerAge = Math.max(0, age - 0.6);
  const winnerAlpha = Math.min(1, winnerAge / 0.45);
  ctx.save();
  ctx.globalAlpha = winnerAlpha * fadeIn;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // "TRANSCENDED BY" label
  ctx.font = "600 11px 'Cinzel', serif";
  ctx.fillStyle = MARBLE_MUTED;
  ctx.letterSpacing = "4px";
  ctx.fillText("CIVILIZATION TRANSCENDED BY", W / 2, H * 0.545);

  // Player color diamond
  const dotCX = W / 2 - ctx.measureText(winner.name).width * 0.44 - 18;
  ctx.beginPath();
  ctx.moveTo(dotCX, H * 0.588 - 9);
  ctx.lineTo(dotCX + 9, H * 0.588);
  ctx.lineTo(dotCX, H * 0.588 + 9);
  ctx.lineTo(dotCX - 9, H * 0.588);
  ctx.closePath();
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotCX, H * 0.588, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${wr},${wg},${wb})`;
  ctx.shadowColor = `rgb(${wr},${wg},${wb})`;
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Winner name
  ctx.font = `700 ${Math.round(Math.min(36, W * 0.065))}px 'Cinzel', serif`;
  ctx.fillStyle = winner.isMe ? GOLD_TEXT : MARBLE_TEXT;
  ctx.shadowColor = winner.isMe ? GOLD_BRIGHT : `rgb(${wr},${wg},${wb})`;
  ctx.shadowBlur = 22;
  ctx.letterSpacing = "2px";
  ctx.fillText(winner.name, W / 2, H * 0.59);
  ctx.shadowBlur = 0;

  // "YOU WIN" / "DEFEAT" sub-tag
  const outcomeText = winner.isMe ? "VICTORY" : "DEFEAT";
  const outcomeColor = winner.isMe ? GOLD_TEXT : "rgba(220,80,80,0.9)";
  ctx.font = "700 13px 'Cinzel', serif";
  ctx.fillStyle = outcomeColor;
  ctx.letterSpacing = "5px";
  ctx.shadowColor = outcomeColor;
  ctx.shadowBlur = 10;
  ctx.fillText(outcomeText, W / 2, H * 0.635);
  ctx.shadowBlur = 0;

  ctx.restore();

  // Restart countdown — appears after 2s
  const cdAge = Math.max(0, age - 2.0);
  if (cdAge > 0) {
    const cdAlpha = Math.min(1, cdAge / 0.5) * fadeIn;
    const remaining = Math.max(0, Math.ceil(10 - (age - 2.0)));
    ctx.save();
    ctx.globalAlpha = cdAlpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 11px 'Cinzel', serif";
    ctx.fillStyle = MARBLE_MUTED;
    ctx.letterSpacing = "2px";
    ctx.fillText(`NEW BATTLE BEGINS IN  ${remaining}`, W / 2, H * 0.72);
    ctx.restore();
  }

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

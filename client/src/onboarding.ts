import * as THREE from "three";
import { BuildingType, UnitType, getTileCenter } from "../../shared/game-rules.js";
import { CarriedResourceType } from "../../shared/protocol.js";
import type { Game } from "./game.js";
import { getContextBuildActionScreenRect } from "./hud.js";
import { getTerrainHeightAt } from "./terrain.js";

type Rect = { x: number; y: number; w: number; h: number };
type ButtonId = "start" | "skip" | "done";

type OnboardingTarget = {
  x: number;
  z: number;
  label: string;
  tone: "farm" | "agent" | "build" | "gpu" | "server" | "unit";
  radius?: number;
};

type ScreenTarget = {
  x: number;
  y: number;
  label: string;
  tone: OnboardingTarget["tone"];
  radius: number;
};

type OnboardingStep = {
  id: string;
  title: string;
  body: string;
  target: (game: Game) => OnboardingTarget | null;
  complete: (game: Game) => boolean;
};

const STORAGE_KEY = "agi-of-mythology:onboarding:v1";
const STARTING_AGENT_COUNT = 3;
const CARD_W = 336;
const CARD_PAD = 14;
const SAFE_EDGE = 44;
const TEMP_V = new THREE.Vector3();

const STEPS: OnboardingStep[] = [
  {
    id: "build-farm",
    title: "Build a farm",
    body: "Double tap bright ground, then choose Farm.",
    target: (game) => {
      const farm = game.getMyBuildingsOfType(BuildingType.FARM)[0];
      if (farm) {
        const center = farm.getWorldCenter();
        return { ...center, label: "FARM", tone: "farm", radius: 18 };
      }
      const tile = game.getRecommendedBuildTileNear();
      if (!tile) return null;
      const center = getTileCenter(tile.tx, tile.tz);
      return { x: center.x, z: center.z, label: "BUILD", tone: "build", radius: 16 };
    },
    complete: (game) => game.getMyBuildingsOfType(BuildingType.FARM).length > 0,
  },
  {
    id: "assign-farm",
    title: "Put an agent on it",
    body: "Tap an agent, then tap the farm.",
    target: (game) => {
      const farm = game.getMyBuildingsOfType(BuildingType.FARM)[0];
      const center = farm?.getWorldCenter() ?? game.getFirstIdleAgentBlob()?.getPredictedWorldCenter();
      if (!center) return null;
      return { ...center, label: farm ? "FARM" : "AGENT", tone: farm ? "farm" : "agent", radius: farm ? 18 : 14 };
    },
    complete: (game) => {
      const farm = game.getMyBuildingsOfType(BuildingType.FARM)[0];
      return !!farm && game.hasMyGathererForBuilding(farm.id);
    },
  },
  {
    id: "train-agent",
    title: "Make another agent",
    body: "Tap your Town Center. Train Agent.",
    target: (game) => {
      const tc = game.getMyTownCenterEntity();
      const center = tc?.getWorldCenter() ?? game.getMyTownCenterPosition();
      return center ? { ...center, label: "BASE", tone: "unit", radius: 22 } : null;
    },
    complete: (game) =>
      game.getMyUnitCount(UnitType.VILLAGER) > STARTING_AGENT_COUNT ||
      game.hasQueuedUnit(UnitType.VILLAGER),
  },
  {
    id: "build-barracks",
    title: "Add a barracks",
    body: "Double tap ground again, then choose Barracks.",
    target: (game) => {
      const barracks = game.getMyBuildingsOfType(BuildingType.BARRACKS)[0];
      if (barracks) {
        const center = barracks.getWorldCenter();
        return { ...center, label: "BARR", tone: "build", radius: 20 };
      }
      const tile = game.getRecommendedBuildTileNear();
      if (!tile) return null;
      const center = getTileCenter(tile.tx, tile.tz);
      return { x: center.x, z: center.z, label: "BUILD", tone: "build", radius: 16 };
    },
    complete: (game) => game.getMyBuildingsOfType(BuildingType.BARRACKS).length > 0,
  },
  {
    id: "train-hoplite",
    title: "Train fighters",
    body: "Tap the Barracks. Train Hoplite.",
    target: (game) => {
      const barracks = game.getMyBuildingsOfType(BuildingType.BARRACKS)[0];
      const center = barracks?.getWorldCenter();
      return center ? { ...center, label: "BARR", tone: "unit", radius: 20 } : null;
    },
    complete: (game) =>
      game.getMyUnitCount(UnitType.WARBAND) > 0 ||
      game.hasQueuedUnit(UnitType.WARBAND),
  },
  {
    id: "mine-gpu",
    title: "Mine a GPU",
    body: "Select an agent, then tap the GPU site. The edge marker points to it.",
    target: (game) => {
      const tile = game.getNearestResourceTile(CarriedResourceType.COMPUTE);
      if (!tile) return null;
      const center = getTileCenter(tile.tx, tile.tz);
      return { x: center.x, z: center.z, label: "GPU", tone: "gpu", radius: 18 };
    },
    complete: (game) => game.hasMyGathererForResource(CarriedResourceType.COMPUTE),
  },
  {
    id: "objective",
    title: "Capture the server",
    body: "Send fighters to the center. Hold the server until your timer wins.",
    target: () => ({ x: 0, z: 0, label: "GO", tone: "server", radius: 34 }),
    complete: () => false,
  },
];

export class OnboardingController {
  private completed = readCompleted();
  private started = false;
  private stepIndex = 0;
  private buttons: Array<Rect & { id: ButtonId }> = [];
  private lastStepId = "";
  private stepEnteredAt = performance.now() / 1000;

  public isComplete(): boolean {
    return this.completed;
  }

  public handlePointerUp(x: number, y: number): boolean {
    if (this.completed) return false;
    const button = this.buttons.find((candidate) => inRect(x, y, candidate));
    if (!button) return false;
    if (button.id === "skip" || button.id === "done") {
      this.complete();
    } else if (button.id === "start") {
      this.started = true;
      this.stepEnteredAt = performance.now() / 1000;
    }
    return true;
  }

  public draw(
    canvas: HTMLCanvasElement,
    game: Game,
    camera: THREE.Camera,
    nowSec: number,
    ui: { buildPanelOpen: boolean }
  ): void {
    if (this.completed) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.buttons = [];

    if (!this.started) {
      this.drawWelcome(ctx, canvas.width, canvas.height, nowSec);
      return;
    }

    this.advancePastCompletedSteps(game, nowSec);
    const step = STEPS[this.stepIndex];
    if (!step) {
      this.complete();
      return;
    }

    if (step.id !== this.lastStepId) {
      this.lastStepId = step.id;
      this.stepEnteredAt = nowSec;
    }

    const target = step.target(game);
    const screenTarget = ui.buildPanelOpen ? this.getScreenTarget(step) : null;
    const projected = target ? projectTarget(target, game, camera, canvas) : null;
    if (target && projected) {
      this.drawTargetPointer(ctx, canvas.width, canvas.height, target, projected, nowSec);
    }
    if (screenTarget) {
      this.drawScreenTarget(ctx, screenTarget, nowSec);
    }
    this.drawCoach(ctx, canvas.width, canvas.height, step, target, projected, nowSec);
  }

  private getScreenTarget(step: OnboardingStep): ScreenTarget | null {
    const buildType =
      step.id === "build-farm"
        ? BuildingType.FARM
        : step.id === "build-barracks"
          ? BuildingType.BARRACKS
          : null;
    if (buildType === null) return null;
    const rect = getContextBuildActionScreenRect(buildType);
    if (!rect) return null;
    return {
      x: rect.x + rect.w * 0.5,
      y: rect.y + rect.h * 0.5,
      label: buildType === BuildingType.FARM ? "FARM" : "BARR",
      tone: "build",
      radius: Math.max(rect.w, rect.h) * 0.54,
    };
  }

  private advancePastCompletedSteps(game: Game, nowSec: number): void {
    while (this.stepIndex < STEPS.length - 1 && STEPS[this.stepIndex]?.complete(game)) {
      this.stepIndex += 1;
      this.stepEnteredAt = nowSec;
      this.lastStepId = STEPS[this.stepIndex]?.id ?? "";
    }
  }

  private complete(): void {
    this.completed = true;
    try {
      window.localStorage?.setItem(STORAGE_KEY, "complete");
    } catch {
      // Storage can be unavailable in private contexts. Completing for this session is enough.
    }
  }

  private drawWelcome(ctx: CanvasRenderingContext2D, W: number, H: number, nowSec: number): void {
    const w = Math.min(CARD_W, W - 24);
    const h = 154;
    const x = 14;
    const y = Math.max(76, H - h - 132);
    drawBubble(ctx, x, y, w, h, nowSec);
    ctx.fillStyle = "oklch(23% 0.07 228)";
    ctx.font = "800 18px system-ui, sans-serif";
    ctx.fillText("First mission", x + CARD_PAD, y + 30);
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = "oklch(34% 0.055 228)";
    wrapText(ctx, "Build, gather, train, then take the central server.", x + CARD_PAD, y + 58, w - CARD_PAD * 2, 18);
    this.drawButton(ctx, "start", "Show me", x + CARD_PAD, y + h - 50, 112, 36, true);
    this.drawButton(ctx, "skip", "Skip", x + CARD_PAD + 122, y + h - 50, 82, 36, false);
  }

  private drawCoach(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    step: OnboardingStep,
    target: OnboardingTarget | null,
    projected: ProjectedTarget | null,
    nowSec: number
  ): void {
    const w = Math.min(CARD_W, W - 24);
    const h = step.id === "objective" ? 154 : 132;
    const preferTop = projected?.onScreen && projected.y > H * 0.58;
    const x = W < 520 ? 12 : 18;
    const y = preferTop ? 78 : Math.max(72, H - h - 132);

    drawBubble(ctx, x, y, w, h, nowSec - this.stepEnteredAt);
    ctx.fillStyle = toneColor(target?.tone ?? "build");
    ctx.font = "900 11px system-ui, sans-serif";
    ctx.fillText(`${this.stepIndex + 1}/${STEPS.length}`, x + CARD_PAD, y + 20);

    ctx.fillStyle = "oklch(22% 0.07 228)";
    ctx.font = "800 17px system-ui, sans-serif";
    ctx.fillText(step.title, x + CARD_PAD, y + 44);
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = "oklch(34% 0.055 228)";
    const body = target ? step.body : "Loading nearby targets...";
    wrapText(ctx, body, x + CARD_PAD, y + 68, w - CARD_PAD * 2, 18);

    const skipW = 58;
    this.drawButton(ctx, "skip", "Skip", x + w - skipW - CARD_PAD, y + 12, skipW, 28, false);
    if (step.id === "objective") {
      this.drawButton(ctx, "done", "Got it", x + CARD_PAD, y + h - 48, 100, 34, true);
    }
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    id: ButtonId,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    primary: boolean
  ): void {
    this.buttons.push({ id, x, y, w, h });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h * 0.5);
    ctx.fillStyle = primary ? "oklch(71% 0.18 145)" : "oklch(94% 0.025 220)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary ? "oklch(47% 0.16 145)" : "oklch(78% 0.045 220)";
    ctx.stroke();
    ctx.fillStyle = primary ? "oklch(20% 0.055 145)" : "oklch(34% 0.055 228)";
    ctx.font = "800 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w * 0.5, y + h * 0.5);
    ctx.restore();
  }

  private drawTargetPointer(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    target: OnboardingTarget,
    projected: ProjectedTarget,
    nowSec: number
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 4.2);
    const color = toneColor(target.tone);
    if (projected.onScreen) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, (target.radius ?? 18) + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, (target.radius ?? 18) + pulse * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const angle = Math.atan2(projected.rawY - H * 0.5, projected.rawX - W * 0.5);
    const size = 42;
    ctx.save();
    ctx.translate(projected.x, projected.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = "oklch(98% 0.018 105)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(size * 0.66, 0);
    ctx.lineTo(-size * 0.36, -size * 0.5);
    ctx.lineTo(-size * 0.12, 0);
    ctx.lineTo(-size * 0.36, size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-angle);
    ctx.fillStyle = "oklch(22% 0.07 228)";
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "oklch(98% 0.018 105)";
    ctx.font = target.label.length > 2 ? "800 9px system-ui, sans-serif" : "900 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(target.label, 0, 0.5);
    ctx.restore();
  }

  private drawScreenTarget(ctx: CanvasRenderingContext2D, target: ScreenTarget, nowSec: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 4.6);
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = toneColor(target.tone);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "oklch(98% 0.018 105 / 0.92)";
    ctx.beginPath();
    ctx.roundRect(target.x - 24, target.y - target.radius - 32, 48, 22, 11);
    ctx.fill();
    ctx.fillStyle = "oklch(22% 0.07 228)";
    ctx.font = "900 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(target.label, target.x, target.y - target.radius - 21);
    ctx.restore();
  }
}

type ProjectedTarget = {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  onScreen: boolean;
};

function projectTarget(
  target: OnboardingTarget,
  game: Game,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement
): ProjectedTarget {
  const y = getTerrainHeightAt(target.x, target.z, game.getTiles()) + 4;
  TEMP_V.set(target.x, y, target.z).project(camera);
  const rawX = (TEMP_V.x * 0.5 + 0.5) * canvas.width;
  const rawY = (-TEMP_V.y * 0.5 + 0.5) * canvas.height;
  const onScreen =
    TEMP_V.z >= -1 &&
    TEMP_V.z <= 1 &&
    rawX >= SAFE_EDGE &&
    rawX <= canvas.width - SAFE_EDGE &&
    rawY >= SAFE_EDGE &&
    rawY <= canvas.height - SAFE_EDGE;

  if (onScreen) return { x: rawX, y: rawY, rawX, rawY, onScreen };

  const dx = rawX - canvas.width * 0.5;
  const dy = rawY - canvas.height * 0.5;
  const scale = edgeScale(dx, dy, canvas.width, canvas.height);
  return {
    x: canvas.width * 0.5 + dx * scale,
    y: canvas.height * 0.5 + dy * scale,
    rawX,
    rawY,
    onScreen: false,
  };
}

function edgeScale(dx: number, dy: number, W: number, H: number): number {
  const halfW = W * 0.5 - SAFE_EDGE;
  const halfH = H * 0.5 - SAFE_EDGE;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return 1;
  return Math.min(Math.abs(halfW / dx) || Infinity, Math.abs(halfH / dy) || Infinity, 1);
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.25 + t * 5);
  ctx.fillStyle = "oklch(97% 0.035 104 / 0.94)";
  ctx.strokeStyle = "oklch(72% 0.13 120 / 0.88)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 22);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

function toneColor(tone: OnboardingTarget["tone"]): string {
  switch (tone) {
    case "farm":
      return "oklch(72% 0.17 132)";
    case "agent":
      return "oklch(73% 0.15 75)";
    case "gpu":
      return "oklch(73% 0.14 238)";
    case "server":
      return "oklch(71% 0.18 24)";
    case "unit":
      return "oklch(70% 0.16 52)";
    default:
      return "oklch(70% 0.16 145)";
  }
}

function inRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function readCompleted(): boolean {
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === "complete";
  } catch {
    return false;
  }
}

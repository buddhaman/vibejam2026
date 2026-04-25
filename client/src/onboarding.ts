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

const STARTING_AGENT_COUNT = 3;
const CARD_W = 336;
const CARD_PAD = 14;
const SAFE_EDGE = 44;
const TEMP_V = new THREE.Vector3();
const TEMP_CAMERA_SPACE = new THREE.Vector3();

const LAPIS_DEEP = "rgba(8, 16, 34, 0.96)";
const MARBLE_TEXT = "#F2EDD7";
const GOLD_BRIGHT = "#C9911E";
const GOLD_TEXT = "#F0C060";
const DIVINE_CYAN = "#00D4FF";

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
      const tile = game.getRecommendedBuildTileNear(BuildingType.FARM);
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
      const tile = game.getRecommendedBuildTileNear(BuildingType.BARRACKS);
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
  private completed = false;
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
  }

  private drawWelcome(ctx: CanvasRenderingContext2D, W: number, H: number, nowSec: number): void {
    const w = Math.min(CARD_W, W - 24);
    const h = 154;
    const x = 14;
    const y = Math.max(76, H - h - 132);
    drawBubble(ctx, x, y, w, h, nowSec);
    ctx.fillStyle = GOLD_TEXT;
    ctx.font = "700 18px 'Cinzel', Georgia, serif";
    ctx.fillText("First mission", x + CARD_PAD, y + 30);
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = MARBLE_TEXT;
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
    ctx.font = "700 11px 'Cinzel', Georgia, serif";
    ctx.fillText(`${this.stepIndex + 1}/${STEPS.length}`, x + CARD_PAD, y + 20);

    ctx.fillStyle = GOLD_TEXT;
    ctx.font = "700 16px 'Cinzel', Georgia, serif";
    ctx.fillText(step.title, x + CARD_PAD, y + 44);
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = MARBLE_TEXT;
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
    ctx.roundRect(x, y, w, h, 4);
    ctx.fillStyle = primary ? "rgba(201, 145, 30, 0.92)" : "rgba(242, 237, 215, 0.08)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = primary ? GOLD_TEXT : "rgba(242, 237, 215, 0.28)";
    ctx.stroke();
    ctx.fillStyle = primary ? LAPIS_DEEP : MARBLE_TEXT;
    ctx.font = "700 12px 'Cinzel', Georgia, serif";
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
      ctx.globalAlpha = 0.76;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, (target.radius ?? 18) + pulse * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.2;
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
    ctx.strokeStyle = MARBLE_TEXT;
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
    ctx.fillStyle = LAPIS_DEEP;
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.font = target.label.length > 2 ? "700 9px 'Cinzel', Georgia, serif" : "700 12px 'Cinzel', Georgia, serif";
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
    ctx.fillStyle = LAPIS_DEEP;
    ctx.beginPath();
    ctx.roundRect(target.x - 24, target.y - target.radius - 32, 48, 22, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(242, 237, 215, 0.38)";
    ctx.stroke();
    ctx.fillStyle = MARBLE_TEXT;
    ctx.font = "700 9px 'Cinzel', Georgia, serif";
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
  TEMP_V.set(target.x, y, target.z);
  TEMP_CAMERA_SPACE.copy(TEMP_V).applyMatrix4(camera.matrixWorldInverse);
  const behindCamera = TEMP_CAMERA_SPACE.z > 0;
  TEMP_V.project(camera);

  let ndcX = Number.isFinite(TEMP_V.x) ? TEMP_V.x : 0;
  let ndcY = Number.isFinite(TEMP_V.y) ? TEMP_V.y : 0;
  if (behindCamera) {
    ndcX = -ndcX;
    ndcY = -ndcY;
    if (Math.abs(ndcX) < 0.01 && Math.abs(ndcY) < 0.01) {
      ndcX = TEMP_CAMERA_SPACE.x >= 0 ? 1 : -1;
      ndcY = TEMP_CAMERA_SPACE.y >= 0 ? -0.2 : 0.2;
    }
  }

  const rawX = (ndcX * 0.5 + 0.5) * canvas.width;
  const rawY = (-ndcY * 0.5 + 0.5) * canvas.height;
  const onScreen =
    !behindCamera &&
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
  ctx.fillStyle = LAPIS_DEEP;
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(242, 237, 215, 0.05)";
  ctx.beginPath();
  ctx.roundRect(x + 5, y + 5, w - 10, h - 10, 4);
  ctx.fill();
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
      return "#8BDB65";
    case "agent":
      return GOLD_TEXT;
    case "gpu":
      return DIVINE_CYAN;
    case "server":
      return "#FF4040";
    case "unit":
      return GOLD_TEXT;
    default:
      return DIVINE_CYAN;
  }
}

function inRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}


import * as THREE from "three";
import { GAME_RULES, SquadSpread, type SquadSpread as SquadSpreadValue, getSquadAxes } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { getTerrainHeightAt } from "./terrain.js";

const UNIT_GEOM = new THREE.CylinderGeometry(
  GAME_RULES.UNIT_RADIUS,
  GAME_RULES.UNIT_RADIUS * 0.92,
  GAME_RULES.UNIT_HEIGHT,
  10
);
const UNIT_MAT = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.82,
  metalness: 0.02,
});
const OVAL_FILL_GEOM = new THREE.CircleGeometry(1, 48);
const OVAL_FILL_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
});
const OVAL_RING_GEOM = new THREE.RingGeometry(0.93, 1, 64);
const OVAL_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.26,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const DUMMY = new THREE.Object3D();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const VISUAL_STEP = 1 / 120;
const VISUAL_CATCHUP = 12;
const DIRECTION_SMOOTHING = 7;
const MIN_DIRECTION_SPEED = 0.2;

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private units!: THREE.InstancedMesh;
  private ovalFill!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private ovalRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private blob: {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    vx: number;
    vy: number;
    ownerId: string;
    unitCount: number;
    health: number;
    spread: SquadSpreadValue;
  } | null = null;
  private heading = 0;
  private visualX: number | null = null;
  private visualY: number | null = null;
  private visualVx = 0;
  private visualVy = 0;
  private visualTime = 0;
  private forwardX = 0;
  private forwardY = 1;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): THREE.Group {
    this.units = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), 256);
    this.units.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.units.castShadow = true;
    this.units.receiveShadow = true;

    this.ovalFill = new THREE.Mesh(OVAL_FILL_GEOM, OVAL_FILL_MAT.clone());
    this.ovalFill.rotation.x = -Math.PI / 2;
    this.ovalFill.position.y = 0.02;

    this.ovalRing = new THREE.Mesh(OVAL_RING_GEOM, OVAL_RING_MAT.clone());
    this.ovalRing.rotation.x = -Math.PI / 2;
    this.ovalRing.position.y = 0.03;

    const group = new THREE.Group();
    group.add(this.ovalFill);
    group.add(this.ovalRing);
    group.add(this.units);
    return group;
  }

  public sync(blob: {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    vx: number;
    vy: number;
    ownerId: string;
    unitCount: number;
    health: number;
    spread: SquadSpreadValue;
  }): void {
    this.blob = blob;
    if (this.visualX === null || this.visualY === null) {
      this.visualX = blob.x;
      this.visualY = blob.y;
      this.visualVx = blob.vx;
      this.visualVy = blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (speed > MIN_DIRECTION_SPEED) {
        this.forwardX = blob.vx / speed;
        this.forwardY = blob.vy / speed;
      }
    }
  }

  private getPredictedCenter() {
    if (!this.blob || this.visualX === null || this.visualY === null) return { x: 0, y: 0, vx: 0, vy: 0 };
    return {
      x: this.visualX + this.visualVx * GAME_RULES.CLIENT_PREDICTION_LEAD,
      y: this.visualY + this.visualVy * GAME_RULES.CLIENT_PREDICTION_LEAD,
      vx: this.visualVx,
      vy: this.visualVy,
    };
  }

  private stepVisual(dt: number): void {
    if (!this.blob || this.visualX === null || this.visualY === null) return;

    this.visualX += this.visualVx * dt;
    this.visualY += this.visualVy * dt;

    const targetX = this.blob.x;
    const targetY = this.blob.y;
    const errorX = targetX - this.visualX;
    const errorY = targetY - this.visualY;
    const error = Math.hypot(errorX, errorY);

    if (error > 5) {
      this.visualX = targetX;
      this.visualY = targetY;
    } else {
      const pull = Math.min(1, dt * VISUAL_CATCHUP);
      this.visualX += errorX * pull;
      this.visualY += errorY * pull;
    }

    this.visualVx += (this.blob.vx - this.visualVx) * Math.min(1, dt * 14);
    this.visualVy += (this.blob.vy - this.visualVy) * Math.min(1, dt * 14);

    const desiredDirX = this.visualVx;
    const desiredDirY = this.visualVy;
    const desiredSpeed = Math.hypot(desiredDirX, desiredDirY);
    const fallbackX = this.blob.targetX - this.visualX;
    const fallbackY = this.blob.targetY - this.visualY;
    const fallbackDist = Math.hypot(fallbackX, fallbackY);

    let nextForwardX = this.forwardX;
    let nextForwardY = this.forwardY;
    if (desiredSpeed > MIN_DIRECTION_SPEED) {
      nextForwardX = desiredDirX / desiredSpeed;
      nextForwardY = desiredDirY / desiredSpeed;
    } else if (fallbackDist > 0.5) {
      nextForwardX = fallbackX / fallbackDist;
      nextForwardY = fallbackY / fallbackDist;
    }

    const turn = Math.min(1, dt * DIRECTION_SMOOTHING);
    this.forwardX += (nextForwardX - this.forwardX) * turn;
    this.forwardY += (nextForwardY - this.forwardY) * turn;
    const forwardLen = Math.hypot(this.forwardX, this.forwardY);
    if (forwardLen > 0.0001) {
      this.forwardX /= forwardLen;
      this.forwardY /= forwardLen;
    } else {
      this.forwardX = 0;
      this.forwardY = 1;
    }
  }

  private getLayout() {
    if (!this.blob) {
      return { x: 0, y: 0, major: 1, minor: 1, heading: this.heading };
    }

    const center = this.getPredictedCenter();
    const tx = this.blob.targetX - center.x;
    const ty = this.blob.targetY - center.y;
    const speed = Math.hypot(center.vx, center.vy);
    const moveDistance = Math.hypot(tx, ty);

    this.heading = Math.atan2(this.forwardX, this.forwardY);

    const { major, minor } = getSquadAxes(this.blob.unitCount, moveDistance, speed, this.blob.spread);
    return { x: center.x, y: center.y, major, minor, heading: this.heading };
  }

  public render(dt: number): void {
    if (!this.blob) return;

    this.visualTime += Math.min(0.05, dt);
    while (this.visualTime >= VISUAL_STEP) {
      this.stepVisual(VISUAL_STEP);
      this.visualTime -= VISUAL_STEP;
    }
    if (this.visualTime > 0) {
      this.stepVisual(this.visualTime);
      this.visualTime = 0;
    }

    const layout = this.getLayout();
    const terrainY = getTerrainHeightAt(layout.x, layout.y, (this.game.room.state as { terrainSeed: number }).terrainSeed);
    const color = this.game.getPlayerColor(this.blob.ownerId);
    const tint = new THREE.Color(color);

    this.mesh.position.set(layout.x, terrainY, layout.y);
    this.mesh.rotation.y = layout.heading;

    this.ovalFill.scale.set(layout.minor, layout.major, 1);
    this.ovalRing.scale.set(layout.minor * 1.04, layout.major * 1.04, 1);
    this.ovalFill.material.color.copy(tint).offsetHSL(0, 0.06, 0.1);
    this.ovalRing.material.color.copy(tint).offsetHSL(0, 0.03, this.isSelected() ? 0.18 : 0.08);
    this.ovalFill.material.opacity = this.isMine() ? 0.12 : 0.07;
    this.ovalRing.material.opacity = this.isSelected() ? 0.65 : this.isMine() ? 0.22 : 0.12;

    const unitsMaterial = this.units.material as THREE.MeshStandardMaterial;
    unitsMaterial.color.copy(tint).offsetHSL(0, 0.02, 0.02);
    unitsMaterial.opacity = this.isMine() ? 1 : 0.68;
    unitsMaterial.transparent = !this.isMine();

    this.units.count = Math.min(this.blob.unitCount, this.units.instanceMatrix.count);

    const unitHeight = GAME_RULES.UNIT_HEIGHT;
    for (let i = 0; i < this.units.count; i++) {
      const t = (i + 0.5) / this.units.count;
      const radius = Math.sqrt(t);
      const angle = i * GOLDEN_ANGLE;
      const px = Math.cos(angle) * radius * layout.minor * 0.82;
      const pz = Math.sin(angle) * radius * layout.major * 0.82;
      DUMMY.position.set(px, unitHeight * 0.5 + 0.02, pz);
      DUMMY.rotation.y = layout.heading;
      DUMMY.updateMatrix();
      this.units.setMatrixAt(i, DUMMY.matrix);
    }
    this.units.instanceMatrix.needsUpdate = true;
  }

  public isMine(): boolean {
    return this.blob !== null && this.game.isMyBlob(this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.isMine() && this.game.selectedEntityId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    const layout = this.getLayout();
    const cos = Math.cos(-this.heading);
    const sin = Math.sin(-this.heading);
    const lx = (x - layout.x) * cos - (z - layout.y) * sin;
    const lz = (x - layout.x) * sin + (z - layout.y) * cos;
    return (lx * lx) / (layout.minor * layout.minor) + (lz * lz) / (layout.major * layout.major) <= 1.05;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.blob) return Infinity;
    const center = this.getPredictedCenter();
    return Math.hypot(x - center.x, z - center.y);
  }

  public getOwnerId(): string | null {
    return this.blob?.ownerId ?? null;
  }

  public getUnitCount(): number {
    return this.blob?.unitCount ?? 0;
  }

  public getHealth(): number {
    return this.blob?.health ?? 0;
  }

  public isStale(): boolean {
    return !this.game.room.state.blobs.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.isMine();
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.blob) return null;
    return {
      title: "Squad",
      detail: `${this.blob.unitCount} units`,
      health: this.blob.health,
      maxHealth: 100,
      color: this.game.getPlayerColor(this.blob.ownerId),
      actions: this.isMine()
        ? [
            { id: "spread:tight", label: "Tight", active: this.blob.spread === SquadSpread.TIGHT },
            { id: "spread:default", label: "Default", active: this.blob.spread === SquadSpread.DEFAULT },
            { id: "spread:wide", label: "Wide", active: this.blob.spread === SquadSpread.WIDE },
          ]
        : [],
    };
  }
}

import * as THREE from "three";
import {
  GAME_RULES,
  SquadSpread,
  UnitType,
  getSquadAxes,
  getUnitRules,
  type SquadSpread as SquadSpreadValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { getTerrainHeightAt } from "./terrain.js";

function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const position = nonIndexed.getAttribute("position");
    const normal = nonIndexed.getAttribute("normal");
    const uv = nonIndexed.getAttribute("uv");

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (uv) {
        uvs.push(uv.getX(i), uv.getY(i));
      } else {
        uvs.push(0, 0);
      }
    }
  }

  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return merged;
}

function createUnitBodyGeometry() {
  const torsoHeight = GAME_RULES.UNIT_HEIGHT * 0.72;
  const torsoWidth = GAME_RULES.UNIT_RADIUS * 1.12;
  const torsoDepth = GAME_RULES.UNIT_RADIUS * 0.72;
  const headRadius = GAME_RULES.UNIT_RADIUS * 0.34;
  const torso = new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth);
  torso.translate(0, torsoHeight * 0.5, 0);

  const head = new THREE.SphereGeometry(headRadius, 12, 10);
  head.translate(0, torsoHeight + headRadius * 1.6, 0);

  return mergeBufferGeometries([torso, head]);
}

const UNIT_GEOM = createUnitBodyGeometry();
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
const DIRECTION_SMOOTHING = 3.2;
const MIN_DIRECTION_SPEED = 0.2;
const UNIT_SPRING = 20;
const UNIT_DAMPING = 0.24;
const UNIT_WALK_SPEED = 4.4;

type UnitState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
};

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private ovalRoot!: THREE.Group;
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
    unitType: UnitTypeValue;
  } | null = null;
  private heading = 0;
  private visualX: number | null = null;
  private visualY: number | null = null;
  private visualVx = 0;
  private visualVy = 0;
  private visualTime = 0;
  private forwardX = 0;
  private forwardY = 1;
  private unitStates: UnitState[] = [];

  // Target destination indicator
  private targetGroup!: THREE.Group;
  private targetPinRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetPingMesh!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetDisc!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private targetConnector!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private pingPhase = Math.random(); // stagger so multiple blobs don't pulse in sync
  private targetAnimT = 0;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected override init(): void {
    super.init();
    this.buildTargetIndicator();
    this.game.scene.add(this.targetGroup);
    this.game.scene.add(this.targetConnector);
  }

  public override destroy(): void {
    this.game.scene.remove(this.targetGroup);
    this.game.scene.remove(this.targetConnector);
    super.destroy();
  }

  protected createMesh(): THREE.Group {
    this.units = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), 256);
    this.units.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.units.castShadow = true;
    this.units.receiveShadow = true;

    this.ovalRoot = new THREE.Group();

    this.ovalFill = new THREE.Mesh(OVAL_FILL_GEOM, OVAL_FILL_MAT.clone());
    this.ovalFill.rotation.x = -Math.PI / 2;
    this.ovalFill.position.y = 0.02;

    this.ovalRing = new THREE.Mesh(OVAL_RING_GEOM, OVAL_RING_MAT.clone());
    this.ovalRing.rotation.x = -Math.PI / 2;
    this.ovalRing.position.y = 0.03;

    this.ovalRoot.add(this.ovalFill);
    this.ovalRoot.add(this.ovalRing);

    const group = new THREE.Group();
    group.add(this.ovalRoot);
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
    unitType: UnitTypeValue;
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

  private ensureUnitStateCount(count: number): void {
    while (this.unitStates.length < count) {
      this.unitStates.push({ x: 0, z: 0, vx: 0, vz: 0 });
    }
    if (this.unitStates.length > count) {
      this.unitStates.length = count;
    }
  }

  private getSlotPosition(index: number, count: number, major: number, minor: number) {
    const t = (index + 0.5) / Math.max(1, count);
    const radius = Math.sqrt(t);
    const angle = index * GOLDEN_ANGLE;
    return {
      x: Math.cos(angle) * radius * minor * 0.82,
      z: Math.sin(angle) * radius * major * 0.82,
    };
  }

  private stepUnits(dt: number, layout: { major: number; minor: number }): void {
    const count = Math.min(this.blob?.unitCount ?? 0, this.units.instanceMatrix.count);
    this.ensureUnitStateCount(count);

    for (let i = 0; i < count; i++) {
      const state = this.unitStates[i];
      const slot = this.getSlotPosition(i, count, layout.major, layout.minor);
      const dx = slot.x - state.x;
      const dz = slot.z - state.z;

      state.vx += dx * UNIT_SPRING * dt;
      state.vz += dz * UNIT_SPRING * dt;
      state.vx *= Math.exp(-UNIT_DAMPING * UNIT_SPRING * dt);
      state.vz *= Math.exp(-UNIT_DAMPING * UNIT_SPRING * dt);

      const speed = Math.hypot(state.vx, state.vz);
      if (speed > UNIT_WALK_SPEED) {
        const scale = UNIT_WALK_SPEED / speed;
        state.vx *= scale;
        state.vz *= scale;
      }

      state.x += state.vx * dt;
      state.z += state.vz * dt;
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
    const terrainY = getTerrainHeightAt(layout.x, layout.y, this.game.getTiles());
    const color = this.game.getPlayerColor(this.blob.ownerId);
    const tint = new THREE.Color(color);

    this.mesh.position.set(layout.x, terrainY, layout.y);
    this.mesh.rotation.y = 0;
    this.ovalRoot.rotation.y = layout.heading;

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
    this.stepUnits(Math.min(0.05, dt), layout);

    const unitRules = getUnitRules(this.blob.unitType);
    const rightX = Math.cos(layout.heading);
    const rightZ = -Math.sin(layout.heading);
    const forwardX = Math.sin(layout.heading);
    const forwardZ = Math.cos(layout.heading);
    const tiles = this.game.getTiles();
    for (let i = 0; i < this.units.count; i++) {
      const state = this.unitStates[i];
      const px = rightX * state.x + forwardX * state.z;
      const pz = rightZ * state.x + forwardZ * state.z;
      const worldX = layout.x + px;
      const worldZ = layout.y + pz;
      const unitTerrainY = getTerrainHeightAt(worldX, worldZ, tiles);
      const hoverY = unitTerrainY - terrainY + GAME_RULES.UNIT_HEIGHT * 0.78;
      DUMMY.position.set(px, hoverY, pz);
      DUMMY.rotation.y = 0;
      DUMMY.scale.setScalar(unitRules.visualScale);
      DUMMY.updateMatrix();
      this.units.setMatrixAt(i, DUMMY.matrix);
    }
    this.units.instanceMatrix.needsUpdate = true;

    this.updateTargetIndicator(Math.min(0.05, dt), terrainY);
  }

  private buildTargetIndicator(): void {
    const mat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });

    // Stationary target ring
    this.targetPinRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 48), mat(0.78));
    this.targetPinRing.rotation.x = -Math.PI / 2;
    this.targetPinRing.position.y = 0.05;

    // Expanding ping ring (animated in updateTargetIndicator)
    this.targetPingMesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.80, 48), mat(0));
    this.targetPingMesh.rotation.x = -Math.PI / 2;
    this.targetPingMesh.position.y = 0.06;

    // Small center disc
    this.targetDisc = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), mat(0.90));
    this.targetDisc.rotation.x = -Math.PI / 2;
    this.targetDisc.position.y = 0.07;

    this.targetGroup = new THREE.Group();
    this.targetGroup.add(this.targetPinRing, this.targetPingMesh, this.targetDisc);
    this.targetGroup.visible = false;

    // Dashed connector: two-point line updated each frame in-place
    const connGeom = new THREE.BufferGeometry();
    connGeom.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.targetConnector = new THREE.Line(
      connGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.20, depthWrite: false })
    );
    this.targetConnector.visible = false;
  }

  private updateTargetIndicator(dt: number, blobTerrainY: number): void {
    if (!this.blob || !this.isSelected()) {
      this.targetGroup.visible = false;
      this.targetConnector.visible = false;
      return;
    }

    const dx = this.blob.targetX - this.blob.x;
    const dy = this.blob.targetY - this.blob.y;
    if (Math.hypot(dx, dy) < 1.5) {
      this.targetGroup.visible = false;
      this.targetConnector.visible = false;
      return;
    }

    this.targetAnimT += dt;
    const tgtTerrainY = getTerrainHeightAt(this.blob.targetX, this.blob.targetY, this.game.getTiles());
    const tint = new THREE.Color(this.game.getPlayerColor(this.blob.ownerId));
    const bright = tint.clone().offsetHSL(0, 0.0, 0.16);

    // Position group at target
    this.targetGroup.visible = true;
    this.targetGroup.position.set(this.blob.targetX, tgtTerrainY, this.blob.targetY);

    // Slowly rotate pin ring for liveliness
    this.targetPinRing.rotation.z = this.targetAnimT * 0.45;
    this.targetPinRing.material.color.copy(bright);
    const pinPulse = 1 + 0.06 * Math.sin(this.targetAnimT * 2.8);
    this.targetPinRing.scale.setScalar(pinPulse);

    // Cycling ping expansion: 0 → 1 over 1.8 s
    this.pingPhase = (this.pingPhase + dt / 1.8) % 1;
    const pingScale = 0.35 + this.pingPhase * 1.75;
    const pingAlpha = (1 - this.pingPhase) * 0.68;
    this.targetPingMesh.scale.setScalar(pingScale);
    this.targetPingMesh.material.opacity = pingAlpha;
    this.targetPingMesh.material.color.copy(bright);

    this.targetDisc.material.color.copy(bright);

    // Connector line: blob center → target
    const center = this.getPredictedCenter();
    const posAttr = this.targetConnector.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, center.x,            blobTerrainY + 0.12, center.y);
    posAttr.setXYZ(1, this.blob.targetX,   tgtTerrainY  + 0.12, this.blob.targetY);
    posAttr.needsUpdate = true;
    this.targetConnector.material.color.copy(bright);
    this.targetConnector.visible = true;
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
    const unitRules = getUnitRules(this.blob.unitType);
    return {
      title: unitRules.label,
      detail: this.blob.unitType === UnitType.VILLAGER ? "Can gather resources" : `${this.blob.unitCount} units`,
      health: this.blob.health,
      maxHealth: unitRules.health,
      color: this.game.getPlayerColor(this.blob.ownerId),
      actions: this.isMine() && this.blob.unitType !== UnitType.VILLAGER
        ? [
            { id: "spread:tight", label: "Tight", active: this.blob.spread === SquadSpread.TIGHT },
            { id: "spread:default", label: "Default", active: this.blob.spread === SquadSpread.DEFAULT },
            { id: "spread:wide", label: "Wide", active: this.blob.spread === SquadSpread.WIDE },
          ]
        : [],
      production: null,
    };
  }
}

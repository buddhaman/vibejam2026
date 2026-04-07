import * as THREE from "three";
import {
  GAME_RULES,
  SquadSpread,
  UnitType,
  getBlobMaxHealth,
  getSquadAxes,
  getUnitRules,
  type SquadSpread as SquadSpreadValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { createUnitBodyGeometry } from "./render-geom.js";
import { getTerrainHeightAt } from "./terrain.js";
import {
  applyPhalanxTeamTextureReplacements,
  createPhalanxInstancedMeshes,
  hasPhalanxGlbMeshes,
} from "./phalanx-unit-model.js";
import { secondaryTeamHexFromPrimary } from "./render-texture-recolor.js";

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
/** Keep ≥ starter Phalanx size — dev server uses a larger START_WARBAND_UNIT_COUNT (see server config). */
const INSTANCE_CAP = import.meta.env.DEV
  ? 8192
  : Math.max(512, GAME_RULES.START_WARBAND_UNIT_COUNT);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const VISUAL_STEP = 1 / 120;
const VISUAL_CATCHUP = 12;
const DIRECTION_SMOOTHING = 3.2;
const MIN_DIRECTION_SPEED = 0.2;
const UNIT_SPRING = 20;
const UNIT_DAMPING = 0.24;
const UNIT_WALK_SPEED = 4.4;
const UNIT_BODY_MAX_SPEED = 5.2;
const FOOT_IDLE_SPEED = 0.01;
const FOOT_STRIDE = GAME_RULES.UNIT_RADIUS * 1.05;
const HIP_WIDTH = GAME_RULES.UNIT_RADIUS * 0.32;
const HIP_LIFT = GAME_RULES.UNIT_HEIGHT * 0.46;
const BODY_FLOAT = GAME_RULES.UNIT_HEIGHT * 0.6;
const LEG_WIDTH = GAME_RULES.UNIT_RADIUS * 0.24;
const LEG_DEPTH = GAME_RULES.UNIT_RADIUS * 0.18;
const FOOT_GROUND_LIFT = 0.03;
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_PATH_COLOR = new THREE.Color();
/** Ground/st ray pick: villagers use a small procedural mesh — pad ellipse + invisible column for rays. */
const VILLAGER_CONTAINS_ELLIPSE_MULT = 1.7;
const VILLAGER_PICK_CYLINDER_R = 1.35;
const VILLAGER_PICK_CYLINDER_H = 3.8;

/** Legs & move markers stay neutral; squad ovals use owner team color (see `render`). */
const COLOR_LEG_BEAM  = new THREE.Color(0x4a433a);
const COLOR_SWORD     = new THREE.Color(0xd0d4dc); // light steel gray
const COLOR_MOVE_MARKER = new THREE.Color(0xfff8ef);
const TEMP_OVAL_RING  = new THREE.Color();
const TEMP_OVAL_FILL  = new THREE.Color();
const _ovalHsl = { h: 0, s: 0, l: 0 };

// ── Weapon / shield geometry (phalanx only) ───────────────────────────────────
/** Fraction of UNIT_HEIGHT where the shoulder joint sits. */
const SHOULDER_H_FRAC = 0.78;
/** Lateral shoulder offset as fraction of UNIT_RADIUS. */
const SHOULDER_SIDE_FRAC = 0.30;
/** Arm length (shoulder → hand) as fraction of UNIT_HEIGHT. */
const ARM_LEN_FRAC = 0.30;
/** Sword beam length as fraction of UNIT_HEIGHT. */
const SWORD_LEN_FRAC = 0.75;
/** Sword beam square cross-section side. */
const SWORD_W = 0.048;
/** Maximum arm swing angle (radians) while walking. */
const ARM_SWING_MAX = Math.PI * 0.40;
const ATTACK_SWING_MAX = Math.PI * 0.95;
const UNIT_ATTACK_REACH = GAME_RULES.UNIT_RADIUS * 2.25;
const COMBAT_PAIR_SEPARATION = Math.max(UNIT_ATTACK_REACH * 0.78, GAME_RULES.UNIT_RADIUS * 2.35);
const COMBAT_PAIR_PADDING = GAME_RULES.UNIT_RADIUS * 2.1;
const COMBAT_ATTACK_ENTER_DISTANCE = GAME_RULES.UNIT_RADIUS * 0.7;

const SHIELD_RADIUS    = 0.44;
const SHIELD_THICKNESS = 0.055;
/** Shield barely moves — just a subtle sway, not a full arm swing. */
const SHIELD_SWING_MAX = Math.PI * 0.06;
const _shieldFwdVec  = new THREE.Vector3();
const _shieldQuat    = new THREE.Quaternion();
const _upAxis        = new THREE.Vector3(0, 1, 0);

type UnitCombatMode = "formation" | "chase" | "attack";

type UnitState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  bodyX: number;
  bodyZ: number;
  lastBodyWorldX: number;
  lastBodyWorldZ: number;
  leftFootX: number;
  leftFootZ: number;
  rightFootX: number;
  rightFootZ: number;
  leftPlanted: boolean;
  distanceWalked: number;
  bodyReady: boolean;
  feetReady: boolean;
  combatMode: UnitCombatMode;
};

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private ovalRoot!: THREE.Group;
  private unitsVillager!: THREE.InstancedMesh;
  /** Invisible geometry so `Raycaster` can select villagers without pixel-hunting. */
  private villagerPickProxy!: THREE.Mesh;
  /** One mesh (cylinder fallback) or multiple parts from `phalanx.glb`. */
  private unitsPhalanx: THREE.InstancedMesh[] = [];
  private phalanxTeamTexApplied = false;
  /** Flat disc in the left hand of each phalanx soldier. */
  private unitShield!: THREE.InstancedMesh;
  private ovalFill!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private ovalRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private blob: {
    attackTargetBlobId: string;
    engagedTargetBlobId: string;
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
  private formationForwardX = 0;
  private formationForwardY = 1;
  private unitStates: UnitState[] = [];
  private needsUnitReassignment = false;

  // Target destination indicator
  private targetGroup!: THREE.Group;
  private targetPinRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetPingMesh!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetDisc!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private targetConnector!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private pingPhase = Math.random(); // stagger so multiple blobs don't pulse in sync
  private targetAnimT = 0;
  private combatAnimT = Math.random() * Math.PI * 2;


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
    this.unitsVillager = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), INSTANCE_CAP);
    this.unitsVillager.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.unitsVillager.castShadow = true;
    this.unitsVillager.receiveShadow = true;
    /** InstancedMesh frustum culling uses geometry bounds at origin, not instance positions — whole squad vanishes at some angles. */
    this.unitsVillager.frustumCulled = false;

    this.unitsPhalanx = createPhalanxInstancedMeshes(INSTANCE_CAP);
    if (this.unitsPhalanx.length === 0) {
      const fallback = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), INSTANCE_CAP);
      fallback.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fallback.castShadow = true;
      fallback.receiveShadow = true;
      fallback.frustumCulled = false;
      this.unitsPhalanx = [fallback];
    }

    this.ovalRoot = new THREE.Group();

    this.ovalFill = new THREE.Mesh(OVAL_FILL_GEOM, OVAL_FILL_MAT.clone());
    this.ovalFill.rotation.x = -Math.PI / 2;
    this.ovalFill.position.y = 0.02;

    this.ovalRing = new THREE.Mesh(OVAL_RING_GEOM, OVAL_RING_MAT.clone());
    this.ovalRing.rotation.x = -Math.PI / 2;
    this.ovalRing.position.y = 0.03;

    this.ovalRoot.add(this.ovalFill);
    this.ovalRoot.add(this.ovalRing);

    this.villagerPickProxy = new THREE.Mesh(
      new THREE.CylinderGeometry(VILLAGER_PICK_CYLINDER_R, VILLAGER_PICK_CYLINDER_R, VILLAGER_PICK_CYLINDER_H, 16),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.villagerPickProxy.position.y = VILLAGER_PICK_CYLINDER_H * 0.5;
    this.villagerPickProxy.visible = false;
    this.villagerPickProxy.frustumCulled = false;

    // Shield disc — flat cylinder in the left hand, one per phalanx unit
    const shieldGeom = new THREE.CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS, SHIELD_THICKNESS, 18);
    const shieldMat  = new THREE.MeshStandardMaterial({ color: 0xa8b4c0, roughness: 0.55, metalness: 0.38 });
    this.unitShield  = new THREE.InstancedMesh(shieldGeom, shieldMat, INSTANCE_CAP);
    this.unitShield.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.unitShield.castShadow    = true;
    this.unitShield.receiveShadow = true;
    this.unitShield.frustumCulled = false;
    this.unitShield.count = 0;

    const group = new THREE.Group();
    group.add(this.ovalRoot);
    group.add(this.unitsVillager);
    group.add(this.villagerPickProxy);
    for (const m of this.unitsPhalanx) group.add(m);
    group.add(this.unitShield);
    return group;
  }

  public sync(blob: {
    attackTargetBlobId: string;
    engagedTargetBlobId: string;
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
    const previousBlob = this.blob;
    const previousTargetX = this.blob?.targetX ?? blob.targetX;
    const previousTargetY = this.blob?.targetY ?? blob.targetY;
    this.blob = blob;
    if (Math.hypot(blob.targetX - previousTargetX, blob.targetY - previousTargetY) > 0.25) {
      const previousAxis = previousBlob
        ? this.getCanonicalFormationAxis(previousBlob.targetX - previousBlob.x, previousBlob.targetY - previousBlob.y)
        : null;
      const nextAxis = this.getCanonicalFormationAxis(blob.targetX - blob.x, blob.targetY - blob.y);
      this.setFormationForward(blob.targetX - blob.x, blob.targetY - blob.y);
      this.needsUnitReassignment =
        !!previousAxis &&
        !!nextAxis &&
        (previousAxis.x * nextAxis.x + previousAxis.y * nextAxis.y) < 0.985;
    }
    if (this.visualX === null || this.visualY === null) {
      this.visualX = blob.x;
      this.visualY = blob.y;
      this.visualVx = blob.vx;
      this.visualVy = blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (speed > MIN_DIRECTION_SPEED) {
        this.forwardX = blob.vx / speed;
        this.forwardY = blob.vy / speed;
        this.formationForwardX = this.forwardX;
        this.formationForwardY = this.forwardY;
      }
    }
  }

  private getCombatTarget() {
    return this.game.getBlobCombatTarget(this.id);
  }

  private getCanonicalFormationAxis(dx: number, dy: number): { x: number; y: number } | null {
    const len = Math.hypot(dx, dy);
    if (len <= 1e-4) return null;

    let x = dx / len;
    let y = dy / len;
    if (y < 0 || (Math.abs(y) <= 1e-6 && x < 0)) {
      x = -x;
      y = -y;
    }
    return { x, y };
  }

  private setFormationForward(dx: number, dy: number): void {
    const axis = this.getCanonicalFormationAxis(dx, dy);
    if (!axis) return;
    this.formationForwardX = axis.x;
    this.formationForwardY = axis.y;
  }

  private reassignUnitStates(count: number, layout: { major: number; minor: number; heading: number }): void {
    if (count <= 1) return;

    const rightX = Math.cos(layout.heading);
    const rightZ = -Math.sin(layout.heading);
    const forwardX = Math.sin(layout.heading);
    const forwardZ = Math.cos(layout.heading);

    const slots = Array.from({ length: count }, (_, index) => {
      const slot = this.getSlotPosition(index, count, layout.major, layout.minor);
      return { index, front: slot.z, side: slot.x };
    }).sort((a, b) => {
      if (Math.abs(b.front - a.front) > 1e-4) return b.front - a.front;
      return a.side - b.side;
    });

    const orderedStates = this.unitStates.slice(0, count).map((state) => {
      const px = state.bodyReady ? state.bodyX : rightX * state.x + forwardX * state.z;
      const pz = state.bodyReady ? state.bodyZ : rightZ * state.x + forwardZ * state.z;
      return {
        state,
        front: px * forwardX + pz * forwardZ,
        side: px * rightX + pz * rightZ,
      };
    }).sort((a, b) => {
      if (Math.abs(b.front - a.front) > 1e-4) return b.front - a.front;
      return a.side - b.side;
    });

    const remapped = this.unitStates.slice();
    for (let rank = 0; rank < count; rank++) {
      remapped[slots[rank]!.index] = orderedStates[rank]!.state;
    }
    this.unitStates = remapped;
  }

  private ensureUnitStateCount(count: number): void {
    while (this.unitStates.length < count) {
      this.unitStates.push({
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        bodyX: 0,
        bodyZ: 0,
        lastBodyWorldX: 0,
        lastBodyWorldZ: 0,
        leftFootX: 0,
        leftFootZ: 0,
        rightFootX: 0,
        rightFootZ: 0,
        leftPlanted: Math.random() >= 0.5,
        distanceWalked: Math.random() * FOOT_STRIDE,
        bodyReady: false,
        feetReady: false,
        combatMode: "formation",
      });
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
    const count = Math.min(this.blob?.unitCount ?? 0, INSTANCE_CAP);
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

  private resetFeet(state: UnitState, bodyWorldX: number, bodyWorldZ: number, sideX: number, sideZ: number, hipWidth: number) {
    state.leftFootX = bodyWorldX + sideX * hipWidth;
    state.leftFootZ = bodyWorldZ + sideZ * hipWidth;
    state.rightFootX = bodyWorldX - sideX * hipWidth;
    state.rightFootZ = bodyWorldZ - sideZ * hipWidth;
    state.lastBodyWorldX = bodyWorldX;
    state.lastBodyWorldZ = bodyWorldZ;
    state.feetReady = true;
  }

  private updateFeet(
    state: UnitState,
    bodyWorldX: number,
    bodyWorldZ: number,
    bodyVx: number,
    bodyVz: number,
    dt: number,
    forwardX: number,
    forwardZ: number,
    sideX: number,
    sideZ: number,
    stride: number,
    hipWidth: number
  ) {
    if (!state.feetReady) {
      this.resetFeet(state, bodyWorldX, bodyWorldZ, sideX, sideZ, hipWidth);
    }

    const speed = Math.hypot(bodyVx, bodyVz);
    if (speed < FOOT_IDLE_SPEED) {
      state.leftFootX = bodyWorldX + sideX * hipWidth;
      state.leftFootZ = bodyWorldZ + sideZ * hipWidth;
      state.rightFootX = bodyWorldX - sideX * hipWidth;
      state.rightFootZ = bodyWorldZ - sideZ * hipWidth;
      state.lastBodyWorldX = bodyWorldX;
      state.lastBodyWorldZ = bodyWorldZ;
      return;
    }

    state.distanceWalked += speed * dt;
    if (state.distanceWalked > stride) {
      state.distanceWalked = 0;
      const sideSign = state.leftPlanted ? -1 : 1;
      if (state.leftPlanted) {
        state.rightFootX = bodyWorldX + forwardX * stride + sideX * hipWidth * sideSign;
        state.rightFootZ = bodyWorldZ + forwardZ * stride + sideZ * hipWidth * sideSign;
      } else {
        state.leftFootX = bodyWorldX + forwardX * stride + sideX * hipWidth * sideSign;
        state.leftFootZ = bodyWorldZ + forwardZ * stride + sideZ * hipWidth * sideSign;
      }
      state.leftPlanted = !state.leftPlanted;
    }

    state.lastBodyWorldX = bodyWorldX;
    state.lastBodyWorldZ = bodyWorldZ;
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
    const combatTarget = this.getCombatTarget();
    const combatTargetCenter = combatTarget?.getPredictedWorldCenter() ?? null;
    const engagedInCombat =
      this.blob.engagedTargetBlobId.length > 0 &&
      !!combatTarget &&
      !!combatTargetCenter &&
      combatTarget.id === this.blob.engagedTargetBlobId;

    if (engagedInCombat && combatTargetCenter) {
      this.setFormationForward(combatTargetCenter.x - center.x, combatTargetCenter.z - center.y);
      this.heading = Math.atan2(this.formationForwardX, this.formationForwardY);
      const axes = getSquadAxes(this.blob.unitCount, 0, 0, this.blob.spread);
      return {
        x: center.x,
        y: center.y,
        major: axes.major,
        minor: axes.minor,
        heading: this.heading,
      };
    }

    const tx = this.blob.targetX - center.x;
    const ty = this.blob.targetY - center.y;
    const speed = Math.hypot(center.vx, center.vy);
    const moveDistance = Math.hypot(tx, ty);

    if (speed > MIN_DIRECTION_SPEED) {
      // Actively moving — face the current movement direction (follows path waypoints)
      this.setFormationForward(center.vx, center.vy);
    } else if (moveDistance > 0.5) {
      // Stationary but has a queued target — face it
      this.setFormationForward(tx, ty);
    }

    this.heading = Math.atan2(this.formationForwardX, this.formationForwardY);

    const { major, minor } = getSquadAxes(this.blob.unitCount, moveDistance, speed, this.blob.spread);
    return { x: center.x, y: center.y, major, minor, heading: this.heading };
  }

  public getRadius(): number {
    return this.blob?.radius ?? 0;
  }

  public getPredictedWorldCenter(): { x: number; z: number } {
    const center = this.getPredictedCenter();
    return { x: center.x, z: center.y };
  }

  public getApproxUnitWorldPosition(rank: number): { x: number; z: number } {
    const layout = this.getLayout();
    const count = Math.max(1, Math.min(this.blob?.unitCount ?? 1, INSTANCE_CAP));
    const slot = this.getSlotPosition(Math.max(0, Math.min(rank, count - 1)), count, layout.major, layout.minor);
    const rightX = Math.cos(layout.heading);
    const rightZ = -Math.sin(layout.heading);
    const forwardX = Math.sin(layout.heading);
    const forwardZ = Math.cos(layout.heading);
    const px = rightX * slot.x + forwardX * slot.z;
    const pz = rightZ * slot.x + forwardZ * slot.z;
    return { x: layout.x + px, z: layout.y + pz };
  }

  private getCombatPlan(
    layout: { x: number; y: number; major: number; minor: number; heading: number },
    unitIndex: number,
    unitCount: number,
    state: UnitState,
    target: BlobEntity
  ): {
    mode: UnitCombatMode;
    desiredPx: number;
    desiredPz: number;
    pairCenterWorldX: number;
    pairCenterWorldZ: number;
  } | null {
    const targetCenter = target.getPredictedWorldCenter();
    const dx = targetCenter.x - layout.x;
    const dz = targetCenter.z - layout.y;
    const dist = Math.hypot(dx, dz);
    if (
      this.blob?.engagedTargetBlobId !== target.id ||
      dist <= 1e-4
    ) {
      return null;
    }

    const nx = dx / dist;
    const nz = dz / dist;
    const sideX = -nz;
    const sideZ = nx;
    const targetUnitCount = Math.max(1, target.getUnitCount());
    const pairCount = Math.max(unitCount, targetUnitCount);
    const combatRadius = Math.max(
      GAME_RULES.UNIT_RADIUS * 3,
      Math.sqrt(pairCount) * COMBAT_PAIR_PADDING
    );
    const pairIndex = pairCount <= 1 ? 0 : Math.round((unitIndex / Math.max(1, unitCount - 1)) * (pairCount - 1));
    // Future polish: add subtle Brownian drift + local avoidance to these pair centers
    // so battles feel more alive without changing any server-side combat results.
    const pairSlot = this.getSlotPosition(pairIndex, pairCount, combatRadius, combatRadius);
    const combatCenterX = (layout.x + targetCenter.x) * 0.5;
    const combatCenterZ = (layout.y + targetCenter.z) * 0.5;
    const pairCenterX = combatCenterX + pairSlot.x;
    const pairCenterZ = combatCenterZ + pairSlot.z;
    const currentPx = state.bodyReady ? state.bodyX : state.x;
    const currentPz = state.bodyReady ? state.bodyZ : state.z;
    const ownAnchorX = pairCenterX - nx * (COMBAT_PAIR_SEPARATION * 0.5);
    const ownAnchorZ = pairCenterZ - nz * (COMBAT_PAIR_SEPARATION * 0.5);
    const enemyAnchorX = pairCenterX + nx * (COMBAT_PAIR_SEPARATION * 0.5);
    const enemyAnchorZ = pairCenterZ + nz * (COMBAT_PAIR_SEPARATION * 0.5);
    const anchorDist = Math.hypot(layout.x + currentPx - ownAnchorX, layout.y + currentPz - ownAnchorZ);

    return {
      mode: anchorDist <= COMBAT_ATTACK_ENTER_DISTANCE ? "attack" : "chase",
      desiredPx: ownAnchorX - layout.x,
      desiredPz: ownAnchorZ - layout.y,
      pairCenterWorldX: pairCenterX,
      pairCenterWorldZ: pairCenterZ,
    };
  }

  public render(dt: number): void {
    if (!this.blob) return;
    this.combatAnimT += dt;

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
    const teamTint = new THREE.Color(this.game.getPlayerColor(this.blob.ownerId));

    this.mesh.position.set(layout.x, terrainY, layout.y);
    this.mesh.rotation.y = 0;
    this.ovalRoot.rotation.y = layout.heading;

    this.ovalFill.scale.set(layout.minor, layout.major, 1);
    this.ovalRing.scale.set(layout.minor * 1.04, layout.major * 1.04, 1);

    const zoomT = this.game.getCameraZoomOut01();
    const enemyZoom = !this.isMine() ? zoomT : 0;

    TEMP_OVAL_RING.copy(teamTint);
    TEMP_OVAL_RING.getHSL(_ovalHsl, THREE.SRGBColorSpace);
    if (_ovalHsl.l < 0.42) TEMP_OVAL_RING.offsetHSL(0, 0, 0.07);
    if (this.isSelected()) TEMP_OVAL_RING.offsetHSL(0, 0.04, 0.1);
    TEMP_OVAL_FILL.copy(TEMP_OVAL_RING).offsetHSL(0, -0.1, 0.11);

    this.ovalRing.material.color.copy(TEMP_OVAL_RING);
    this.ovalFill.material.color.copy(TEMP_OVAL_FILL);

    this.ovalFill.material.opacity = this.isMine() ? 0.12 : 0.055 + enemyZoom * 0.14;
    this.ovalRing.material.opacity = this.isSelected()
      ? 0.7 + enemyZoom * 0.1
      : this.isMine()
        ? 0.24 + zoomT * 0.08
        : 0.1 + enemyZoom * 0.28;

    const isVillager = this.blob.unitType === UnitType.VILLAGER;
    const n = Math.min(this.blob.unitCount, INSTANCE_CAP);

    this.unitsVillager.count = isVillager ? n : 0;
    this.unitsVillager.visible = isVillager;
    const villagerMat = this.unitsVillager.material as THREE.MeshStandardMaterial;
    villagerMat.color.copy(teamTint).offsetHSL(0, 0.02, 0.02);
    villagerMat.opacity = this.isMine() ? 1 : 0.68;
    villagerMat.transparent = !this.isMine();
    this.villagerPickProxy.visible = isVillager;

    if (!isVillager && this.unitsPhalanx.length > 0 && hasPhalanxGlbMeshes() && !this.phalanxTeamTexApplied) {
      const primary = this.game.getPlayerColor(this.blob.ownerId);
      applyPhalanxTeamTextureReplacements(
        this.unitsPhalanx,
        primary,
        secondaryTeamHexFromPrimary(primary)
      );
      this.phalanxTeamTexApplied = true;
    }

    for (const m of this.unitsPhalanx) {
      m.count = !isVillager ? n : 0;
      m.visible = !isVillager;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.opacity = this.isMine() ? 1 : 0.68;
      pm.transparent = !this.isMine();
    }

    this.unitShield.count   = !isVillager ? n : 0;
    this.unitShield.visible = !isVillager;
    (this.unitShield.material as THREE.MeshStandardMaterial).color
      .copy(teamTint).offsetHSL(0, 0.04, -0.14);

    const stepDt = Math.min(0.05, dt);
    if (this.needsUnitReassignment) {
      this.ensureUnitStateCount(n);
      this.reassignUnitStates(n, layout);
      this.needsUnitReassignment = false;
    }
    this.stepUnits(stepDt, layout);

    const unitRules = getUnitRules(this.blob.unitType);
    const combatTarget = this.getCombatTarget();
    const rightX = Math.cos(layout.heading);
    const rightZ = -Math.sin(layout.heading);
    const forwardX = Math.sin(layout.heading);
    const forwardZ = Math.cos(layout.heading);
    const tiles = this.game.getTiles();
    for (let i = 0; i < n; i++) {
      const state = this.unitStates[i];
      let desiredPx = rightX * state.x + forwardX * state.z;
      let desiredPz = rightZ * state.x + forwardZ * state.z;
      let pairCenterWorldX = 0;
      let pairCenterWorldZ = 0;
      const combatPlan = combatTarget ? this.getCombatPlan(layout, i, n, state, combatTarget) : null;
      if (combatPlan) {
        desiredPx = combatPlan.desiredPx;
        desiredPz = combatPlan.desiredPz;
        pairCenterWorldX = combatPlan.pairCenterWorldX;
        pairCenterWorldZ = combatPlan.pairCenterWorldZ;
        state.combatMode = combatPlan.mode;
      } else {
        state.combatMode = "formation";
      }
      if (!state.bodyReady) {
        state.bodyX = desiredPx;
        state.bodyZ = desiredPz;
        state.bodyReady = true;
      } else {
        const bodyDx = desiredPx - state.bodyX;
        const bodyDz = desiredPz - state.bodyZ;
        const bodyDist = Math.hypot(bodyDx, bodyDz);
        const maxStep = UNIT_BODY_MAX_SPEED * stepDt;
        if (bodyDist <= maxStep || bodyDist < 1e-5) {
          state.bodyX = desiredPx;
          state.bodyZ = desiredPz;
        } else {
          const scale = maxStep / bodyDist;
          state.bodyX += bodyDx * scale;
          state.bodyZ += bodyDz * scale;
        }
      }

      const px = state.bodyX;
      const pz = state.bodyZ;
      const worldX = layout.x + px;
      const worldZ = layout.y + pz;
      const unitTerrainY = getTerrainHeightAt(worldX, worldZ, tiles);
      const hoverY = unitTerrainY - terrainY + BODY_FLOAT;
      const bodyVx = state.feetReady ? (worldX - state.lastBodyWorldX) / Math.max(stepDt, 1e-4) : this.visualVx;
      const bodyVz = state.feetReady ? (worldZ - state.lastBodyWorldZ) / Math.max(stepDt, 1e-4) : this.visualVy;
      let stepForwardX = forwardX;
      let stepForwardZ = forwardZ;
      const hasEnemyAssignment = state.combatMode !== "formation";
      if (hasEnemyAssignment) {
        const engageDx = pairCenterWorldX - worldX;
        const engageDz = pairCenterWorldZ - worldZ;
        const engageDist = Math.hypot(engageDx, engageDz);
        if (engageDist > 1e-4) {
          stepForwardX = engageDx / engageDist;
          stepForwardZ = engageDz / engageDist;
        }
      }
      const bodySpeed = Math.hypot(bodyVx, bodyVz);
      if (!hasEnemyAssignment && bodySpeed > FOOT_IDLE_SPEED) {
        stepForwardX = bodyVx / bodySpeed;
        stepForwardZ = bodyVz / bodySpeed;
      }
      const sideX = -stepForwardZ;
      const sideZ = stepForwardX;

      this.updateFeet(
        state,
        worldX,
        worldZ,
        bodyVx,
        bodyVz,
        stepDt,
        stepForwardX,
        stepForwardZ,
        sideX,
        sideZ,
        FOOT_STRIDE * unitRules.visualScale,
        HIP_WIDTH * unitRules.visualScale
      );

      DUMMY.position.set(px, hoverY, pz);
      DUMMY.rotation.set(0, Math.atan2(stepForwardX, stepForwardZ), 0);
      DUMMY.scale.setScalar(unitRules.visualScale);
      DUMMY.updateMatrix();
      if (isVillager) {
        this.unitsVillager.setMatrixAt(i, DUMMY.matrix);
      } else {
        for (const m of this.unitsPhalanx) {
          m.setMatrixAt(i, DUMMY.matrix);
        }
      }

      const hipOffsetX = sideX * HIP_WIDTH * unitRules.visualScale;
      const hipOffsetZ = sideZ * HIP_WIDTH * unitRules.visualScale;
      const hipWorldY = unitTerrainY + HIP_LIFT * unitRules.visualScale;
      const leftFootTerrainY = getTerrainHeightAt(state.leftFootX, state.leftFootZ, tiles) + FOOT_GROUND_LIFT;
      const rightFootTerrainY = getTerrainHeightAt(state.rightFootX, state.rightFootZ, tiles) + FOOT_GROUND_LIFT;
      TEMP_A.set(worldX + hipOffsetX, hipWorldY, worldZ + hipOffsetZ);
      TEMP_B.set(state.leftFootX, leftFootTerrainY, state.leftFootZ);
      this.game.drawBeam(
        TEMP_A,
        TEMP_B,
        LEG_WIDTH * unitRules.visualScale,
        LEG_DEPTH * unitRules.visualScale,
        COLOR_LEG_BEAM
      );

      TEMP_A.set(worldX - hipOffsetX, hipWorldY, worldZ - hipOffsetZ);
      TEMP_B.set(state.rightFootX, rightFootTerrainY, state.rightFootZ);
      this.game.drawBeam(
        TEMP_A,
        TEMP_B,
        LEG_WIDTH * unitRules.visualScale,
        LEG_DEPTH * unitRules.visualScale,
        COLOR_LEG_BEAM
      );

      // ── Sword (right arm) + Shield (left arm) — phalanx only ──────────────
      if (!isVillager) {
        const vs = unitRules.visualScale;
        const shoulderH    = GAME_RULES.UNIT_HEIGHT * SHOULDER_H_FRAC * vs;
        const shoulderSide = GAME_RULES.UNIT_RADIUS  * SHOULDER_SIDE_FRAC * vs;
        const armLen       = GAME_RULES.UNIT_HEIGHT  * ARM_LEN_FRAC  * vs;
        const swordLen     = GAME_RULES.UNIT_HEIGHT  * SWORD_LEN_FRAC * vs;
        const shoulderWorldY = unitTerrainY + shoulderH;

        // Arm swing: driven by stride phase. Right arm leads when left foot plants.
        const walkPhase  = state.distanceWalked / (FOOT_STRIDE * vs + 1e-6);
        const swingSign  = state.leftPlanted ? 1 : -1;
        const enemyDist = hasEnemyAssignment ? Math.hypot(pairCenterWorldX - worldX, pairCenterWorldZ - worldZ) : Infinity;
        const isAttacking = state.combatMode === "attack";
        const isStriding = !isAttacking && bodySpeed > FOOT_IDLE_SPEED * 2;
        const attackPhase = this.combatAnimT * 9 + i * 0.37;
        const rightSwing = isAttacking
          ? -0.24 + Math.max(0, Math.sin(attackPhase)) * ATTACK_SWING_MAX
          : isStriding
            ? Math.sin(walkPhase * Math.PI * 2) * swingSign * ARM_SWING_MAX
            : 0;
        const leftSwing  = isAttacking
          ? Math.sin(attackPhase * 0.85) * SHIELD_SWING_MAX * 0.8
          : isStriding
            ? Math.sin(walkPhase * Math.PI * 2) * (-swingSign) * SHIELD_SWING_MAX
            : 0;

        // Right shoulder → hand → sword tip (all in the forward-up plane)
        const rShX = worldX + sideX * shoulderSide;
        const rShZ = worldZ + sideZ * shoulderSide;
        const rFwd = Math.cos(rightSwing); // component along stepForward
        const rUp  = Math.sin(rightSwing); // component along world-up

        // Hand = shoulder + arm along (forward*rFwd, up*rUp)
        const handX = rShX + stepForwardX * rFwd * armLen;
        const handY = shoulderWorldY + rUp * armLen;
        const handZ = rShZ + stepForwardZ * rFwd * armLen;

        // Sword tip continues from hand in same direction
        const tipX = handX + stepForwardX * rFwd * swordLen;
        const tipY = handY + rUp * swordLen;
        const tipZ = handZ + stepForwardZ * rFwd * swordLen;

        TEMP_A.set(handX, handY, handZ);
        TEMP_B.set(tipX,  tipY,  tipZ);
        this.game.drawBeam(TEMP_A, TEMP_B, SWORD_W * vs, SWORD_W * vs, COLOR_SWORD);

        // Left shoulder → hand → shield center
        const lShX = worldX - sideX * shoulderSide;
        const lShZ = worldZ - sideZ * shoulderSide;
        const lFwd = Math.cos(leftSwing);
        const lUp  = Math.sin(leftSwing);

        const shieldX = lShX + stepForwardX * lFwd * armLen;
        const shieldY = shoulderWorldY + lUp * armLen;
        const shieldZ = lShZ + stepForwardZ * lFwd * armLen;

        // Orient shield disc: cylinder Y-axis → arm direction (so face points forward)
        _shieldFwdVec.set(stepForwardX * lFwd, lUp, stepForwardZ * lFwd).normalize();
        _shieldQuat.setFromUnitVectors(_upAxis, _shieldFwdVec);

        // Position is relative to the group root (layout.x, terrainY, layout.y)
        DUMMY.position.set(shieldX - layout.x, shieldY - terrainY, shieldZ - layout.y);
        DUMMY.quaternion.copy(_shieldQuat);
        DUMMY.scale.setScalar(vs);
        DUMMY.updateMatrix();
        this.unitShield.setMatrixAt(i, DUMMY.matrix);
      }
    }
    this.unitsVillager.instanceMatrix.needsUpdate = true;
    this.unitShield.instanceMatrix.needsUpdate = true;
    for (const m of this.unitsPhalanx) m.instanceMatrix.needsUpdate = true;

    this.updatePathLine(teamTint);
    this.updateTargetIndicator(Math.min(0.05, dt), terrainY);
  }

  private updatePathLine(teamTint: THREE.Color): void {
    const path = this.game.getBlobPath(this.id);
    if (!this.isSelected() || !this.isMine() || !path || path.length < 1) return;

    const tiles = this.game.getTiles();
    TEMP_PATH_COLOR.copy(teamTint).offsetHSL(0, -0.08, 0.22);

    const H = 0.55;
    const W = 0.32;
    const D = 0.18;

    // Skip waypoints the blob has already passed — find the one closest to current position.
    // Everything before it is behind the blob and should not be drawn.
    const center = this.getPredictedCenter();
    let firstIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(center.x - path[i]!.x, center.y - path[i]!.y);
      if (d < nearestDist) { nearestDist = d; firstIdx = i; }
    }

    // Draw: blob's current position → nearest remaining waypoint → … → destination
    let ax = center.x;
    let ay = center.y;
    let aTerrainY = getTerrainHeightAt(ax, ay, tiles);
    for (let i = firstIdx; i < path.length; i++) {
      const wp = path[i]!;
      const bTerrainY = getTerrainHeightAt(wp.x, wp.y, tiles);
      TEMP_A.set(ax,   aTerrainY + H, ay);
      TEMP_B.set(wp.x, bTerrainY + H, wp.y);
      this.game.drawBeam(TEMP_A, TEMP_B, W, D, TEMP_PATH_COLOR);
      ax = wp.x; ay = wp.y; aTerrainY = bTerrainY;
    }
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
    if (!this.blob || this.game.selectedEntityId !== this.id || !this.isMine()) {
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

    // Position group at target
    this.targetGroup.visible = true;
    this.targetGroup.position.set(this.blob.targetX, tgtTerrainY, this.blob.targetY);

    // Slowly rotate pin ring for liveliness
    this.targetPinRing.rotation.z = this.targetAnimT * 0.45;
    this.targetPinRing.material.color.copy(COLOR_MOVE_MARKER);
    const pinPulse = 1 + 0.06 * Math.sin(this.targetAnimT * 2.8);
    this.targetPinRing.scale.setScalar(pinPulse);

    // Cycling ping expansion: 0 → 1 over 1.8 s
    this.pingPhase = (this.pingPhase + dt / 1.8) % 1;
    const pingScale = 0.35 + this.pingPhase * 1.75;
    const pingAlpha = (1 - this.pingPhase) * 0.68;
    this.targetPingMesh.scale.setScalar(pingScale);
    this.targetPingMesh.material.opacity = pingAlpha;
    this.targetPingMesh.material.color.copy(COLOR_MOVE_MARKER);

    this.targetDisc.material.color.copy(COLOR_MOVE_MARKER);

    // Connector line: blob center → target
    const center = this.getPredictedCenter();
    const posAttr = this.targetConnector.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, center.x,            blobTerrainY + 0.12, center.y);
    posAttr.setXYZ(1, this.blob.targetX,   tgtTerrainY  + 0.12, this.blob.targetY);
    posAttr.needsUpdate = true;
    this.targetConnector.material.color.copy(COLOR_MOVE_MARKER);
    this.targetConnector.visible = true;
  }

  public isMine(): boolean {
    return this.blob !== null && this.game.isMyBlob(this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.blob !== null && this.game.selectedEntityId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    const layout = this.getLayout();
    let { minor, major } = layout;
    if (this.blob.unitType === UnitType.VILLAGER) {
      minor *= VILLAGER_CONTAINS_ELLIPSE_MULT;
      major *= VILLAGER_CONTAINS_ELLIPSE_MULT;
    }
    const cos = Math.cos(-this.heading);
    const sin = Math.sin(-this.heading);
    const lx = (x - layout.x) * cos - (z - layout.y) * sin;
    const lz = (x - layout.x) * sin + (z - layout.y) * cos;
    return (lx * lx) / (minor * minor) + (lz * lz) / (major * major) <= 1.05;
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

  public getUnitType(): UnitTypeValue | null {
    return this.blob?.unitType ?? null;
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
    const enemy = !this.isMine();
    return {
      title: unitRules.label,
      detail: enemy
        ? `Enemy${this.blob.engagedTargetBlobId ? " · Engaged" : ""} · ${this.blob.unitType === UnitType.VILLAGER ? "gatherer" : `${this.blob.unitCount} units`}`
        : this.blob.unitType === UnitType.VILLAGER
          ? this.blob.engagedTargetBlobId ? "Engaged" : "Can gather resources"
          : `${this.blob.unitCount} units${this.blob.engagedTargetBlobId ? " · Engaged" : ""}`,
      health: this.blob.health,
      maxHealth: getBlobMaxHealth(this.blob.unitType, this.blob.unitCount),
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

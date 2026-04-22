import * as THREE from "three";
import {
  BuildingType,
  GAME_RULES,
  canAfford,
  getBuildingRules,
  getUnitRules,
  getUnitTrainCost,
  getUnitTrainTimeMs,
  type BuildingType as BuildingTypeValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { getTerrainHeightAt } from "./terrain.js";
import { instantiateBuildingVariant } from "./building-model-registry.js";
import type { BuildingVariant } from "./building-visuals.js";
import {
  applyTeamColorTexturesToObject3D,
  secondaryTeamHexFromPrimary,
} from "./render-texture-recolor.js";

const ORB_RADIUS = 0.525;
const ORB_Y_ABOVE_ROOF = 1.55;
const DUMMY = new THREE.Object3D();
const FARM_UP = new THREE.Vector3(0, 1, 0);
const FARM_BASE = new THREE.Vector3();
const FARM_TOP = new THREE.Vector3();
const FARM_START = new THREE.Vector3();
const FARM_END = new THREE.Vector3();
const FARM_DIR = new THREE.Vector3();
const FARM_QUAT = new THREE.Quaternion();
const FARM_RADIAL = new THREE.Vector3();
const FARM_SIDE = new THREE.Vector3();
const UNIT_TRAIN_TIME_MULTIPLIER = import.meta.env.DEV ? 0.1 : GAME_RULES.UNIT_TRAIN_TIME_MULTIPLIER;

function getEffectiveUnitTrainTimeMs(unitType: UnitTypeValue): number {
  return Math.max(1, Math.ceil(getUnitTrainTimeMs(unitType) * UNIT_TRAIN_TIME_MULTIPLIER));
}

export class BuildingEntity extends Entity {
  /** Cloned only for the one building type this entity actually uses. Set after first sync(). */
  private variant: BuildingVariant | null = null;
  /** One-time CPU recolor of GLB albedo/emissive maps to this owner’s palette. */
  private buildingTeamTexturesApplied = false;
  /** Single unlit sphere — full-brightness player palette color. */
  private ownerOrb!: THREE.Mesh;
  private ownerOrbMaterial!: THREE.MeshBasicMaterial;
  private localAge = 0;

  private building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
    productionQueue: UnitTypeValue[];
    productionProgressMs: number;
    farmGrowth: number;
  } | null = null;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): THREE.Group {
    const root = new THREE.Group();
    // Variant is NOT cloned here — we don’t know the building type yet.
    // It is cloned lazily in sync() via setTimeout so it doesn’t block the Colyseus callback frame.
    this.ownerOrbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ownerOrb = new THREE.Mesh(new THREE.SphereGeometry(ORB_RADIUS, 32, 26), this.ownerOrbMaterial);
    this.ownerOrb.castShadow = true;
    root.add(this.ownerOrb);
    return root;
  }

  public sync(building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
    productionQueue: ArrayLike<UnitTypeValue>;
    productionProgressMs: number;
    farmGrowth: number;
  }): void {
    const firstSync = this.building === null;
    this.building = {
      ...building,
      productionQueue: Array.from(building.productionQueue ?? []),
    };

    // Defer the clone to the next event-loop turn so it doesn’t stall the Colyseus schema callback.
    if (firstSync) {
      const type = building.buildingType;
      setTimeout(() => {
        if (this.isStale()) return; // building already destroyed before clone finished
        this.variant = instantiateBuildingVariant(type);
        this.mesh.add(this.variant.root);
      }, 0);
    }
  }

  public getBuildingType(): BuildingTypeValue | null {
    return this.building?.buildingType ?? null;
  }

  public render(_dt: number): void {
    if (!this.building || !this.variant) return;
    this.localAge += _dt;

    const terrainY = getTerrainHeightAt(
      this.building.x,
      this.building.y,
      this.game.getTiles()
    );

    const rules = getBuildingRules(this.building.buildingType);
    const playerHex = this.game.getPlayerColor(this.building.ownerId);
    this.ownerOrbMaterial.color.setHex(playerHex);
    this.ownerOrb.position.set(0, rules.height + ORB_Y_ABOVE_ROOF, 0);

    if (!this.buildingTeamTexturesApplied && this.building.ownerId.length > 0) {
      const auth = this.game.room.state.players.get(this.building.ownerId) as { color?: number } | undefined;
      if (typeof auth?.color === "number") {
        const secondary = secondaryTeamHexFromPrimary(playerHex);
        applyTeamColorTexturesToObject3D(this.variant.root, playerHex, secondary, {
          blueChannelUsesSecondary: false,
        });
        this.buildingTeamTexturesApplied = true;
      }
    }

    this.mesh.position.set(this.building.x, terrainY, this.building.y);
    if (this.building.buildingType === BuildingType.FARM) {
      this.updateFarmGrowth();
    }
  }

  private updateFarmGrowth(): void {
    if (!this.variant) return;
    const growthT = THREE.MathUtils.clamp(this.building?.farmGrowth ?? 0, 0, 1);
    const eased = 1 - Math.pow(1 - growthT, 2.1);
    const motion = Math.max(0, 1 - growthT);
    const stemMesh = this.variant.root.getObjectByName("farm_stems") as THREE.InstancedMesh | null;
    const leavesA = this.variant.root.getObjectByName("farm_leaves_a") as THREE.InstancedMesh | null;
    const leavesB = this.variant.root.getObjectByName("farm_leaves_b") as THREE.InstancedMesh | null;
    const slots = (stemMesh?.userData.farmSlots as Array<{ x: number; z: number; yaw: number; jitter: number }> | undefined) ?? [];
    if (!stemMesh || !leavesA || !leavesB || slots.length === 0) return;

    const stemHeight = 1.9 + eased * 3.3;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const swayX = Math.sin(this.localAge * 8.2 + slot.jitter * 1.7) * 0.34 * motion;
      const swayZ = Math.cos(this.localAge * 7.8 + slot.jitter * 1.3) * 0.34 * motion;
      FARM_BASE.set(slot.x, 0.06, slot.z);
      FARM_TOP.set(slot.x + swayX, 0.06 + stemHeight * eased, slot.z + swayZ);
      this.setFarmBeamMatrix(FARM_BASE, FARM_TOP, 0.92 + eased * 0.16, stemMesh, i);

      FARM_DIR.subVectors(FARM_TOP, FARM_BASE).normalize();
      FARM_RADIAL.set(Math.cos(slot.yaw), 0, Math.sin(slot.yaw));
      FARM_SIDE.set(-Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
      const leafJitter = Math.sin(this.localAge * 5.8 + slot.jitter * 1.2) * 0.08 * motion;
      const leafLength = eased * 1.95;
      const leafThickness = Math.max(0.02, eased * 0.4);

      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.36, leafLength, leafThickness, 0.18, leafJitter, leavesA, i * 2);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.48, leafLength * 0.92, leafThickness * 0.94, -0.34, -leafJitter * 0.7, leavesA, i * 2 + 1);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.62, leafLength * 0.98, leafThickness, Math.PI + 0.22, leafJitter * 0.85, leavesB, i * 2);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.74, leafLength * 0.88, leafThickness * 0.9, Math.PI - 0.4, -leafJitter * 0.5, leavesB, i * 2 + 1);
    }

    stemMesh.count = slots.length;
    leavesA.count = slots.length * 2;
    leavesB.count = slots.length * 2;
    stemMesh.instanceMatrix.needsUpdate = true;
    leavesA.instanceMatrix.needsUpdate = true;
    leavesB.instanceMatrix.needsUpdate = true;
  }

  private setFarmBeamMatrix(
    start: THREE.Vector3,
    end: THREE.Vector3,
    thickness: number,
    mesh: THREE.InstancedMesh,
    index: number
  ): void {
    FARM_DIR.subVectors(end, start);
    const length = Math.max(0.001, FARM_DIR.length());
    FARM_DIR.divideScalar(length);
    FARM_QUAT.setFromUnitVectors(FARM_UP, FARM_DIR);
    DUMMY.position.copy(start);
    DUMMY.quaternion.copy(FARM_QUAT);
    DUMMY.scale.set(thickness, length, thickness * 0.78);
    DUMMY.updateMatrix();
    mesh.setMatrixAt(index, DUMMY.matrix);
  }

  private setFarmLeafSegment(
    stemBase: THREE.Vector3,
    stemTop: THREE.Vector3,
    radial: THREE.Vector3,
    side: THREE.Vector3,
    alongT: number,
    length: number,
    thickness: number,
    angle: number,
    jitter: number,
    mesh: THREE.InstancedMesh,
    index: number
  ): void {
    if (length <= 0.001 || thickness <= 0.001) {
      DUMMY.scale.set(0.0001, 0.0001, 0.0001);
      DUMMY.position.copy(stemBase);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(index, DUMMY.matrix);
      return;
    }
    FARM_START.copy(stemBase).lerp(stemTop, alongT);
    const outwardX = radial.x * Math.cos(angle) + side.x * Math.sin(angle);
    const outwardZ = radial.z * Math.cos(angle) + side.z * Math.sin(angle);
    FARM_END.set(
      FARM_START.x + outwardX * length + jitter,
      FARM_START.y + 0.1 + length * 0.12,
      FARM_START.z + outwardZ * length
    );
    this.setFarmBeamMatrix(FARM_START, FARM_END, thickness, mesh, index);
  }

  public isStale(): boolean {
    return !this.game.room.state.buildings.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.building !== null && this.game.isMyBlob(this.building.ownerId);
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.building) return false;
    const rules = getBuildingRules(this.building.buildingType);
    const halfW = rules.selectionWidth * 0.5;
    const halfD = rules.selectionDepth * 0.5;
    return Math.abs(x - this.building.x) <= halfW && Math.abs(z - this.building.y) <= halfD;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.building) return Infinity;
    return Math.hypot(x - this.building.x, z - this.building.y);
  }

  public getWorldCenter(): { x: number; z: number } {
    if (!this.building) return { x: 0, z: 0 };
    return { x: this.building.x, z: this.building.y };
  }

  public getAttackRadius(): number {
    if (!this.building) return 0;
    const rules = getBuildingRules(this.building.buildingType);
    return Math.hypot(rules.selectionWidth * 0.5, rules.selectionDepth * 0.5);
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.building) return null;
    const rules = getBuildingRules(this.building.buildingType);
    const mine = this.isOwnedByMe();
    const resources = this.game.getMyResources();
    const currentUnitType = this.building.productionQueue[0] ?? null;
    const queueCount = this.building.productionQueue.length;
    const currentUnitRules = currentUnitType ? getUnitRules(currentUnitType) : null;
    const baseDetail = rules.detail;
    return {
      title: rules.label,
      detail: mine ? baseDetail : `Enemy · ${baseDetail.toLowerCase()}`,
      health: this.building.health,
      maxHealth: rules.health,
      color: this.game.getPlayerColor(this.building.ownerId),
      actions: mine
        ? rules.producibleUnits.map((unitType) => {
            const unitRules = getUnitRules(unitType);
            const trainCost = getUnitTrainCost(unitType);
            const trainTimeMs = getEffectiveUnitTrainTimeMs(unitType);
            const count = this.building!.productionQueue.filter((queuedType) => queuedType === unitType).length;
            return {
              id: `train:${unitType}`,
              label: unitRules.label,
              disabled: !canAfford(resources, trainCost),
              cost: trainCost,
              timeMs: trainTimeMs,
              queueCount: count,
            };
          })
        : [],
      production:
        mine && currentUnitRules
          ? {
              label: currentUnitRules.label,
              queueCount,
              remainingMs: Math.max(0, getEffectiveUnitTrainTimeMs(currentUnitType) - this.building.productionProgressMs),
              progress: Math.max(0, Math.min(1, this.building.productionProgressMs / getEffectiveUnitTrainTimeMs(currentUnitType))),
            }
          : null,
    };
  }
}

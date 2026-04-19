import * as THREE from "three";
import {
  BuildingType,
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

const ORB_RADIUS = 1.05;
const ORB_Y_ABOVE_ROOF = 1.25;
const FARM_GROWTH_SECONDS = 10;
const DUMMY = new THREE.Object3D();

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
    const growthT = Math.min(1, this.localAge / FARM_GROWTH_SECONDS);
    const eased = 1 - Math.pow(1 - growthT, 2.1);
    const motion = Math.max(0, 1 - growthT);
    const stemMesh = this.variant.root.getObjectByName("farm_stems") as THREE.InstancedMesh | null;
    const leavesA = this.variant.root.getObjectByName("farm_leaves_a") as THREE.InstancedMesh | null;
    const leavesB = this.variant.root.getObjectByName("farm_leaves_b") as THREE.InstancedMesh | null;
    const slots = (stemMesh?.userData.farmSlots as Array<{ x: number; z: number; yaw: number; jitter: number }> | undefined) ?? [];
    if (!stemMesh || !leavesA || !leavesB || slots.length === 0) return;

    const stemHeight = 2.4 + eased * 2.8;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const tipYawJitter = Math.sin(this.localAge * 7.4 + slot.jitter) * 0.08 * motion;
      const tipPitchX = Math.sin(this.localAge * 8.2 + slot.jitter * 1.7) * 0.14 * motion;
      const tipPitchZ = Math.cos(this.localAge * 7.8 + slot.jitter * 1.3) * 0.14 * motion;
      DUMMY.position.set(slot.x, 0.06, slot.z);
      DUMMY.rotation.set(tipPitchX, slot.yaw + tipYawJitter, tipPitchZ);
      DUMMY.scale.set(1, stemHeight * eased, 1);
      DUMMY.updateMatrix();
      stemMesh.setMatrixAt(i, DUMMY.matrix);

      const tipY = 0.06 + stemHeight * eased;
      const radialX = Math.cos(slot.yaw);
      const radialZ = Math.sin(slot.yaw);
      const sideX = -radialZ;
      const sideZ = radialX;
      const leafMotionYaw = Math.sin(this.localAge * 5.4 + slot.jitter) * 0.09 * motion;
      const leafLift = Math.sin(this.localAge * 6.1 + slot.jitter * 0.8) * 0.08 * motion;
      const leafScaleX = 0.78 + eased * 1.7;
      const leafScaleY = 0.34 + eased * 0.82;
      const leafScaleZ = 0.5 + eased * 0.72;
      const attachOut = 0.18 + eased * 0.22;
      const attachDown = 0.42 + eased * 0.18;
      const leafPitch = 0.98;
      const leafRoll = 0.24;

      DUMMY.position.set(
        slot.x + radialX * attachOut,
        tipY - attachDown + leafLift,
        slot.z + radialZ * attachOut
      );
      DUMMY.rotation.set(0, slot.yaw + leafMotionYaw, leafPitch);
      DUMMY.scale.set(leafScaleX, leafScaleY, leafScaleZ);
      DUMMY.updateMatrix();
      leavesA.setMatrixAt(i * 2, DUMMY.matrix);

      DUMMY.position.set(
        slot.x - sideX * attachOut * 0.8,
        tipY - attachDown * 0.8 - leafLift * 0.3,
        slot.z - sideZ * attachOut * 0.8
      );
      DUMMY.rotation.set(leafRoll, slot.yaw + Math.PI * 0.52 + leafMotionYaw, -leafPitch * 0.86);
      DUMMY.scale.set(leafScaleX * 0.92, leafScaleY * 0.92, leafScaleZ * 0.92);
      DUMMY.updateMatrix();
      leavesA.setMatrixAt(i * 2 + 1, DUMMY.matrix);

      DUMMY.position.set(
        slot.x - radialX * attachOut,
        tipY - attachDown * 1.05,
        slot.z - radialZ * attachOut
      );
      DUMMY.rotation.set(0, slot.yaw + Math.PI + leafMotionYaw, -leafPitch);
      DUMMY.scale.set(leafScaleX * 0.96, leafScaleY, leafScaleZ);
      DUMMY.updateMatrix();
      leavesB.setMatrixAt(i * 2, DUMMY.matrix);

      DUMMY.position.set(
        slot.x + sideX * attachOut * 0.8,
        tipY - attachDown * 0.72 + leafLift * 0.25,
        slot.z + sideZ * attachOut * 0.8
      );
      DUMMY.rotation.set(-leafRoll, slot.yaw + Math.PI * 1.48 + leafMotionYaw, leafPitch * 0.82);
      DUMMY.scale.set(leafScaleX * 0.88, leafScaleY * 0.9, leafScaleZ * 0.9);
      DUMMY.updateMatrix();
      leavesB.setMatrixAt(i * 2 + 1, DUMMY.matrix);
    }

    stemMesh.count = slots.length;
    leavesA.count = slots.length * 2;
    leavesB.count = slots.length * 2;
    stemMesh.instanceMatrix.needsUpdate = true;
    leavesA.instanceMatrix.needsUpdate = true;
    leavesB.instanceMatrix.needsUpdate = true;
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
            const trainTimeMs = getUnitTrainTimeMs(unitType);
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
              remainingMs: Math.max(0, getUnitTrainTimeMs(currentUnitType) - this.building.productionProgressMs),
              progress: Math.max(0, Math.min(1, this.building.productionProgressMs / getUnitTrainTimeMs(currentUnitType))),
            }
          : null,
    };
  }
}

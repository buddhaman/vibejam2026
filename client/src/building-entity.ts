import * as THREE from "three";
import {
  BuildingType,
  canAfford,
  getBuildingRules,
  getUnitRules,
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

export class BuildingEntity extends Entity {
  /** Cloned only for the one building type this entity actually uses. Set after first sync(). */
  private variant: BuildingVariant | null = null;
  /** One-time CPU recolor of GLB albedo/emissive maps to this owner’s palette. */
  private buildingTeamTexturesApplied = false;
  /** Single unlit sphere — full-brightness player palette color. */
  private ownerOrb!: THREE.Mesh;
  private ownerOrbMaterial!: THREE.MeshBasicMaterial;

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

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.building) return null;
    const rules = getBuildingRules(this.building.buildingType);
    const mine = this.isOwnedByMe();
    const resources = this.game.getMyResources();
    const currentUnitType = this.building.productionQueue[0] ?? null;
    const queueCount = this.building.productionQueue.length;
    const currentUnitRules = currentUnitType ? getUnitRules(currentUnitType) : null;
    const baseDetail =
      this.building.buildingType === BuildingType.TOWN_CENTER
        ? "Produces villagers"
        : this.building.buildingType === BuildingType.BARRACKS
          ? "Produces warbands"
          : "Defensive structure";
    return {
      title: rules.label,
      detail: mine ? baseDetail : `Enemy · ${baseDetail.toLowerCase()}`,
      health: this.building.health,
      maxHealth: rules.health,
      color: this.game.getPlayerColor(this.building.ownerId),
      actions: mine
        ? rules.producibleUnits.map((unitType) => {
            const unitRules = getUnitRules(unitType);
            const count = this.building!.productionQueue.filter((queuedType) => queuedType === unitType).length;
            return {
              id: `train:${unitType}`,
              label: unitRules.label,
              disabled: !canAfford(resources, unitRules.cost),
              cost: unitRules.cost,
              timeMs: unitRules.trainTimeMs,
              queueCount: count,
            };
          })
        : [],
      production:
        mine && currentUnitRules
          ? {
              label: currentUnitRules.label,
              queueCount,
              remainingMs: Math.max(0, currentUnitRules.trainTimeMs - this.building.productionProgressMs),
              progress: Math.max(0, Math.min(1, this.building.productionProgressMs / currentUnitRules.trainTimeMs)),
            }
          : null,
    };
  }
}

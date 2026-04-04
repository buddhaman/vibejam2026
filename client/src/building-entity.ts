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

type BuildingVisual = THREE.Group;

type BuildingVariant = {
  root: THREE.Group;
  tintMaterials: THREE.MeshStandardMaterial[];
  accentMaterials: THREE.MeshStandardMaterial[];
};

type BuildingSet = Record<BuildingTypeValue, BuildingVariant>;

function createMaterial(color: number, roughness: number, metalness: number) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function createBox(
  size: { x: number; y: number; z: number },
  position: { x: number; y: number; z: number },
  material: THREE.MeshStandardMaterial
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createBarracksVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.BARRACKS);
  const footprintInset = 0.4;
  const bodyWidth = rules.footprintWidth - 1.2;
  const bodyDepth = rules.footprintDepth - 1.2;
  const wallHeight = rules.height - 2.3;
  const roofY = wallHeight + 0.82;
  const upperY = roofY + 0.83;
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xb78f68, 0.92, 0.04),
    createMaterial(0x8b694d, 0.96, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x5c3f2e, 1, 0),
    createMaterial(0xd7c3a1, 0.72, 0.05),
  ];

  root.add(
    createBox(
      { x: rules.footprintWidth - footprintInset, y: 0.55, z: rules.footprintDepth - footprintInset },
      { x: 0, y: 0.275, z: 0 },
      accentMaterials[0]
    )
  );
  root.add(createBox({ x: bodyWidth, y: wallHeight, z: bodyDepth }, { x: 0, y: 0.55 + wallHeight * 0.5, z: 0 }, tintMaterials[0]));
  root.add(
    createBox(
      { x: rules.footprintWidth - 0.8, y: 0.45, z: rules.footprintDepth - 0.8 },
      { x: 0, y: roofY, z: 0 },
      accentMaterials[1]
    )
  );
  root.add(createBox({ x: bodyWidth - 2.6, y: 1.2, z: bodyDepth - 2.6 }, { x: 0, y: upperY, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 2.2, y: 2.2, z: 1.1 }, { x: 0, y: 1.65, z: bodyDepth * 0.47 }, accentMaterials[1]));
  root.add(createBox({ x: 1.1, y: 2.7, z: 1.1 }, { x: -bodyWidth * 0.34, y: rules.height - 0.35, z: -bodyDepth * 0.34 }, accentMaterials[0]));
  root.add(createBox({ x: 1.1, y: 2.7, z: 1.1 }, { x: bodyWidth * 0.34, y: rules.height - 0.35, z: -bodyDepth * 0.34 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createTowerVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.TOWER);
  const capY = rules.height - 3.75;
  const crownY = rules.height - 1.68;
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xbab5a9, 0.96, 0.02),
    createMaterial(0x8c867c, 0.98, 0.01),
  ];
  const accentMaterials = [
    createMaterial(0x4e4339, 0.98, 0),
    createMaterial(0xd6c08c, 0.76, 0.06),
  ];

  root.add(
    createBox(
      { x: rules.footprintWidth + 0.5, y: 0.65, z: rules.footprintDepth + 0.5 },
      { x: 0, y: 0.325, z: 0 },
      accentMaterials[0]
    )
  );
  root.add(createBox({ x: rules.footprintWidth, y: rules.height - 4.7, z: rules.footprintDepth }, { x: 0, y: rules.height * 0.39, z: 0 }, tintMaterials[0]));
  root.add(
    createBox(
      { x: rules.footprintWidth + 0.7, y: 0.55, z: rules.footprintDepth + 0.7 },
      { x: 0, y: capY, z: 0 },
      accentMaterials[1]
    )
  );
  root.add(createBox({ x: rules.footprintWidth - 1.7, y: 3.6, z: rules.footprintDepth - 1.7 }, { x: 0, y: crownY, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 3.4, y: 1.15, z: rules.footprintDepth - 3.4 }, { x: 0, y: rules.height + 0.7, z: 0 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createTownCenterVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.TOWN_CENTER);
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xc6ab7b, 0.9, 0.04),
    createMaterial(0x9d7850, 0.95, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x5f4530, 0.98, 0),
    createMaterial(0xdfcfaa, 0.72, 0.05),
  ];

  root.add(createBox({ x: rules.footprintWidth, y: 0.8, z: rules.footprintDepth }, { x: 0, y: 0.4, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 1.4, y: 4.9, z: rules.footprintDepth - 1.4 }, { x: 0, y: 3.25, z: 0 }, tintMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 0.8, y: 0.55, z: rules.footprintDepth - 0.8 }, { x: 0, y: 5.95, z: 0 }, accentMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 4.2, y: 2.1, z: rules.footprintDepth - 4.2 }, { x: 0, y: 7.05, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 2.4, y: 2.8, z: 1.3 }, { x: 0, y: 2.2, z: rules.footprintDepth * 0.42 }, accentMaterials[1]));
  root.add(createBox({ x: 1.3, y: 3.2, z: 1.3 }, { x: -rules.footprintWidth * 0.31, y: 8.1, z: -rules.footprintDepth * 0.31 }, accentMaterials[0]));
  root.add(createBox({ x: 1.3, y: 3.2, z: 1.3 }, { x: rules.footprintWidth * 0.31, y: 8.1, z: -rules.footprintDepth * 0.31 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createBuildingSet(): BuildingSet {
  return {
    [BuildingType.BARRACKS]: createBarracksVariant(),
    [BuildingType.TOWER]: createTowerVariant(),
    [BuildingType.TOWN_CENTER]: createTownCenterVariant(),
  };
}

function getTint(baseColor: number) {
  return new THREE.Color(baseColor);
}

export class BuildingEntity extends Entity {
  public mesh: BuildingVisual;
  private variants!: BuildingSet;
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

  protected createMesh(): BuildingVisual {
    const root = new THREE.Group();
    this.variants = createBuildingSet();

    for (const variant of Object.values(this.variants)) {
      variant.root.visible = false;
      root.add(variant.root);
    }

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
    this.building = {
      ...building,
      productionQueue: Array.from(building.productionQueue ?? []),
    };
  }

  public render(_dt: number): void {
    if (!this.building) return;

    const terrainY = getTerrainHeightAt(
      this.building.x,
      this.building.y,
      (this.game.room.state as { terrainSeed: number }).terrainSeed
    );
    const tint = getTint(this.game.getPlayerColor(this.building.ownerId));
    const accent = tint.clone().offsetHSL(0.015, -0.12, -0.24);
    const trim = tint.clone().offsetHSL(-0.01, 0.08, 0.22);

    for (const [typeKey, variant] of Object.entries(this.variants)) {
      variant.root.visible = Number(typeKey) === this.building.buildingType;
      if (!variant.root.visible) continue;

      for (const material of variant.tintMaterials) material.color.copy(tint);
      if (variant.accentMaterials[0]) variant.accentMaterials[0].color.copy(accent);
      if (variant.accentMaterials[1]) variant.accentMaterials[1].color.copy(trim);
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
    const resources = this.game.getMyResources();
    const currentUnitType = this.building.productionQueue[0] ?? null;
    const queueCount = this.building.productionQueue.length;
    const currentUnitRules = currentUnitType ? getUnitRules(currentUnitType) : null;
    return {
      title: rules.label,
      detail:
        this.building.buildingType === BuildingType.TOWN_CENTER
          ? "Produces villagers"
          : this.building.buildingType === BuildingType.BARRACKS
            ? "Produces warbands"
            : "Defensive structure",
      health: this.building.health,
      maxHealth: rules.health,
      color: this.game.getPlayerColor(this.building.ownerId),
      actions: rules.producibleUnits.map((unitType) => {
        const unitRules = getUnitRules(unitType);
        const count = this.building.productionQueue.filter((queuedType) => queuedType === unitType).length;
        return {
          id: `train:${unitType}`,
          label: unitRules.label,
          disabled: !canAfford(resources, unitRules.cost),
          cost: unitRules.cost,
          timeMs: unitRules.trainTimeMs,
          queueCount: count,
        };
      }),
      production: currentUnitRules
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

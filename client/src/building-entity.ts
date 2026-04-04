import * as THREE from "three";
import { BuildingType, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";

type BuildingVisual = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

const BUILDING_DEF = {
  [BuildingType.BARRACKS]: { geom: new THREE.BoxGeometry(5, 2, 5), halfH: 1 },
  [BuildingType.TOWER]: { geom: new THREE.BoxGeometry(2, 8, 2), halfH: 4 },
} as const;

function getBuildingDef(buildingType: BuildingTypeValue) {
  return BUILDING_DEF[buildingType] ?? BUILDING_DEF[BuildingType.BARRACKS];
}

export class BuildingEntity extends Entity {
  public mesh: BuildingVisual;
  private building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
  } | null = null;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): BuildingVisual {
    const def = getBuildingDef(BuildingType.BARRACKS);
    const mesh = new THREE.Mesh(
      def.geom,
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.7, metalness: 0.1 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  public sync(building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
  }): void {
    this.building = building;
  }

  public render(_dt: number): void {
    if (!this.building) return;
    const def = getBuildingDef(this.building.buildingType);
    if (this.mesh.geometry !== def.geom) {
      this.mesh.geometry = def.geom;
    }
    this.mesh.material.color.setHex(this.game.getPlayerColor(this.building.ownerId));
    this.mesh.position.set(this.building.x, def.halfH, this.building.y);
  }

  public isStale(): boolean {
    return !this.game.room.state.buildings.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.building !== null && this.game.isMyBlob(this.building.ownerId);
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.building) return false;
    const def = getBuildingDef(this.building.buildingType);
    const halfW = def.geom.parameters.width * 0.5;
    const halfD = def.geom.parameters.depth * 0.5;
    return Math.abs(x - this.building.x) <= halfW && Math.abs(z - this.building.y) <= halfD;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.building) return Infinity;
    return Math.hypot(x - this.building.x, z - this.building.y);
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.building) return null;
    const isBarracks = this.building.buildingType === BuildingType.BARRACKS;
    return {
      title: isBarracks ? "Barracks" : "Tower",
      detail: isBarracks ? "Creates squads" : "Defensive structure",
      health: this.building.health,
      maxHealth: isBarracks ? 200 : 300,
      color: this.game.getPlayerColor(this.building.ownerId),
      actions: isBarracks ? [{ id: "train", label: "Train" }] : [],
    };
  }
}

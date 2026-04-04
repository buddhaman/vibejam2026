import * as THREE from "three";
import type { BuildingType } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity } from "./entity.js";

type BuildingVisual = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

export class BuildingEntity extends Entity {
  public mesh: BuildingVisual;
  private building: {
    x: number;
    y: number;
    buildingType: BuildingType;
    health: number;
    ownerId: string;
  } | null = null;

  public constructor(
    game: Game,
    id: string,
    private buildingType: BuildingType,
    private getBuildingDef: (buildingType: BuildingType) => { geom: THREE.BoxGeometry; halfH: number },
    private playerColor: (ownerId: string) => number
  ) {
    super(game, id);
  }

  protected createMesh(): BuildingVisual {
    const def = this.getBuildingDef(this.buildingType);
    return new THREE.Mesh(
      def.geom,
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.7, metalness: 0.1 })
    );
  }

  public sync(building: {
    x: number;
    y: number;
    buildingType: BuildingType;
    health: number;
    ownerId: string;
  }): void {
    this.building = building;
  }

  public render(): void {
    if (!this.building) return;
    const def = this.getBuildingDef(this.building.buildingType);
    if (this.mesh.geometry !== def.geom) {
      this.mesh.geometry = def.geom;
    }
    this.mesh.material.color.setHex(this.playerColor(this.building.ownerId));
    this.mesh.position.set(this.building.x, def.halfH, this.building.y);
  }
}

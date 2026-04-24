import * as THREE from "three";
import type { ResourceCost } from "../../shared/game-rules.js";
import type { Game } from "./game.js";

export type SelectionAction = {
  id: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  cost?: ResourceCost;
  timeMs?: number;
  queueCount?: number;
};

export type ProductionInfo = {
  label: string;
  queueCount: number;
  remainingMs: number;
  progress: number;
};

export type SelectionInfo = {
  title: string;
  detail: string;
  health: number;
  maxHealth: number;
  color: number;
  actions: SelectionAction[];
  production?: ProductionInfo | null;
};

export abstract class Entity {
  public id: string;
  public mesh!: THREE.Object3D;
  protected game: Game;

  protected constructor(game: Game, id: string) {
    this.game = game;
    this.id = id;
  }

  protected init(): void {
    this.mesh = this.createMesh();
    this.game.add(this);
  }

  protected abstract createMesh(): THREE.Object3D;
  public abstract render(dt: number): void;
  public abstract isStale(): boolean;
  public abstract isOwnedByMe(): boolean;
  public abstract containsWorldPoint(x: number, z: number): boolean;
  public abstract worldDistanceTo(x: number, z: number): number;
  public abstract getSelectionInfo(): SelectionInfo | null;

  public getSelectionOutlineObjects(): THREE.Object3D[] {
    return [this.mesh];
  }

  public destroy(): void {
    this.game.remove(this);
  }
}

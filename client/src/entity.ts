import * as THREE from "three";
import type { Game } from "./game.js";

export type SelectionAction = {
  id: string;
  label: string;
  active?: boolean;
};

export type SelectionInfo = {
  title: string;
  detail: string;
  health: number;
  maxHealth: number;
  color: number;
  actions: SelectionAction[];
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

  public destroy(): void {
    this.game.remove(this);
  }
}

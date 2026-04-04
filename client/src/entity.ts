import * as THREE from "three";
import type { Game } from "./game.js";

export abstract class Entity {
  public id: string;
  public mesh: THREE.Object3D;
  protected game: Game;

  protected constructor(game: Game, id: string) {
    this.game = game;
    this.id = id;
    this.mesh = this.createMesh();
    this.game.add(this);
  }

  protected abstract createMesh(): THREE.Object3D;
  public abstract render(): void;

  public destroy(): void {
    this.game.remove(this);
  }
}

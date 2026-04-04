import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import type { Entity } from "./entity.js";
import { BuildingType, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import { MessageType, type IntentMessage } from "../../shared/protocol.js";
import { BlobEntity } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";

/** Thin client-side view — not authoritative. */
export class Game {
  public room: Room;
  public scene: THREE.Scene;
  public entities: Entity[] = [];
  public selectedBlobId: string | null = null;

  private sphereGeom = new THREE.SphereGeometry(1, 22, 16);
  private ringGeom = new THREE.RingGeometry(1.05, 1.2, 48);
  private buildingGeom = {
    [BuildingType.BARRACKS]: { geom: new THREE.BoxGeometry(5, 2, 5), halfH: 1 },
    [BuildingType.TOWER]: { geom: new THREE.BoxGeometry(2, 8, 2), halfH: 4 },
  } as const;

  public constructor(room: Room) {
    this.room = room;
    this.scene = new THREE.Scene();
  }

  private playerColor(ownerId: string): number {
    const player = this.room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof player?.color === "number" ? player.color : 0x8899aa;
  }

  private getBuildingDef(buildingType: BuildingTypeValue) {
    return this.buildingGeom[buildingType as BuildingType] ?? this.buildingGeom[BuildingType.BARRACKS];
  }

  public findBlobEntity(id: string): BlobEntity | null {
    for (const entity of this.entities) {
      if (entity instanceof BlobEntity && entity.id === id) return entity;
    }
    return null;
  }

  private findBuildingEntity(id: string): BuildingEntity | null {
    for (const entity of this.entities) {
      if (entity instanceof BuildingEntity && entity.id === id) return entity;
    }
    return null;
  }

  public add(entity: Entity): void {
    this.entities.push(entity);
    this.scene.add(entity.mesh);
  }

  public remove(entity: Entity): void {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    this.scene.remove(entity.mesh);
  }

  public sync(): void {
    this.room.state.blobs.forEach((blob, id) => {
      let entity = this.findBlobEntity(id as string);
      if (!entity) {
        entity = new BlobEntity(this, id as string, this.sphereGeom, this.ringGeom, this.playerColor.bind(this));
      }
      entity.sync(blob as {
        x: number;
        y: number;
        radius: number;
        ownerId: string;
        unitCount: number;
        health: number;
      });
    });

    this.room.state.buildings.forEach((building, id) => {
      let entity = this.findBuildingEntity(id as string);
      if (!entity) {
          entity = new BuildingEntity(
            this,
            id as string,
            (building as { buildingType: BuildingTypeValue }).buildingType,
            this.getBuildingDef.bind(this),
            this.playerColor.bind(this)
          );
      }
      entity.sync(building as {
        x: number;
        y: number;
        buildingType: BuildingTypeValue;
        health: number;
        ownerId: string;
      });
    });

    for (const entity of [...this.entities]) {
      if (entity instanceof BlobEntity && !this.room.state.blobs.get(entity.id)) {
        entity.destroy();
      }
      if (entity instanceof BuildingEntity && !this.room.state.buildings.get(entity.id)) {
        entity.destroy();
      }
    }
  }

  public getSelectedBlobEntity(): BlobEntity | null {
    return this.selectedBlobId ? this.findBlobEntity(this.selectedBlobId) : null;
  }

  public getMyBlobCount(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (entity instanceof BlobEntity && entity.isMine()) count++;
    }
    return count;
  }
}

export function isMyBlob(game: Game, ownerId: string): boolean {
  return ownerId === game.room.sessionId;
}

export function sendMoveIntent(game: Game, targetX: number, targetY: number) {
  const id = game.selectedBlobId;
  if (!id) {
    return;
  }
  game.room.send(MessageType.INTENT, { blobId: id, targetX, targetY } satisfies IntentMessage);
}

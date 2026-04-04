import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import type { Entity } from "./entity.js";
import {
  SquadSpread,
  snapWorldToTileCenter,
  type BuildingType as BuildingTypeValue,
  type SquadSpread as SquadSpreadValue,
} from "../../shared/game-rules.js";
import { MessageType, type BuildMessage, type IntentMessage, type SquadSpreadMessage, type TrainMessage } from "../../shared/protocol.js";
import { BlobEntity } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";

export class Game {
  public room: Room;
  public scene: THREE.Scene;
  public entities: Entity[] = [];
  public selectedEntityId: string | null = null;

  public constructor(room: Room) {
    this.room = room;
    this.scene = new THREE.Scene();
  }

  public getPlayerColor(ownerId: string): number {
    const player = this.room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof player?.color === "number" ? player.color : 0x8899aa;
  }

  public add(entity: Entity): void {
    this.entities.push(entity);
    this.scene.add(entity.mesh);
  }

  public remove(entity: Entity): void {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    this.scene.remove(entity.mesh);
    if (this.selectedEntityId === entity.id) this.selectedEntityId = null;
  }

  public findEntity(id: string): Entity | null {
    for (const entity of this.entities) {
      if (entity.id === id) return entity;
    }
    return null;
  }

  public findBlobEntity(id: string): BlobEntity | null {
    const entity = this.findEntity(id);
    return entity instanceof BlobEntity ? entity : null;
  }

  private findBuildingEntity(id: string): BuildingEntity | null {
    const entity = this.findEntity(id);
    return entity instanceof BuildingEntity ? entity : null;
  }

  public sync(): void {
    this.room.state.blobs.forEach((blob, id) => {
      let entity = this.findBlobEntity(id as string);
      if (!entity) entity = new BlobEntity(this, id as string);
      entity.sync(blob as {
        x: number;
        y: number;
        targetX: number;
        targetY: number;
        vx: number;
        vy: number;
        ownerId: string;
        unitCount: number;
        health: number;
        spread: SquadSpreadValue;
      });
    });

    this.room.state.buildings.forEach((building, id) => {
      let entity = this.findBuildingEntity(id as string);
      if (!entity) entity = new BuildingEntity(this, id as string);
      entity.sync(building as {
        x: number;
        y: number;
        buildingType: BuildingTypeValue;
        health: number;
        ownerId: string;
      });
    });

    for (const entity of [...this.entities]) {
      if (entity.isStale()) entity.destroy();
    }
  }

  public getSelectedEntity(): Entity | null {
    return this.selectedEntityId ? this.findEntity(this.selectedEntityId) : null;
  }

  public getSelectedBlobEntity(): BlobEntity | null {
    const entity = this.getSelectedEntity();
    return entity instanceof BlobEntity ? entity : null;
  }

  public toggleSelection(entityId: string): void {
    this.selectedEntityId = this.selectedEntityId === entityId ? null : entityId;
  }

  public clearSelection(): void {
    this.selectedEntityId = null;
  }

  public pickOwnedEntity(x: number, z: number): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!entity.isOwnedByMe() || !entity.containsWorldPoint(x, z)) continue;
      const distance = entity.worldDistanceTo(x, z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }
    return best;
  }

  public pickOwnedEntityFromRay(raycaster: THREE.Raycaster): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Infinity;

    for (const entity of this.entities) {
      if (!entity.isOwnedByMe()) continue;
      const hits = raycaster.intersectObject(entity.mesh, true);
      if (hits.length === 0) continue;
      const distance = hits[0].distance;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }

    return best;
  }

  public getMySquadCount(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (entity instanceof BlobEntity && entity.isMine()) count++;
    }
    return count;
  }

  public isMyBlob(ownerId: string): boolean {
    return ownerId === this.room.sessionId;
  }

  public sendMoveIntent(targetX: number, targetY: number): void {
    const blob = this.getSelectedBlobEntity();
    if (!blob) return;
    this.room.send(MessageType.INTENT, { blobId: blob.id, targetX, targetY } satisfies IntentMessage);
  }

  public sendBuildIntent(type: BuildMessage["type"], worldX: number, worldZ: number): void {
    const snapped = snapWorldToTileCenter(worldX, worldZ);
    this.room.send(MessageType.BUILD, { type, worldX: snapped.x, worldZ: snapped.z } satisfies BuildMessage);
  }

  public sendTrainIntent(buildingId: string): void {
    this.room.send(MessageType.TRAIN, { buildingId } satisfies TrainMessage);
  }

  public sendSquadSpreadIntent(blobId: string, spread: SquadSpreadValue): void {
    this.room.send(MessageType.SQUAD_SPREAD, { blobId, spread } satisfies SquadSpreadMessage);
  }

  public runSelectionAction(actionId: string): void {
    const selected = this.getSelectedEntity();
    if (!selected) return;
    if (actionId === "train") {
      this.sendTrainIntent(selected.id);
      return;
    }
    if (!(selected instanceof BlobEntity)) return;
    if (actionId === "spread:tight") this.sendSquadSpreadIntent(selected.id, SquadSpread.TIGHT);
    if (actionId === "spread:default") this.sendSquadSpreadIntent(selected.id, SquadSpread.DEFAULT);
    if (actionId === "spread:wide") this.sendSquadSpreadIntent(selected.id, SquadSpread.WIDE);
  }
}

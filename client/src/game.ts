import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import type { Entity } from "./entity.js";
import {
  BuildingType,
  SquadSpread,
  getTileCoordsFromWorld,
  getTileKey,
  getWorldTileCount,
  type ResourceCost,
  snapWorldToTileCenter,
  type BuildingType as BuildingTypeValue,
  type SquadSpread as SquadSpreadValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import {
  MessageType,
  type BuildMessage,
  type IntentMessage,
  type SquadSpreadMessage,
  type TrainMessage,
  type TileChunkMessage,
  type TileUpdateMessage,
  type TilesRequestMessage,
} from "../../shared/protocol.js";
import { BlobEntity } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";
import { type TileView } from "./terrain.js";

export class Game {
  public room: Room;
  public scene: THREE.Scene;
  public entities: Entity[] = [];
  public selectedEntityId: string | null = null;
  public selectedTileKey: string | null = null;

  private _tiles = new Map<string, TileView>();
  private _tilesOrdered: TileView[] = [];
  private _streamResolve: (() => void) | null = null;

  public constructor(room: Room) {
    this.room = room;
    this.scene = new THREE.Scene();
    this.room.onMessage(MessageType.TILE_CHUNK, (msg: TileChunkMessage) => this._onTileChunk(msg));
    this.room.onMessage(MessageType.TILE_UPDATE, (msg: TileUpdateMessage) => this._onTileUpdate(msg));
  }

  /**
   * Request all tile chunks from the server.
   * Resolves when every chunk has been received and the tile map is complete.
   */
  public streamTiles(): Promise<void> {
    return new Promise((resolve) => {
      this._streamResolve = resolve;
      this.room.send(MessageType.TILES_REQUEST, { chunk: 0 } satisfies TilesRequestMessage);
    });
  }

  private _onTileChunk(msg: TileChunkMessage): void {
    for (const raw of msg.tiles) {
      const t = raw as TileView;
      if (typeof t.maxCompute !== "number") t.maxCompute = 0;
      this._tiles.set(t.key, t);
    }
    const next = msg.chunk + 1;
    if (next < msg.total) {
      this.room.send(MessageType.TILES_REQUEST, { chunk: next } satisfies TilesRequestMessage);
    } else {
      // All chunks in — build the ordered array (shared refs, so mutations are reflected)
      const count = getWorldTileCount();
      this._tilesOrdered = [];
      for (let tz = 0; tz < count; tz++)
        for (let tx = 0; tx < count; tx++) {
          const tile = this._tiles.get(getTileKey(tx, tz));
          if (tile) this._tilesOrdered.push(tile);
        }
      this._streamResolve?.();
      this._streamResolve = null;
    }
  }

  private _onTileUpdate(msg: TileUpdateMessage): void {
    const tile = this._tiles.get(msg.key);
    if (!tile) return;
    if (typeof msg.material === "number") tile.material = msg.material;
    if (typeof msg.compute === "number") tile.compute = msg.compute;
    if (typeof msg.canWalk === "boolean") tile.canWalk = msg.canWalk;
    if (typeof msg.canBuild === "boolean") tile.canBuild = msg.canBuild;
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
        unitType: UnitTypeValue;
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
        productionQueue: ArrayLike<UnitTypeValue>;
        productionProgressMs: number;
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
    this.selectedTileKey = null;
  }

  public clearSelection(): void {
    this.selectedEntityId = null;
    this.selectedTileKey = null;
  }

  public selectTile(key: string | null): void {
    this.selectedEntityId = null;
    this.selectedTileKey = key;
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

  public getMyResources(): ResourceCost {
    const player = this.room.state.players.get(this.room.sessionId) as
      | { biomass?: number; material?: number; compute?: number }
      | undefined;
    return {
      biomass: player?.biomass ?? 0,
      material: player?.material ?? 0,
      compute: player?.compute ?? 0,
    };
  }

  /** Live map of all tiles — mutated in-place by TILE_UPDATE messages. */
  public getTiles(): Map<string, TileView> { return this._tiles; }

  /** Ordered (tz, tx) array for terrain/forest rendering — object refs are live. */
  public getTilesOrdered(): TileView[] { return this._tilesOrdered; }

  public getTileAtWorld(x: number, z: number): TileView | null {
    const { tx, tz } = getTileCoordsFromWorld(x, z);
    return this._tiles.get(getTileKey(tx, tz)) ?? null;
  }

  public getSelectedTile(): TileView | null {
    if (!this.selectedTileKey) return null;
    return this._tiles.get(this.selectedTileKey) ?? null;
  }

  public getMyTownCenterPosition(): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    this.room.state.buildings.forEach((building) => {
      const candidate = building as { ownerId?: string; buildingType?: BuildingTypeValue; x?: number; y?: number };
      if (candidate.ownerId !== this.room.sessionId || candidate.buildingType !== BuildingType.TOWN_CENTER) return;
      best = { x: candidate.x ?? 0, z: candidate.y ?? 0 };
    });
    return best;
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

  public sendTrainIntent(buildingId: string, unitType: UnitTypeValue): void {
    this.room.send(MessageType.TRAIN, { buildingId, unitType } satisfies TrainMessage);
  }

  public sendSquadSpreadIntent(blobId: string, spread: SquadSpreadValue): void {
    this.room.send(MessageType.SQUAD_SPREAD, { blobId, spread } satisfies SquadSpreadMessage);
  }

  public runSelectionAction(actionId: string): void {
    const selected = this.getSelectedEntity();
    if (!selected) return;
    if (actionId.startsWith("train:")) {
      const unitType = Number(actionId.slice("train:".length)) as UnitTypeValue;
      this.sendTrainIntent(selected.id, unitType);
      return;
    }
    if (!(selected instanceof BlobEntity)) return;
    if (actionId === "spread:tight") this.sendSquadSpreadIntent(selected.id, SquadSpread.TIGHT);
    if (actionId === "spread:default") this.sendSquadSpreadIntent(selected.id, SquadSpread.DEFAULT);
    if (actionId === "spread:wide") this.sendSquadSpreadIntent(selected.id, SquadSpread.WIDE);
  }
}

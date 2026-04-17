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
  AttackTargetType,
  BlobAggroMode,
  type AttackMessage,
  type BlobAggroMessage,
  type GatherMessage,
  MessageType,
  type BuildMessage,
  type IntentMessage,
  type PathMessage,
  type SquadSpreadMessage,
  type TrainMessage,
  type TileChunkMessage,
  type TileUpdateMessage,
  type TilesRequestMessage,
} from "../../shared/protocol.js";
import { BlobEntity } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";
import type { BeamDrawer } from "./beam-drawer.js";
import type { BrightBeamDrawer } from "./bright-beam-drawer.js";
import type { RagdollFxSystem } from "./ragdoll-fx.js";
import type { ArrowFxSystem } from "./arrow-fx.js";
import type { BuildingDestructionFxSystem } from "./building-destruction-fx.js";
import { type TileView } from "./terrain.js";

export class Game {
  public room: Room;
  public scene: THREE.Scene;
  public entities: Entity[] = [];
  public selectedEntityId: string | null = null;
  public selectedTileKey: string | null = null;
  private beamDrawer: BeamDrawer | null = null;
  private brightBeamDrawer: BrightBeamDrawer | null = null;
  private ragdollFx: RagdollFxSystem | null = null;
  private arrowFx: ArrowFxSystem | null = null;
  private buildingDestructionFx: BuildingDestructionFxSystem | null = null;
  private _buildingSnapshots = new Map<string, {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
  }>();

  private _tiles = new Map<string, TileView>();
  private _tilesOrdered: TileView[] = [];
  private _streamResolve: (() => void) | null = null;
  private _dirtyTileVisualLayers = new Set<"forest" | "datacenters">(["forest", "datacenters"]);
  private _allTileVisualsDirty = true;
  private _walkabilityDirty = true;
  /** A* paths received from server per blob (owner client only). */
  private _blobPaths = new Map<string, { x: number; y: number }[]>();

  /** Updated every frame by `render.ts` for zoom-dependent squad affordances. */
  private _orbitCameraDistance = 165;
  private _orbitCameraDistanceMin = 26;
  private _orbitCameraDistanceMax = 420;

  public constructor(room: Room) {
    this.room = room;
    this.scene = new THREE.Scene();
    this.room.onMessage(MessageType.TILE_CHUNK, (msg: TileChunkMessage) => this._onTileChunk(msg));
    this.room.onMessage(MessageType.TILE_UPDATE, (msg: TileUpdateMessage) => this._onTileUpdate(msg));
    this.room.onMessage(MessageType.PATH, (msg: PathMessage) => {
      if (msg.waypoints.length === 0) {
        this._blobPaths.delete(msg.blobId);
      } else {
        this._blobPaths.set(msg.blobId, msg.waypoints);
      }
    });
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
      this._allTileVisualsDirty = true;
      this._dirtyTileVisualLayers.add("forest");
      this._dirtyTileVisualLayers.add("datacenters");
      this._walkabilityDirty = true;
      this._streamResolve?.();
      this._streamResolve = null;
    }
  }

  private _onTileUpdate(msg: TileUpdateMessage): void {
    const tile = this._tiles.get(msg.key);
    if (!tile) return;
    if (typeof msg.material === "number") {
      tile.material = msg.material;
      this._dirtyTileVisualLayers.add("forest");
    }
    if (typeof msg.compute === "number") {
      tile.compute = msg.compute;
      this._dirtyTileVisualLayers.add("datacenters");
    }
    if (typeof msg.canWalk === "boolean" && tile.canWalk !== msg.canWalk) {
      tile.canWalk = msg.canWalk;
      this._walkabilityDirty = true;
    }
    if (typeof msg.canBuild === "boolean") tile.canBuild = msg.canBuild;
  }

  public getPlayerColor(ownerId: string): number {
    const player = this.room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof player?.color === "number" ? player.color : 0x8899aa;
  }

  public setOrbitCameraForFrame(distance: number, distanceMin: number, distanceMax: number): void {
    this._orbitCameraDistance = distance;
    this._orbitCameraDistanceMin = distanceMin;
    this._orbitCameraDistanceMax = distanceMax;
  }

  /** 0 = zoomed in (min distance), 1 = zoomed out (max distance). */
  public getCameraZoomOut01(): number {
    const a = this._orbitCameraDistanceMin;
    const b = this._orbitCameraDistanceMax;
    if (b <= a) return 0;
    const t = (this._orbitCameraDistance - a) / (b - a);
    return Math.max(0, Math.min(1, t));
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
        actionState: number;
        aggroMode: number;
        combatGroupId: string;
        combatCenterX: number;
        combatCenterY: number;
        attackTargetType: number;
        attackTargetId: string;
        engagedTargetType: number;
        engagedTargetId: string;
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
        gatherTargetKey: string;
        carriedResourceType: number;
        carriedAmount: number;
      });
    });

    const seenBuildings = new Set<string>();
    this.room.state.buildings.forEach((building, id) => {
      seenBuildings.add(id as string);
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
      this._buildingSnapshots.set(id as string, {
        x: building.x,
        y: building.y,
        buildingType: building.buildingType as BuildingTypeValue,
        health: building.health,
        ownerId: building.ownerId,
      });
    });

    for (const [id, snapshot] of Array.from(this._buildingSnapshots.entries())) {
      if (seenBuildings.has(id)) continue;
      if (this.room.state.players.has(snapshot.ownerId)) {
        this.spawnBuildingDestructionFx({
          x: snapshot.x,
          z: snapshot.y,
          buildingType: snapshot.buildingType,
          teamColor: this.getPlayerColor(snapshot.ownerId),
        });
      }
      this._buildingSnapshots.delete(id);
    }

    for (const entity of [...this.entities]) {
      if (entity.isStale()) {
        this._blobPaths.delete(entity.id);
        entity.destroy();
      }
    }
  }

  public getSelectedEntity(): Entity | null {
    return this.selectedEntityId ? this.findEntity(this.selectedEntityId) : null;
  }

  /** Any selected squad (yours or enemy) — for UI. */
  public getSelectedBlobEntity(): BlobEntity | null {
    const entity = this.getSelectedEntity();
    return entity instanceof BlobEntity ? entity : null;
  }

  /** Selected squad only if you own it — for move orders. */
  public getSelectedMyBlobEntity(): BlobEntity | null {
    const b = this.getSelectedBlobEntity();
    return b?.isMine() ? b : null;
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

  public pickEntityAtWorldPoint(x: number, z: number): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!entity.containsWorldPoint(x, z)) continue;
      const distance = entity.worldDistanceTo(x, z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }
    return best;
  }

  public pickBlobAtWorldPoint(x: number, z: number, options?: { enemyOnly?: boolean; mineOnly?: boolean }): BlobEntity | null {
    let best: BlobEntity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity) || !entity.containsWorldPoint(x, z)) continue;
      if (options?.enemyOnly && entity.isMine()) continue;
      if (options?.mineOnly && !entity.isMine()) continue;
      const distance = entity.worldDistanceTo(x, z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }
    return best;
  }

  public pickBlobFromRay(raycaster: THREE.Raycaster, options?: { enemyOnly?: boolean; mineOnly?: boolean }): BlobEntity | null {
    let best: BlobEntity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (options?.enemyOnly && entity.isMine()) continue;
      if (options?.mineOnly && !entity.isMine()) continue;
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

  public pickAttackableEntityAtWorldPoint(
    x: number,
    z: number,
    options?: { enemyOnly?: boolean; mineOnly?: boolean }
  ): BlobEntity | BuildingEntity | null {
    let best: BlobEntity | BuildingEntity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity) && !(entity instanceof BuildingEntity)) continue;
      if (!entity.containsWorldPoint(x, z)) continue;
      if (options?.enemyOnly && entity.isOwnedByMe()) continue;
      if (options?.mineOnly && !entity.isOwnedByMe()) continue;
      const distance = entity.worldDistanceTo(x, z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }
    return best;
  }

  public pickAttackableEntityFromRay(
    raycaster: THREE.Raycaster,
    options?: { enemyOnly?: boolean; mineOnly?: boolean }
  ): BlobEntity | BuildingEntity | null {
    let best: BlobEntity | BuildingEntity | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity) && !(entity instanceof BuildingEntity)) continue;
      if (options?.enemyOnly && entity.isOwnedByMe()) continue;
      if (options?.mineOnly && !entity.isOwnedByMe()) continue;
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

  /** Nearest entity along the ray (any owner) — for selection / inspect. */
  public pickEntityFromRay(raycaster: THREE.Raycaster): Entity | null {
    let best: Entity | null = null;
    let bestDistance = Infinity;

    for (const entity of this.entities) {
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

  /** A* path for a blob (owner-client only). Null when no active path. */
  public getBlobPath(id: string): { x: number; y: number }[] | null {
    return this._blobPaths.get(id) ?? null;
  }

  /** Live map of all tiles — mutated in-place by TILE_UPDATE messages. */
  public getTiles(): Map<string, TileView> { return this._tiles; }

  /** Ordered (tz, tx) array for terrain/forest rendering — object refs are live. */
  public getTilesOrdered(): TileView[] { return this._tilesOrdered; }

  public consumeTileVisualDirty(): { all: boolean; layers: Set<"forest" | "datacenters"> } {
    const dirty = {
      all: this._allTileVisualsDirty,
      layers: new Set(this._dirtyTileVisualLayers),
    };
    this._allTileVisualsDirty = false;
    this._dirtyTileVisualLayers.clear();
    return dirty;
  }

  public consumeWalkabilityDirty(): boolean {
    const dirty = this._walkabilityDirty;
    this._walkabilityDirty = false;
    return dirty;
  }

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

  public setBeamDrawer(beamDrawer: BeamDrawer): void {
    this.beamDrawer = beamDrawer;
  }

  public setBrightBeamDrawer(brightBeamDrawer: BrightBeamDrawer): void {
    this.brightBeamDrawer = brightBeamDrawer;
  }

  public setRagdollFxSystem(ragdollFx: RagdollFxSystem): void {
    this.ragdollFx = ragdollFx;
  }

  public setArrowFxSystem(arrowFx: ArrowFxSystem): void {
    this.arrowFx = arrowFx;
  }

  public setBuildingDestructionFxSystem(buildingDestructionFx: BuildingDestructionFxSystem): void {
    this.buildingDestructionFx = buildingDestructionFx;
  }

  public clearBeamDraws(): void {
    this.beamDrawer?.beginFrame();
    this.brightBeamDrawer?.beginFrame();
  }

  public drawBeam(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color): void {
    this.beamDrawer?.drawBeam(from, to, width, depth, color);
  }

  public drawBrightBeam(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color): void {
    (this.brightBeamDrawer ?? this.beamDrawer)?.drawBeam(from, to, width, depth, color);
  }

  public flushBeamDraws(): void {
    this.beamDrawer?.finishFrame();
    this.brightBeamDrawer?.finishFrame();
  }

  public updateRagdollFx(dt: number): void {
    this.ragdollFx?.update(dt, this._tiles);
  }

  public updateArrowFx(dt: number): void {
    this.arrowFx?.update(dt, this._tiles);
  }

  public spawnUnitDeathFx(params: {
    x: number;
    z: number;
    dirX: number;
    dirZ: number;
    teamColor: number;
    unitType: UnitTypeValue;
  }): void {
    this.ragdollFx?.spawnDeathFx({
      ...params,
      tiles: this._tiles,
    });
  }

  public spawnArrowFx(params: {
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
    speed: number;
  }): void {
    this.arrowFx?.spawn(params);
  }

  public spawnBuildingDestructionFx(params: {
    x: number;
    z: number;
    buildingType: BuildingTypeValue;
    teamColor: number;
  }): void {
    this.buildingDestructionFx?.spawn({
      ...params,
      tiles: this._tiles,
    });
  }

  public sendMoveIntent(targetX: number, targetY: number): void {
    const blob = this.getSelectedMyBlobEntity();
    if (!blob) return;
    this.room.send(MessageType.INTENT, { blobId: blob.id, targetX, targetY } satisfies IntentMessage);
  }

  public sendAttackIntent(blobId: string, targetType: number, targetId: string): void {
    this.room.send(MessageType.ATTACK, {
      blobId,
      targetType,
      targetId,
    } satisfies AttackMessage);
  }

  public sendGatherIntent(blobId: string, tileKey: string): void {
    this.room.send(MessageType.GATHER, { blobId, tileKey } satisfies GatherMessage);
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

  public sendBlobAggroIntent(blobId: string, aggroMode: number): void {
    this.room.send(MessageType.BLOB_AGGRO, { blobId, aggroMode } satisfies BlobAggroMessage);
  }

  public runSelectionAction(actionId: string): void {
    const selected = this.getSelectedEntity();
    if (!selected) return;
    if (actionId.startsWith("train:")) {
      if (!(selected instanceof BuildingEntity) || !selected.isOwnedByMe()) return;
      const unitType = Number(actionId.slice("train:".length)) as UnitTypeValue;
      this.sendTrainIntent(selected.id, unitType);
      return;
    }
    if (!(selected instanceof BlobEntity) || !selected.isMine()) return;
    if (actionId === "spread:tight") this.sendSquadSpreadIntent(selected.id, SquadSpread.TIGHT);
    if (actionId === "spread:default") this.sendSquadSpreadIntent(selected.id, SquadSpread.DEFAULT);
    if (actionId === "spread:wide") this.sendSquadSpreadIntent(selected.id, SquadSpread.WIDE);
    if (actionId === "aggro:active") this.sendBlobAggroIntent(selected.id, BlobAggroMode.ACTIVE);
    if (actionId === "aggro:passive") this.sendBlobAggroIntent(selected.id, BlobAggroMode.PASSIVE);
  }

  public getBlobCombatContext(blobId: string): {
    center: { x: number; z: number };
    enemies: BlobEntity[];
    allies: BlobEntity[];
    totalUnitCount: number;
  } | null {
    const blob = this.room.state.blobs.get(blobId) as {
      combatGroupId?: string;
      combatCenterX?: number;
      combatCenterY?: number;
      ownerId?: string;
      unitCount?: number;
    } | undefined;
    if (!blob?.combatGroupId) return null;

    const enemies: BlobEntity[] = [];
    const allies: BlobEntity[] = [];
    let totalUnitCount = 0;
    this.room.state.blobs.forEach((candidate, id) => {
      const snapshot = candidate as {
        combatGroupId?: string;
        ownerId?: string;
        unitCount?: number;
      };
      if (snapshot.combatGroupId !== blob.combatGroupId) return;
      totalUnitCount += snapshot.unitCount ?? 0;
      const entity = this.findBlobEntity(id as string);
      if (!entity) return;
      if (snapshot.ownerId === blob.ownerId) allies.push(entity);
      else enemies.push(entity);
    });

    return {
      center: {
        x: blob.combatCenterX ?? 0,
        z: blob.combatCenterY ?? 0,
      },
      enemies,
      allies,
      totalUnitCount,
    };
  }
}

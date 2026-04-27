import * as THREE from "three";
import type { Room } from "@colyseus/sdk";
import type { Entity } from "./entity.js";
import {
  BuildingType,
  GAME_RULES,
  SquadSpread,
  UnitType,
  canAfford,
  getAllChunkKeys,
  getTileCenter,
  getBuildingRules,
  getChunkCoordsFromTile,
  getChunkKey,
  getChunkCoordsFromWorld,
  getChunkKeysInRadius,
  getUnitTrainCost,
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
  BlobGatherPhase,
  CarriedResourceType,
  type AttackMessage,
  type ChatBroadcastMessage,
  type ChatMessage,
  type BlobAggroMessage,
  type GatherMessage,
  MessageType,
  type BuildMessage,
  type IntentMessage,
  type PathMessage,
  type SquadSpreadMessage,
  type TrainMessage,
  type TileChunkMessage,
  type TileChunksRequestMessage,
  type TileUpdateMessage,
  type TilesRequestMessage,
  type SetNameMessage,
  type SystemNoticeMessage,
  type RoundResetMessage,
  type SetRallyMessage,
} from "../../shared/protocol.js";
import { BlobEntity, type UnitContinuitySeed } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";
import type { BeamDrawer } from "./beam-drawer.js";
import type { BrightBeamDrawer } from "./bright-beam-drawer.js";
import type { RagdollFxSystem } from "./ragdoll-fx.js";
import type { ArrowFxSystem } from "./arrow-fx.js";
import type { BuildingDestructionFxSystem } from "./building-destruction-fx.js";
import { type TileView } from "./terrain.js";
import { UnitCollisionSystem } from "./unit-collision.js";
import { isMilitaryUnitType, playDefaultCommandVoice, playUnitSpawnVoiceNearCamera, playUnitVoiceOrDefault } from "./unit-voice.js";

type TileVisualLayerId = "forest" | "datacenters" | "rocks" | "foliage";

export class Game {
  private static readonly FLOATING_RESOURCE_TEXT_LIFE = 1.15;
  private static readonly UI_FEED_MAX = 32;

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
  private readonly unitCollision = new UnitCollisionSystem();
  private _buildingSnapshots = new Map<string, {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
  }>();

  private _tiles = new Map<string, TileView>();
  private _tilesOrdered: TileView[] = [];
  private _tilesByChunkKey = new Map<string, TileView[]>();
  private _streamResolve: (() => void) | null = null;
  private _pendingChunkResolvers = new Map<string, Array<() => void>>();
  private _loadedChunkKeys = new Set<string>();
  private _chunkLoadStartedAt = 0;
  private _firstChunkMs: number | null = null;
  private _spawnChunksMs: number | null = null;
  private _fullChunksMs: number | null = null;
  private _dirtyTileVisualLayers = new Set<TileVisualLayerId>(["forest", "datacenters", "rocks", "foliage"]);
  private _allTileVisualsDirty = true;
  private _walkabilityDirty = true;
  private _terrainAllDirty = true;
  private _dirtyTerrainChunkKeys = new Set<string>();
  /** A* paths received from server per blob (owner client only). */
  private _blobPaths = new Map<string, { x: number; y: number }[]>();
  private _blobCarrySnapshots = new Map<string, {
    ownerId: string;
    x: number;
    y: number;
    carriedAmount: number;
    carriedResourceType: number;
    gatherPhase: number;
  }>();
  private _floatingResourceTexts: Array<{
    x: number;
    z: number;
    amount: number;
    resourceType: number;
    bornAt: number;
  }> = [];
  private _worldWarnings: Array<{
    x: number;
    z: number;
    text: string;
    bornAt: number;
  }> = [];
  private _fogOfWarVisibilityQuery: ((x: number, z: number) => boolean) | null = null;
  private _uiFeed: Array<
    | ({ type: "chat"; senderId: string; senderName: string; text: string; sentAt: number } & { id: string })
    | ({ type: "system"; text: string; kind: SystemNoticeMessage["kind"]; sentAt: number } & { id: string })
  > = [];
  private _roundResetCount = 0;
  private _streamPromise: Promise<void> | null = null;
  private _warningHandler: ((text: string) => void) | null = null;

  /** Updated every frame by `render.ts` for zoom-dependent squad affordances. */
  private _orbitCameraDistance = 165;
  private _orbitCameraDistanceMin = 26;
  private _orbitCameraDistanceMax = 420;
  private _orbitCameraFovDeg = 52;
  private _orbitCameraWorldX = 0;
  private _orbitCameraWorldY = 0;
  private _orbitCameraWorldZ = 0;

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
    this.room.onMessage(MessageType.CHAT, (msg: ChatBroadcastMessage) => {
      this._uiFeed.push({
        id: `chat:${msg.sentAt}:${msg.senderId}:${this._uiFeed.length}`,
        type: "chat",
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        sentAt: msg.sentAt,
      });
      this.trimUiFeed();
    });
    this.room.onMessage(MessageType.SYSTEM_NOTICE, (msg: SystemNoticeMessage) => {
      this._uiFeed.push({
        id: `sys:${msg.sentAt}:${msg.kind}:${this._uiFeed.length}`,
        type: "system",
        text: msg.text,
        kind: msg.kind,
        sentAt: msg.sentAt,
      });
      this.trimUiFeed();
    });
    this.room.onMessage(MessageType.ROUND_RESET, (_msg: RoundResetMessage) => {
      this.resetForNewRound();
      void this.streamSpawnChunks().then(() => this.streamRemainingChunks());
    });
  }

  private trimUiFeed(): void {
    if (this._uiFeed.length <= Game.UI_FEED_MAX) return;
    this._uiFeed.splice(0, this._uiFeed.length - Game.UI_FEED_MAX);
  }

  /**
   * Request all tile chunks from the server.
   * Resolves when every chunk has been received and the tile map is complete.
   */
  public streamTiles(): Promise<void> {
    if (this._streamPromise) return this._streamPromise;
    this._streamPromise = new Promise((resolve) => {
      this._streamResolve = resolve;
      this.room.send(MessageType.TILES_REQUEST, { chunk: 0 } satisfies TilesRequestMessage);
    });
    return this._streamPromise;
  }

  public async streamSpawnChunks(radius = 1): Promise<void> {
    const center = this.getMyTownCenterPosition() ?? { x: 0, z: 0 };
    const chunk = getChunkCoordsFromWorld(center.x, center.z);
    const keys = getChunkKeysInRadius(chunk.cx, chunk.cz, radius);
    const start = performance.now();
    if (this._chunkLoadStartedAt <= 0) this._chunkLoadStartedAt = start;
    await this.requestTileChunks(keys);
    this._spawnChunksMs = performance.now() - start;
    console.info(`[chunks] spawn neighborhood loaded in ${Math.round(this._spawnChunksMs)}ms`, {
      chunkSize: "12x12 tiles",
      radius,
      requested: keys.length,
      loadedTotal: this._loadedChunkKeys.size,
    });
  }

  public async streamRemainingChunks(): Promise<void> {
    const all = getAllChunkKeys();
    const remaining = all.filter((key) => !this._loadedChunkKeys.has(key));
    const start = performance.now();
    await this.requestTileChunks(remaining);
    this._fullChunksMs = performance.now() - (this._chunkLoadStartedAt || start);
    console.info(`[chunks] full debug world loaded in ${Math.round(this._fullChunksMs)}ms`, {
      total: all.length,
      requested: remaining.length,
      loadedTotal: this._loadedChunkKeys.size,
    });
  }

  private requestTileChunks(keys: string[]): Promise<void> {
    const missing = keys.filter((key) => !this._loadedChunkKeys.has(key));
    if (missing.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let remaining = missing.length;
      const done = () => {
        remaining -= 1;
        if (remaining <= 0) resolve();
      };
      for (const key of missing) {
        const resolvers = this._pendingChunkResolvers.get(key) ?? [];
        resolvers.push(done);
        this._pendingChunkResolvers.set(key, resolvers);
      }
      this.room.send(MessageType.TILE_CHUNKS_REQUEST, { keys: missing } satisfies TileChunksRequestMessage);
    });
  }

  private _onTileChunk(msg: TileChunkMessage): void {
    const key = typeof msg.key === "string" && msg.key.length > 0 ? msg.key : null;
    if (this._chunkLoadStartedAt <= 0) this._chunkLoadStartedAt = performance.now();
    const chunkTiles: TileView[] = [];
    for (const raw of msg.tiles) {
      const t = raw as TileView;
      if (typeof t.maxCompute !== "number") t.maxCompute = 0;
      this._tiles.set(t.key, t);
      chunkTiles.push(t);
    }
    if (key) {
      this._tilesByChunkKey.set(key, chunkTiles);
      this._loadedChunkKeys.add(key);
      if (this._firstChunkMs === null) {
        this._firstChunkMs = performance.now() - this._chunkLoadStartedAt;
        console.info(`[chunks] first chunk loaded in ${Math.round(this._firstChunkMs)}ms`, {
          key,
          tiles: msg.tiles.length,
        });
      }
      const resolvers = this._pendingChunkResolvers.get(key) ?? [];
      this._pendingChunkResolvers.delete(key);
      for (const resolve of resolvers) resolve();
      this.rebuildLoadedTileOrder();
      this._allTileVisualsDirty = true;
      this._dirtyTileVisualLayers.add("forest");
      this._dirtyTileVisualLayers.add("datacenters");
      this._dirtyTileVisualLayers.add("rocks");
      this._dirtyTileVisualLayers.add("foliage");
      this._walkabilityDirty = true;
      this._dirtyTerrainChunkKeys.add(key);
      return;
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
      this._dirtyTileVisualLayers.add("rocks");
      this._dirtyTileVisualLayers.add("foliage");
      this._walkabilityDirty = true;
      this.rebuildChunkTileBuckets();
      this._terrainAllDirty = true;
      this._streamResolve?.();
      this._streamResolve = null;
      this._streamPromise = null;
    }
  }

  private rebuildLoadedTileOrder(): void {
    const count = getWorldTileCount();
    this._tilesOrdered = [];
    for (let tz = 0; tz < count; tz++) {
      for (let tx = 0; tx < count; tx++) {
        const tile = this._tiles.get(getTileKey(tx, tz));
        if (tile) this._tilesOrdered.push(tile);
      }
    }
  }

  private rebuildChunkTileBuckets(): void {
    this._tilesByChunkKey.clear();
    for (const tile of this._tiles.values()) {
      const { cx, cz } = getChunkCoordsFromTile(tile.tx, tile.tz);
      const key = getChunkKey(cx, cz);
      const bucket = this._tilesByChunkKey.get(key);
      if (bucket) bucket.push(tile);
      else this._tilesByChunkKey.set(key, [tile]);
    }
  }

  private resetForNewRound(): void {
    this.selectedEntityId = null;
    this.selectedTileKey = null;
    this._tiles.clear();
    this._tilesOrdered = [];
    this._tilesByChunkKey.clear();
    this._loadedChunkKeys.clear();
    this._pendingChunkResolvers.clear();
    this._chunkLoadStartedAt = 0;
    this._firstChunkMs = null;
    this._spawnChunksMs = null;
    this._fullChunksMs = null;
    this._blobPaths.clear();
    this._blobCarrySnapshots.clear();
    this._buildingSnapshots.clear();
    this._floatingResourceTexts = [];
    this._worldWarnings = [];
    this._dirtyTileVisualLayers.add("forest");
    this._dirtyTileVisualLayers.add("datacenters");
    this._dirtyTileVisualLayers.add("rocks");
    this._dirtyTileVisualLayers.add("foliage");
    this._allTileVisualsDirty = true;
    this._walkabilityDirty = true;
    this._terrainAllDirty = true;
    this._dirtyTerrainChunkKeys.clear();
    this._streamResolve = null;
    this._streamPromise = null;
    this._roundResetCount += 1;
  }

  private _onTileUpdate(msg: TileUpdateMessage): void {
    const tile = this._tiles.get(msg.key);
    if (!tile) return;
    if (typeof msg.material === "number") {
      tile.material = msg.material;
      this._dirtyTileVisualLayers.add("forest");
      this._dirtyTileVisualLayers.add("foliage");
    }
    if (typeof msg.compute === "number") {
      tile.compute = msg.compute;
      this._dirtyTileVisualLayers.add("datacenters");
      this._dirtyTileVisualLayers.add("rocks");
      this._dirtyTileVisualLayers.add("foliage");
    }
    if (typeof msg.canWalk === "boolean" && tile.canWalk !== msg.canWalk) {
      tile.canWalk = msg.canWalk;
      this._walkabilityDirty = true;
    }
    if (typeof msg.canBuild === "boolean") tile.canBuild = msg.canBuild;
    let heightChanged = false;
    if (typeof msg.h00 === "number" && tile.h00 !== msg.h00) {
      tile.h00 = msg.h00;
      heightChanged = true;
    }
    if (typeof msg.h10 === "number" && tile.h10 !== msg.h10) {
      tile.h10 = msg.h10;
      heightChanged = true;
    }
    if (typeof msg.h11 === "number" && tile.h11 !== msg.h11) {
      tile.h11 = msg.h11;
      heightChanged = true;
    }
    if (typeof msg.h01 === "number" && tile.h01 !== msg.h01) {
      tile.h01 = msg.h01;
      heightChanged = true;
    }
    if (typeof msg.height === "number" && tile.height !== msg.height) {
      tile.height = msg.height;
      heightChanged = true;
    }
    if (heightChanged) {
      const chunk = getChunkCoordsFromTile(tile.tx, tile.tz);
      this._dirtyTerrainChunkKeys.add(getChunkKey(chunk.cx, chunk.cz));
      this._allTileVisualsDirty = true;
      this._dirtyTileVisualLayers.add("forest");
      this._dirtyTileVisualLayers.add("datacenters");
      this._dirtyTileVisualLayers.add("rocks");
      this._dirtyTileVisualLayers.add("foliage");
      this._walkabilityDirty = true;
    }
  }

  public getPlayerColor(ownerId: string): number {
    const player = this.room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof player?.color === "number" ? player.color : 0x8899aa;
  }

  public setOrbitCameraForFrame(
    distance: number,
    distanceMin: number,
    distanceMax: number,
    fovDeg: number,
    cameraWorldPosition?: THREE.Vector3
  ): void {
    this._orbitCameraDistance = distance;
    this._orbitCameraDistanceMin = distanceMin;
    this._orbitCameraDistanceMax = distanceMax;
    this._orbitCameraFovDeg = fovDeg;
    if (cameraWorldPosition) {
      this._orbitCameraWorldX = cameraWorldPosition.x;
      this._orbitCameraWorldY = cameraWorldPosition.y;
      this._orbitCameraWorldZ = cameraWorldPosition.z;
    }
  }

  /** Approximate world-units occupied by one screen pixel at the current orbit distance. */
  public getOrbitWorldUnitsPerScreenPixel(): number {
    const viewportH = Math.max(1, window.innerHeight || 1);
    const fovRad = THREE.MathUtils.degToRad(this._orbitCameraFovDeg);
    const worldHeightAtDistance = 2 * this._orbitCameraDistance * Math.tan(fovRad * 0.5);
    return worldHeightAtDistance / viewportH;
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

  public findBuildingEntity(id: string): BuildingEntity | null {
    const entity = this.findEntity(id);
    return entity instanceof BuildingEntity ? entity : null;
  }

  public sync(): void {
    const nowSec = performance.now() / 1000;
    this.room.state.blobs.forEach((blob, id) => {
      const blobId = id as string;
      const prev = this._blobCarrySnapshots.get(blobId);
      const next = {
        ownerId: blob.ownerId,
        x: blob.x,
        y: blob.y,
        carriedAmount: blob.carriedAmount,
        carriedResourceType: blob.carriedResourceType,
        gatherPhase: blob.gatherPhase,
      };
      this.maybeQueueFloatingResourceText(prev, next, nowSec);
      this._blobCarrySnapshots.set(blobId, next);

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
        gatherTargetBuildingId: string;
        gatherPhase: number;
        gatherTimerMs: number;
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
        farmGrowth: number;
        attackTargetBlobId: string;
        rallySet?: number;
        rallyX?: number;
        rallyY?: number;
        constructionBlocksRequired?: number;
        constructionBlocksDelivered?: number;
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

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const entity = this.entities[i]!;
      if (entity.isStale()) {
        this._blobPaths.delete(entity.id);
        this._blobCarrySnapshots.delete(entity.id);
        entity.destroy();
      }
    }

    this._floatingResourceTexts = this._floatingResourceTexts.filter(
      (text) => nowSec - text.bornAt < Game.FLOATING_RESOURCE_TEXT_LIFE
    );
    this._worldWarnings = this._worldWarnings.filter(
      (warning) => nowSec - warning.bornAt < 2.4
    );
  }

  private maybeQueueFloatingResourceText(
    prev:
      | {
          ownerId: string;
          x: number;
          y: number;
          carriedAmount: number;
          carriedResourceType: number;
          gatherPhase: number;
        }
      | undefined,
    next: {
      ownerId: string;
      x: number;
      y: number;
      carriedAmount: number;
      carriedResourceType: number;
      gatherPhase: number;
    },
    nowSec: number
  ): void {
    if (next.ownerId !== this.room.sessionId || !prev) return;
    if (prev.carriedAmount <= 0) return;
    if (prev.carriedResourceType === CarriedResourceType.NONE) return;
    if (next.carriedAmount > 0) return;
    if (prev.gatherPhase !== BlobGatherPhase.DROPPING_OFF) return;
    if (
      next.gatherPhase !== BlobGatherPhase.MOVING_TO_RESOURCE &&
      next.gatherPhase !== BlobGatherPhase.PICKING_UP &&
      next.gatherPhase !== BlobGatherPhase.RETURNING &&
      next.gatherPhase !== BlobGatherPhase.NONE
    ) {
      return;
    }
    this._floatingResourceTexts.push({
      x: prev.x,
      z: prev.y,
      amount: prev.carriedAmount,
      resourceType: prev.carriedResourceType,
      bornAt: nowSec,
    });
  }

  public getSelectedEntity(): Entity | null {
    if (!this.selectedEntityId) return null;
    const entity = this.findEntity(this.selectedEntityId);
    return entity && entity.mesh.visible ? entity : null;
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

  public selectEntity(entityId: string | null): void {
    this.selectedEntityId = entityId;
    this.selectedTileKey = null;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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
      if (!entity.mesh.visible) continue;
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

  public getMyPlayerName(): string {
    const player = this.room.state.players.get(this.room.sessionId) as { name?: string } | undefined;
    return player?.name ?? "Player";
  }

  public getPlayerName(sessionId: string): string {
    const player = this.room.state.players.get(sessionId) as { name?: string } | undefined;
    return player?.name ?? `Player ${sessionId.slice(0, 4)}`;
  }

  public getUiFeed(): ReadonlyArray<
    | { id: string; type: "chat"; senderId: string; senderName: string; text: string; sentAt: number }
    | { id: string; type: "system"; text: string; kind: SystemNoticeMessage["kind"]; sentAt: number }
  > {
    return this._uiFeed;
  }

  /** A* path for a blob (owner-client only). Null when no active path. */
  public getBlobPath(id: string): { x: number; y: number }[] | null {
    return this._blobPaths.get(id) ?? null;
  }

  /** Live map of all tiles — mutated in-place by TILE_UPDATE messages. */
  public getTiles(): Map<string, TileView> { return this._tiles; }

  /** Ordered (tz, tx) array for terrain/forest rendering — object refs are live. */
  public getTilesOrdered(): TileView[] { return this._tilesOrdered; }

  public getTilesForChunk(key: string): TileView[] { return this._tilesByChunkKey.get(key) ?? []; }

  public beginUnitCollisionFrame(): void {
    this.unitCollision.beginFrame(this._tiles);
  }

  public getUnitCollisionSystem(): UnitCollisionSystem {
    return this.unitCollision;
  }

  public consumeRebalancedUnitSeeds(params: {
    receiverId: string;
    ownerId: string;
    unitType: UnitTypeValue;
    x: number;
    z: number;
    count: number;
  }): UnitContinuitySeed[] {
    let remaining = Math.max(0, params.count);
    if (remaining === 0) return [];
    const donors = this.entities
      .filter((entity): entity is BlobEntity => entity instanceof BlobEntity)
      .filter((entity) =>
        entity.id !== params.receiverId &&
        entity.isStale() &&
        entity.getOwnerId() === params.ownerId &&
        entity.getUnitType() === params.unitType
      )
      .map((entity) => {
        const center = entity.getPredictedWorldCenter();
        return {
          entity,
          d2: (center.x - params.x) ** 2 + (center.z - params.z) ** 2,
        };
      })
      .sort((a, b) => a.d2 - b.d2);

    const seeds: UnitContinuitySeed[] = [];
    for (const donor of donors) {
      if (remaining <= 0) break;
      const pulled = donor.entity.extractContinuityUnitSeeds(remaining, params.x, params.z);
      seeds.push(...pulled);
      remaining -= pulled.length;
    }
    return seeds;
  }

  public getCarriedTreeCountByTile(): Map<string, number> {
    const counts = new Map<string, number>();
    this.room.state.blobs.forEach((raw) => {
      const blob = raw as {
        unitType?: number;
        gatherTargetKey?: string;
        carriedResourceType?: number;
        carriedAmount?: number;
        unitCount?: number;
      };
      if (
        blob.unitType === UnitType.VILLAGER &&
        typeof blob.gatherTargetKey === "string" &&
        blob.gatherTargetKey.length > 0 &&
        blob.carriedResourceType === CarriedResourceType.MATERIAL &&
        (blob.carriedAmount ?? 0) > 0
      ) {
        const perCarrier = 12;
        const carriers = Math.min(
          Math.max(1, blob.unitCount ?? 1),
          Math.ceil((blob.carriedAmount ?? 0) / perCarrier)
        );
        counts.set(blob.gatherTargetKey, (counts.get(blob.gatherTargetKey) ?? 0) + carriers);
      }
    });
    return counts;
  }

  public getCarriedComputeCountByTile(): Map<string, number> {
    const counts = new Map<string, number>();
    this.room.state.blobs.forEach((raw) => {
      const blob = raw as {
        unitType?: number;
        gatherTargetKey?: string;
        carriedResourceType?: number;
        carriedAmount?: number;
        unitCount?: number;
      };
      if (
        blob.unitType === UnitType.VILLAGER &&
        typeof blob.gatherTargetKey === "string" &&
        blob.gatherTargetKey.length > 0 &&
        blob.carriedResourceType === CarriedResourceType.COMPUTE &&
        (blob.carriedAmount ?? 0) > 0
      ) {
        const perCarrier = 12;
        const carriers = Math.min(
          Math.max(1, blob.unitCount ?? 1),
          Math.ceil((blob.carriedAmount ?? 0) / perCarrier)
        );
        counts.set(blob.gatherTargetKey, (counts.get(blob.gatherTargetKey) ?? 0) + carriers);
      }
    });
    return counts;
  }

  public consumeTileVisualDirty(): { all: boolean; layers: Set<TileVisualLayerId> } {
    const dirty = {
      all: this._allTileVisualsDirty,
      layers: new Set(this._dirtyTileVisualLayers),
    };
    this._allTileVisualsDirty = false;
    this._dirtyTileVisualLayers.clear();
    return dirty;
  }

  public markAllTileVisualsDirty(): void {
    this._allTileVisualsDirty = true;
    this._dirtyTileVisualLayers.add("forest");
    this._dirtyTileVisualLayers.add("datacenters");
    this._dirtyTileVisualLayers.add("rocks");
    this._dirtyTileVisualLayers.add("foliage");
  }

  public consumeWalkabilityDirty(): boolean {
    const dirty = this._walkabilityDirty;
    this._walkabilityDirty = false;
    return dirty;
  }

  public consumeTerrainDirty(): { all: boolean; chunkKeys: Set<string> } {
    const dirty = {
      all: this._terrainAllDirty,
      chunkKeys: new Set(this._dirtyTerrainChunkKeys),
    };
    this._terrainAllDirty = false;
    this._dirtyTerrainChunkKeys.clear();
    return dirty;
  }

  public getTileAtWorld(x: number, z: number): TileView | null {
    const { tx, tz } = getTileCoordsFromWorld(x, z);
    return this._tiles.get(getTileKey(tx, tz)) ?? null;
  }

  public getTileByKey(key: string): TileView | null {
    return this._tiles.get(key) ?? null;
  }

  public getSelectedTile(): TileView | null {
    if (!this.selectedTileKey) return null;
    return this._tiles.get(this.selectedTileKey) ?? null;
  }

  public getFloatingResourceTexts(nowSec: number): Array<{
    x: number;
    z: number;
    amount: number;
    resourceType: number;
    age: number;
  }> {
    return this._floatingResourceTexts
      .map((text) => ({
        x: text.x,
        z: text.z,
        amount: text.amount,
        resourceType: text.resourceType,
        age: nowSec - text.bornAt,
      }))
      .filter((text) => text.age >= 0 && text.age < Game.FLOATING_RESOURCE_TEXT_LIFE);
  }

  public addWorldWarning(x: number, z: number, text: string): void {
    const nowSec = performance.now() / 1000;
    this._worldWarnings.push({ x, z, text, bornAt: nowSec });
    if (this._worldWarnings.length > 8) this._worldWarnings.shift();
  }

  public getWorldWarnings(nowSec: number): Array<{ x: number; z: number; text: string; age: number }> {
    return this._worldWarnings
      .map((warning) => ({
        x: warning.x,
        z: warning.z,
        text: warning.text,
        age: nowSec - warning.bornAt,
      }))
      .filter((warning) => warning.age >= 0 && warning.age < 2.4);
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

  public getMyTownCenterEntity(): BuildingEntity | null {
    return this.getMyBuildingsOfType(BuildingType.TOWN_CENTER)[0] ?? null;
  }

  public getMyBuildingsOfType(buildingType: BuildingTypeValue): BuildingEntity[] {
    return this.entities.filter((entity): entity is BuildingEntity =>
      entity instanceof BuildingEntity &&
      entity.isOwnedByMe() &&
      entity.mesh.visible &&
      entity.getBuildingType() === buildingType
    );
  }

  public getMyUnitCount(unitType: UnitTypeValue): number {
    let count = 0;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (!entity.isOwnedByMe() || entity.getUnitType() !== unitType) continue;
      count += entity.getUnitCount();
    }
    return count;
  }

  public hasQueuedUnit(unitType: UnitTypeValue): boolean {
    let queued = false;
    this.room.state.buildings.forEach((raw) => {
      const building = raw as { ownerId?: string; productionQueue?: ArrayLike<UnitTypeValue> };
      if (building.ownerId !== this.room.sessionId) return;
      const queue = Array.from(building.productionQueue ?? []);
      if (queue.some((candidate) => candidate === unitType)) queued = true;
    });
    return queued;
  }

  public hasMyGathererForBuilding(buildingId: string): boolean {
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (!entity.isOwnedByMe()) continue;
      if (entity.getGatherTargetBuildingId() === buildingId) return true;
    }
    return false;
  }

  public hasMyGathererForResource(resourceType: CarriedResourceType): boolean {
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (!entity.isOwnedByMe() || entity.getUnitType() !== UnitType.VILLAGER) continue;
      if (entity.getCarriedResourceType() === resourceType) return true;
      const tile = this._tiles.get(entity.getGatherTargetKey());
      if (resourceType === CarriedResourceType.COMPUTE && tile && tile.maxCompute > 0) return true;
      if (resourceType === CarriedResourceType.MATERIAL && tile && tile.maxMaterial > 0) return true;
    }
    return false;
  }

  public getNearestResourceTile(
    resourceType: CarriedResourceType,
    from: { x: number; z: number } = this.getMyTownCenterPosition() ?? { x: 0, z: 0 }
  ): TileView | null {
    let best: TileView | null = null;
    let bestDistance = Infinity;
    for (const tile of this._tiles.values()) {
      const hasResource =
        resourceType === CarriedResourceType.COMPUTE
          ? tile.compute > 0 || tile.maxCompute > 0
          : resourceType === CarriedResourceType.MATERIAL
            ? tile.material > 0 || tile.maxMaterial > 0
            : false;
      if (!hasResource) continue;
      const center = getTileCenter(tile.tx, tile.tz);
      const distance = Math.hypot(center.x - from.x, center.z - from.z);
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
    return best;
  }

  public getRecommendedBuildTileNear(
    buildingType: BuildingTypeValue,
    from: { x: number; z: number } = this.getMyTownCenterPosition() ?? { x: 0, z: 0 }
  ): TileView | null {
    let best: TileView | null = null;
    let bestScore = Infinity;
    const existingBuildings = this.entities.filter((entity): entity is BuildingEntity =>
      entity instanceof BuildingEntity &&
      entity.isOwnedByMe() &&
      entity.mesh.visible
    );
    for (const tile of this._tiles.values()) {
      if (!tile.canBuild) continue;
      const center = getTileCenter(tile.tx, tile.tz);
      if (existingBuildings.some((building) => building.containsWorldPoint(center.x, center.z))) continue;

      const distance = Math.hypot(center.x - from.x, center.z - from.z);
      const minDistance =
        buildingType === BuildingType.FARM ? GAME_RULES.TILE_SIZE * 0.85 : GAME_RULES.TILE_SIZE * 2.2;
      const maxDistance =
        buildingType === BuildingType.FARM ? GAME_RULES.TILE_SIZE * 2.4 : GAME_RULES.TILE_SIZE * 7.5;
      if (distance < minDistance || distance > maxDistance) continue;

      const preferredDistance =
        buildingType === BuildingType.FARM ? GAME_RULES.TILE_SIZE * 1.15 : GAME_RULES.TILE_SIZE * 4.2;
      const buildingPenalty = existingBuildings.reduce((penalty, building) => {
        const buildingDistance = Math.hypot(center.x - building.getWorldCenter().x, center.z - building.getWorldCenter().z);
        const avoidRadius =
          building.getBuildingType() === BuildingType.FARM || buildingType !== BuildingType.FARM
            ? GAME_RULES.TILE_SIZE * 2.2
            : GAME_RULES.TILE_SIZE * 1.15;
        return penalty + Math.max(0, avoidRadius - buildingDistance) * 5;
      }, 0);
      const eastBias = Math.max(0, from.x - center.x) * 0.08;
      const score = Math.abs(distance - preferredDistance) + eastBias + buildingPenalty;
      if (score < bestScore) {
        best = tile;
        bestScore = score;
      }
    }
    return best;
  }

  public isMyBlob(ownerId: string): boolean {
    return ownerId === this.room.sessionId;
  }

  public setWarningHandler(handler: ((text: string) => void) | null): void {
    this._warningHandler = handler;
  }

  public warn(text: string): void {
    this._warningHandler?.(text);
  }

  public getFirstIdleAgentBlob(): BlobEntity | null {
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (!entity.isOwnedByMe()) continue;
      if (!entity.mesh.visible) continue;
      if (!entity.isIdleAgentBlob()) continue;
      return entity;
    }
    return null;
  }

  public getMyIdleAgentCount(): number {
    let count = 0;
    for (const entity of this.entities) {
      if (!(entity instanceof BlobEntity)) continue;
      if (!entity.isOwnedByMe()) continue;
      if (!entity.isIdleAgentBlob()) continue;
      count += 1;
    }
    return count;
  }

  public getAgentPhaseForBuilding(buildingId: string): number | null {
    for (const e of this.entities) {
      if (!(e instanceof BlobEntity)) continue;
      if (!e.isOwnedByMe()) continue;
      if (e.getGatherTargetBuildingId() === buildingId) return e.getGatherPhase();
    }
    return null;
  }

  public setFogOfWarVisibilityQuery(query: ((x: number, z: number) => boolean) | null): void {
    this._fogOfWarVisibilityQuery = query;
  }

  public isWorldVisibleToMe(x: number, z: number): boolean {
    return this._fogOfWarVisibilityQuery ? this._fogOfWarVisibilityQuery(x, z) : true;
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
    {
      const u = blob.getUnitType() ?? UnitType.VILLAGER;
      playUnitVoiceOrDefault(u);
    }
    this.clearSelection();
  }

  public sendAttackIntent(blobId: string, targetType: AttackTargetType, targetId: string): void {
    this.room.send(MessageType.ATTACK, {
      blobId,
      targetType,
      targetId,
    } satisfies AttackMessage);
    {
      const attacker = this.findBlobEntity(blobId);
      const u = attacker?.getUnitType() ?? UnitType.WARBAND;
      playUnitVoiceOrDefault(u);
    }
    if (this.selectedEntityId === blobId) this.clearSelection();
  }

  public sendGatherIntent(blobId: string, tileKey: string): void {
    this.room.send(MessageType.GATHER, { blobId, tileKey } satisfies GatherMessage);
    const tile = this.getTileByKey(tileKey);
    if (tile && (tile.material > 0 || tile.compute > 0)) {
      const worker = this.findBlobEntity(blobId);
      const u = worker?.getUnitType() ?? UnitType.VILLAGER;
      if (tile.material > 0) {
        playUnitVoiceOrDefault(u);
      } else {
        playUnitVoiceOrDefault(u);
      }
    }
    if (this.selectedEntityId === blobId) this.clearSelection();
  }

  public sendGatherBuildingIntent(blobId: string, buildingId: string): void {
    const building = this.findBuildingEntity(buildingId);
    const occupant = this.getAgentPhaseForBuilding(buildingId);
    if (!building?.isUnderConstruction() && occupant !== null) {
      this.warn("Farm already has an agent");
      return;
    }
    this.room.send(MessageType.GATHER, { blobId, buildingId } satisfies GatherMessage);
    {
      const w = this.findBlobEntity(blobId);
      const u = w?.getUnitType() ?? UnitType.VILLAGER;
      playUnitVoiceOrDefault(u);
    }
    if (this.selectedEntityId === blobId) this.clearSelection();
  }

  public sendBuildIntent(type: BuildMessage["type"], worldX: number, worldZ: number): boolean {
    const cost = getBuildingRules(type).cost;
    if (!canAfford(this.getMyResources(), cost)) {
      this.warn("Not enough resources");
      return false;
    }
    const snapped = snapWorldToTileCenter(worldX, worldZ);
    this.room.send(MessageType.BUILD, { type, worldX: snapped.x, worldZ: snapped.z } satisfies BuildMessage);
    playDefaultCommandVoice();
    if (this.getMyIdleAgentCount() <= 0) {
      this.addWorldWarning(snapped.x, snapped.z, "Needs an agent to build");
    }
    return true;
  }

  public sendTrainIntent(buildingId: string, unitType: UnitTypeValue): boolean {
    const trainCost = getUnitTrainCost(unitType);
    if (!canAfford(this.getMyResources(), trainCost)) {
      this.warn("Not enough resources");
      return false;
    }
    this.room.send(MessageType.TRAIN, { buildingId, unitType } satisfies TrainMessage);
    const building = this.findBuildingEntity(buildingId);
    const center = building?.getWorldCenter();
    const distanceToCamera = center
      ? Math.hypot(
          center.x - this._orbitCameraWorldX,
          this._orbitCameraWorldY,
          center.z - this._orbitCameraWorldZ
        )
      : this._orbitCameraDistance;
    playUnitSpawnVoiceNearCamera(unitType, distanceToCamera);
    return true;
  }

  public sendRallyIntent(buildingId: string, worldX: number, worldZ: number): void {
    this.room.send(MessageType.SET_RALLY, { buildingId, worldX, worldZ } satisfies SetRallyMessage);
  }

  public sendSquadSpreadIntent(blobId: string, spread: SquadSpreadValue): void {
    this.room.send(MessageType.SQUAD_SPREAD, { blobId, spread } satisfies SquadSpreadMessage);
    {
      const b = this.findBlobEntity(blobId);
      const u = b?.getUnitType() ?? UnitType.WARBAND;
      if (isMilitaryUnitType(u)) playUnitVoiceOrDefault(u);
    }
    if (this.selectedEntityId === blobId) this.clearSelection();
  }

  public sendBlobAggroIntent(blobId: string, aggroMode: BlobAggroMode): void {
    this.room.send(MessageType.BLOB_AGGRO, { blobId, aggroMode } satisfies BlobAggroMessage);
    {
      const b = this.findBlobEntity(blobId);
      const u = b?.getUnitType() ?? UnitType.WARBAND;
      if (isMilitaryUnitType(u)) playUnitVoiceOrDefault(u);
    }
    if (this.selectedEntityId === blobId) this.clearSelection();
  }

  public sendChat(text: string): void {
    const message = text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!message) return;
    this.room.send(MessageType.CHAT, { text: message } satisfies ChatMessage);
  }

  public sendRename(name: string): void {
    const nextName = name.replace(/\s+/g, " ").trim().slice(0, 20);
    if (!nextName || nextName === this.getMyPlayerName()) return;
    this.room.send(MessageType.SET_NAME, { name: nextName } satisfies SetNameMessage);
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

  public getKothState(): {
    ownerSessionId: string;
    ownerName: string;
    ownerColor: number;
    entries: Array<{ sessionId: string; name: string; color: number; timeMs: number }>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = this.room.state as any;
    const ownerSid: string = state.kothOwner ?? "";
    const entries: Array<{ sessionId: string; name: string; color: number; timeMs: number }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.room.state.players.forEach((raw: any) => {
      const p = raw as { sessionId?: string; name?: string; color?: number; kothTimeMs?: number };
      entries.push({
        sessionId: p.sessionId ?? "",
        name: p.name ?? "",
        color: p.color ?? 0xffffff,
        timeMs: p.kothTimeMs ?? 0,
      });
    });
    // Sort ascending: least time remaining = closest to winning (longest time in the zone)
    entries.sort((a, b) => a.timeMs - b.timeMs);
    const ownerEntry = entries.find((e) => e.sessionId === ownerSid);
    return {
      ownerSessionId: ownerSid,
      ownerName: ownerEntry?.name ?? "",
      ownerColor: ownerEntry?.color ?? 0,
      entries,
    };
  }

  public getBuildingSnapshots(): ReadonlyMap<string, {
    x: number; y: number; buildingType: BuildingTypeValue; health: number; ownerId: string;
  }> {
    return this._buildingSnapshots;
  }

  public getRoundResetCount(): number {
    return this._roundResetCount;
  }

  public getLoadedChunkKeys(): ReadonlySet<string> {
    return this._loadedChunkKeys;
  }

  public getChunkLoadStats(): {
    loaded: number;
    total: number;
    pending: number;
    firstMs: number | null;
    spawnMs: number | null;
    fullMs: number | null;
  } {
    return {
      loaded: this._loadedChunkKeys.size,
      total: getAllChunkKeys().length,
      pending: this._pendingChunkResolvers.size,
      firstMs: this._firstChunkMs,
      spawnMs: this._spawnChunksMs,
      fullMs: this._fullChunksMs,
    };
  }
}

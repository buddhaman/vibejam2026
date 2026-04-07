import { Room, type Client } from "colyseus";
import { GameState, Player, Blob, Building } from "./state.js";
import { CONFIG } from "./config.js";
import {
  BuildingType,
  SquadSpread,
  UnitType,
  canBuildingProduceUnit,
  canAfford,
  assignDatacenterSites,
  generateTile,
  getBlobMaxHealth,
  getTileCoordsFromWorld,
  getTileKey,
  getBuildingRules,
  getUnitBalanceRules,
  getUnitRules,
  getSquadRadius,
  getWorldTileCount,
  GAME_RULES,
  forEachTileKeyUnderFootprint,
  isBuildingType,
  isSquadSpread,
  isUnitType,
  snapWorldToTileCenter,
  subtractCost,
  type ResourceCost,
} from "../../shared/game-rules.js";
import {
  type AttackMessage,
  MessageType,
  type IntentMessage,
  type BuildMessage,
  type PathMessage,
  type SquadSpreadMessage,
  type TrainMessage,
  type TileData,
  type TileChunkMessage,
  type TilesRequestMessage,
  type TileUpdateMessage,
} from "../../shared/protocol.js";
import { findPath, type Waypoint } from "./astar.js";
import { assignPlayerPaletteColor } from "../../shared/player-colors.js";

let nextId = 1;
function makeId(prefix: string) {
  return `${prefix}_${nextId++}`;
}

const CHUNK_SIZE = 50; // tiles per chunk — keeps each message well under 5 KB
const BLOB_REBALANCE_BATTLE_BUFFER = 10;
/** Distance at which a blob advances to its next path waypoint (intermediate only). */
const WAYPOINT_REACH = GAME_RULES.TILE_SIZE * 0.45;

/** @see https://docs.colyseus.io/state/ — state is assigned on the class in 0.17+ */
export class BattleRoom extends Room<{ state: GameState }> {
  maxClients = 64;
  state = new GameState();

  /** Plain tile data — NOT in schema, streamed on demand. */
  private tileData = new Map<string, TileData>();
  private tileChunks: TileData[][] = [];
  /** How many building footprints cover each tile (any owner). */
  private buildingTileOcc = new Map<string, number>();
  /** Active A* paths per blob — server-side only, not part of schema. */
  private blobPaths = new Map<string, { waypoints: Waypoint[]; index: number }>();

  onCreate() {
    this.state.terrainSeed = Math.floor(Math.random() * 0xffffffff);
    this.initTiles();

    const intervalMs = 1000 / CONFIG.TICK_HZ;
    this.setSimulationInterval((dt) => this.tick(dt), intervalMs);

    this.onMessage(MessageType.TILES_REQUEST, (client, raw) => {
      const msg = raw as TilesRequestMessage;
      if (typeof msg?.chunk !== "number") return;
      const idx = msg.chunk | 0;
      if (idx < 0 || idx >= this.tileChunks.length) return;
      client.send(MessageType.TILE_CHUNK, {
        chunk: idx,
        total: this.tileChunks.length,
        tiles: this.tileChunks[idx],
      } satisfies TileChunkMessage);
    });

    this.onMessage(MessageType.INTENT, (client, raw) => {
      const msg = raw as IntentMessage;
      if (
        typeof msg?.blobId !== "string" ||
        typeof msg.targetX !== "number" ||
        typeof msg.targetY !== "number"
      ) {
        return;
      }
      const blob = this.state.blobs.get(msg.blobId);
      if (!blob || blob.ownerId !== client.sessionId) return;
      blob.attackTargetBlobId = "";
      this.setBlobDestination(blob, msg.targetX, msg.targetY, client);
    });

    this.onMessage(MessageType.ATTACK, (client, raw) => {
      const msg = raw as AttackMessage;
      if (typeof msg?.blobId !== "string" || typeof msg.targetBlobId !== "string") return;
      const blob = this.state.blobs.get(msg.blobId);
      const target = this.state.blobs.get(msg.targetBlobId);
      if (!blob || !target || blob.ownerId !== client.sessionId || target.ownerId === client.sessionId) return;

      blob.attackTargetBlobId = target.id;
      this.setBlobDestination(blob, target.x, target.y, client);
    });

    this.onMessage(MessageType.SQUAD_SPREAD, (client, raw) => {
      const msg = raw as SquadSpreadMessage;
      if (typeof msg?.blobId !== "string" || !isSquadSpread(msg.spread)) {
        return;
      }
      const blob = this.state.blobs.get(msg.blobId);
      if (!blob || blob.ownerId !== client.sessionId) return;
      blob.spread = msg.spread;
      blob.radius = getSquadRadius(blob.unitCount, blob.spread);
    });

    this.onMessage(MessageType.BUILD, (client, raw) => {
      const msg = raw as BuildMessage;
      if (
        !isBuildingType(msg?.type) ||
        typeof msg.worldX !== "number" ||
        typeof msg.worldZ !== "number"
      ) {
        return;
      }

      // enforce per-player building cap
      let count = 0;
      this.state.buildings.forEach((b) => {
        if (b.ownerId === client.sessionId && getBuildingRules(b.buildingType).buildable) count++;
      });
      if (count >= CONFIG.MAX_BUILDINGS_PER_PLAYER) return;
      const player = this.state.players.get(client.sessionId);
      const buildingRules = getBuildingRules(msg.type);
      const snapped = snapWorldToTileCenter(msg.worldX, msg.worldZ);
      if (
        !player ||
        !buildingRules.buildable ||
        !canAfford(player, buildingRules.cost) ||
        !this.footprintIsBuildable(snapped.x, snapped.z, buildingRules.footprintWidth, buildingRules.footprintDepth)
      ) {
        return;
      }

      const building = new Building();
      building.id = makeId("bld");
      building.ownerId = client.sessionId;
      building.x = snapped.x;
      building.y = snapped.z;
      building.buildingType = msg.type;
      building.health = buildingRules.health;

      spendPlayerResources(player, buildingRules.cost);

      this.state.buildings.set(building.id, building);
      this.addBuildingFootprint(building);
    });

    this.onMessage(MessageType.TRAIN, (client, raw) => {
      const msg = raw as TrainMessage;
      if (typeof msg?.buildingId !== "string" || !isUnitType(msg.unitType)) {
        return;
      }

      const building = this.state.buildings.get(msg.buildingId);
      const player = this.state.players.get(client.sessionId);
      if (!building || !player || building.ownerId !== client.sessionId) {
        return;
      }
      const buildingRules = getBuildingRules(building.buildingType);
      const unitRules = getUnitRules(msg.unitType);
      if (!canBuildingProduceUnit(building.buildingType, msg.unitType) || !canAfford(player, unitRules.cost)) return;

      spendPlayerResources(player, unitRules.cost);
      building.productionQueue.push(msg.unitType);
    });
  }

  onJoin(client: Client) {
    const player = new Player();
    player.sessionId = client.sessionId;
    const taken: number[] = [];
    this.state.players.forEach((p) => taken.push(p.color));
    player.color = assignPlayerPaletteColor(taken);
    player.biomass = CONFIG.START_BIOMASS;
    player.material = CONFIG.START_MATERIAL;
    player.compute = CONFIG.START_COMPUTE;
    this.state.players.set(client.sessionId, player);

    const playerIndex = this.getNextTownCenterIndex();
    const townCenter = this.spawnTownCenter(client.sessionId, playerIndex);
    this.spawnProducedUnit(townCenter, UnitType.WARBAND, CONFIG.START_WARBAND_UNIT_COUNT);
  }

  onLeave(client: Client, _code: number) {
    const sid = client.sessionId;
    this.state.players.delete(sid);

    const blobIds: string[] = [];
    this.state.blobs.forEach((b, id) => {
      if (b.ownerId === sid) blobIds.push(id as string);
    });
    for (const id of blobIds) {
      this.blobPaths.delete(id);
      this.state.blobs.delete(id);
    }

    const buildingIds: string[] = [];
    this.state.buildings.forEach((b, id) => {
      if (b.ownerId === sid) buildingIds.push(id as string);
    });
    for (const id of buildingIds) {
      const b = this.state.buildings.get(id);
      if (b) this.removeBuildingFootprint(b);
      this.state.buildings.delete(id);
    }
  }

  private getBlobEngageDistance(a: Blob, b: Blob): number {
    return a.radius + b.radius + CONFIG.BLOB_COMBAT_ENGAGE_PADDING;
  }

  private blobsCanEngage(a: Blob, b: Blob): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= this.getBlobEngageDistance(a, b);
  }

  private setBlobDestination(blob: Blob, targetX: number, targetY: number, client?: Client): void {
    const tile = this.getTileAtWorld(targetX, targetY);
    if (!tile?.canWalk) return;

    blob.targetX = clamp(targetX, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    blob.targetY = clamp(targetY, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);

    const walkable = (tx: number, tz: number) => this.tileData.get(getTileKey(tx, tz))?.canWalk ?? false;
    const start = getTileCoordsFromWorld(blob.x, blob.y);
    const goal = getTileCoordsFromWorld(blob.targetX, blob.targetY);
    const path = findPath(start.tx, start.tz, goal.tx, goal.tz, walkable);

    if (path.length > 0) {
      path[path.length - 1] = { x: blob.targetX, y: blob.targetY };
      this.blobPaths.set(blob.id, { waypoints: path, index: 0 });
    } else {
      this.blobPaths.delete(blob.id);
    }

    if (client) {
      client.send(MessageType.PATH, {
        blobId: blob.id,
        waypoints: path,
      } satisfies PathMessage);
    }
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;

    for (const building of this.state.buildings.values()) {
      this.stepBuildingProduction(building, dtMs);
    }

    for (const blob of this.state.blobs.values()) {
      if (blob.attackTargetBlobId.length > 0) {
        const target = this.state.blobs.get(blob.attackTargetBlobId);
        if (!target || target.ownerId === blob.ownerId) {
          blob.attackTargetBlobId = "";
        } else {
          if (this.blobsCanEngage(blob, target)) {
            blob.targetX = blob.x;
            blob.targetY = blob.y;
            blob.vx = 0;
            blob.vy = 0;
            this.blobPaths.delete(blob.id);
          } else {
            const targetTile = getTileCoordsFromWorld(target.x, target.y);
            const goalTile = getTileCoordsFromWorld(blob.targetX, blob.targetY);
            if (targetTile.tx !== goalTile.tx || targetTile.tz !== goalTile.tz) {
              this.setBlobDestination(blob, target.x, target.y);
            }
          }
        }
      }

      blob.radius = getSquadRadius(blob.unitCount, blob.spread);

      // Resolve the immediate movement target from the A* path (or fall back to targetX/Y)
      let moveX = blob.targetX;
      let moveY = blob.targetY;
      let isFinalWaypoint = true;

      const pathData = this.blobPaths.get(blob.id);
      if (pathData && pathData.index < pathData.waypoints.length) {
        const wp = pathData.waypoints[pathData.index]!;
        const waypointDist = Math.hypot(blob.x - wp.x, blob.y - wp.y);
        const reachRadius  = pathData.index === pathData.waypoints.length - 1
          ? CONFIG.BLOB_STOP_EPSILON
          : WAYPOINT_REACH;

        if (waypointDist < reachRadius) {
          // Advance to next waypoint
          pathData.index++;
        }

        if (pathData.index < pathData.waypoints.length) {
          const next = pathData.waypoints[pathData.index]!;
          moveX = next.x;
          moveY = next.y;
          isFinalWaypoint = pathData.index === pathData.waypoints.length - 1;
        }
        // else: path exhausted, fall through to targetX/Y with isFinalWaypoint = true
      }

      const dx = moveX - blob.x;
      const dy = moveY - blob.y;
      const dist = Math.hypot(dx, dy);
      const currentSpeed = Math.hypot(blob.vx, blob.vy);

      if (isFinalWaypoint && dist < CONFIG.BLOB_STOP_EPSILON && currentSpeed < 0.75) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
        blob.vx = 0;
        blob.vy = 0;
        this.blobPaths.delete(blob.id);
        this.tryVillagerGather(blob, dt);
        continue;
      }

      // Decelerate only when approaching the final waypoint
      const desiredSpeed = isFinalWaypoint && dist < CONFIG.BLOB_DECELERATION_RADIUS
        ? CONFIG.BLOB_MOVE_SPEED * Math.max(0, dist / CONFIG.BLOB_DECELERATION_RADIUS)
        : CONFIG.BLOB_MOVE_SPEED;

      const nx = dist > 0.0001 ? dx / dist : 0;
      const ny = dist > 0.0001 ? dy / dist : 0;
      const desiredVx = nx * desiredSpeed;
      const desiredVy = ny * desiredSpeed;
      const deltaVx = desiredVx - blob.vx;
      const deltaVy = desiredVy - blob.vy;
      const deltaSpeed = Math.hypot(deltaVx, deltaVy);
      const accel = desiredSpeed > currentSpeed ? CONFIG.BLOB_ACCELERATION : CONFIG.BLOB_ACCELERATION * 1.2;
      const maxDelta = accel * dt;

      if (deltaSpeed <= maxDelta || deltaSpeed === 0) {
        blob.vx = desiredVx;
        blob.vy = desiredVy;
      } else {
        blob.vx += (deltaVx / deltaSpeed) * maxDelta;
        blob.vy += (deltaVy / deltaSpeed) * maxDelta;
      }

      blob.x += blob.vx * dt;
      blob.y += blob.vy * dt;
      blob.x = clamp(blob.x, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.y = clamp(blob.y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);

      // Snap to final target when within epsilon
      if (isFinalWaypoint && Math.hypot(blob.targetX - blob.x, blob.targetY - blob.y) < CONFIG.BLOB_STOP_EPSILON) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
        blob.vx = 0;
        blob.vy = 0;
        this.blobPaths.delete(blob.id);
      }
    }

    this.resolveBlobCombat(dt);
    this.rebalanceFriendlyBlobs();
  }

  private spawnTownCenter(ownerId: string, playerIndex: number): Building {
    const tcRules = getBuildingRules(BuildingType.TOWN_CENTER);
    const angle = playerIndex * 1.63;
    const radius = (CONFIG.WORLD_MAX - CONFIG.WORLD_MIN) * 0.225;
    const snapped = this.findNearestBuildableTileCenter(
      snapWorldToTileCenter(Math.cos(angle) * radius, Math.sin(angle) * radius),
      tcRules.footprintWidth,
      tcRules.footprintDepth
    );

    const townCenter = new Building();
    townCenter.id = makeId("bld");
    townCenter.ownerId = ownerId;
    townCenter.x = snapped.x;
    townCenter.y = snapped.z;
    townCenter.buildingType = BuildingType.TOWN_CENTER;
    townCenter.health = getBuildingRules(BuildingType.TOWN_CENTER).health;
    this.state.buildings.set(townCenter.id, townCenter);
    this.addBuildingFootprint(townCenter);
    return townCenter;
  }

  private getNextTownCenterIndex() {
    let count = 0;
    this.state.buildings.forEach((building) => {
      if (building.buildingType === BuildingType.TOWN_CENTER) count++;
    });
    return count;
  }

  private getTileAtWorld(x: number, z: number): TileData | null {
    const { tx, tz } = getTileCoordsFromWorld(x, z);
    return this.tileData.get(getTileKey(tx, tz)) ?? null;
  }

  private findNearestBuildableTileCenter(
    center: { x: number; z: number },
    footprintW: number,
    footprintD: number
  ): { x: number; z: number } {
    const start = getTileCoordsFromWorld(center.x, center.z);
    const nTiles = getWorldTileCount();
    const tryTile = (tx: number, tz: number) => {
      if (tx < 0 || tz < 0 || tx >= nTiles || tz >= nTiles) return null;
      const cx = tx * CONFIG.TILE_SIZE + CONFIG.WORLD_MIN + CONFIG.TILE_SIZE * 0.5;
      const cz = tz * CONFIG.TILE_SIZE + CONFIG.WORLD_MIN + CONFIG.TILE_SIZE * 0.5;
      return this.footprintIsBuildable(cx, cz, footprintW, footprintD) ? { x: cx, z: cz } : null;
    };

    const direct = tryTile(start.tx, start.tz);
    if (direct) return direct;

    for (let radius = 1; radius <= 6; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tx = start.tx + dx;
          const tz = start.tz + dz;
          const hit = tryTile(tx, tz);
          if (hit) return hit;
        }
      }
    }

    return center;
  }

  /** True if every tile under the footprint is open terrain for building (no mountains, no structure). */
  private footprintIsBuildable(centerX: number, centerZ: number, footprintW: number, footprintD: number): boolean {
    let ok = true;
    forEachTileKeyUnderFootprint(centerX, centerZ, footprintW, footprintD, (key) => {
      const t = this.tileData.get(key);
      if (!t?.canBuild) ok = false;
    });
    return ok;
  }

  private addBuildingFootprint(building: Building): void {
    const r = getBuildingRules(building.buildingType);
    const touched = new Set<string>();
    forEachTileKeyUnderFootprint(building.x, building.y, r.footprintWidth, r.footprintDepth, (key) => {
      this.buildingTileOcc.set(key, (this.buildingTileOcc.get(key) ?? 0) + 1);
      touched.add(key);
    });
    for (const key of touched) this.syncTileNavForKey(key);
  }

  private removeBuildingFootprint(building: Building): void {
    const r = getBuildingRules(building.buildingType);
    const touched = new Set<string>();
    forEachTileKeyUnderFootprint(building.x, building.y, r.footprintWidth, r.footprintDepth, (key) => {
      const n = (this.buildingTileOcc.get(key) ?? 0) - 1;
      if (n <= 0) this.buildingTileOcc.delete(key);
      else this.buildingTileOcc.set(key, n);
      touched.add(key);
    });
    for (const key of touched) this.syncTileNavForKey(key);
  }

  private syncTileNavForKey(key: string): void {
    const tile = this.tileData.get(key);
    if (!tile) return;
    const terrainWalkOk = !tile.isMountain;
    const terrainBuildOk = !tile.isMountain;
    const occ = this.buildingTileOcc.get(key) ?? 0;
    const nextWalk = terrainWalkOk && occ === 0;
    const nextBuild = terrainBuildOk && occ === 0;
    if (tile.canWalk === nextWalk && tile.canBuild === nextBuild) return;
    tile.canWalk = nextWalk;
    tile.canBuild = nextBuild;
    this.broadcast(MessageType.TILE_UPDATE, {
      key,
      canWalk: nextWalk,
      canBuild: nextBuild,
    } satisfies TileUpdateMessage);
  }

  private initTiles() {
    const count = getWorldTileCount();
    let datacenterTiles = 0;
    const datacenterSampleKeys: string[] = [];
    for (let tz = 0; tz < count; tz++) {
      for (let tx = 0; tx < count; tx++) {
        const t = generateTile(tx, tz, this.state.terrainSeed);
        this.tileData.set(t.key, t);
      }
    }
    assignDatacenterSites(this.tileData, this.state.terrainSeed);
    this.tileData.forEach((t) => {
      if (t.maxCompute > 0) {
        datacenterTiles++;
        if (datacenterSampleKeys.length < 6) datacenterSampleKeys.push(t.key);
      }
    });
    console.log(
      `[room] Terrain ready: terrainSeed=${this.state.terrainSeed} datacenterTiles=${datacenterTiles} sampleKeys=${datacenterSampleKeys.join(
        ","
      ) || "(none)"}`
    );
    // Pre-slice into fixed-size chunks for fast streaming
    const all = Array.from(this.tileData.values());
    this.tileChunks = [];
    for (let i = 0; i < all.length; i += CHUNK_SIZE) {
      this.tileChunks.push(all.slice(i, i + CHUNK_SIZE));
    }
  }

  /**
   * Broadcast a tile mutation (wood / gold change) to all connected clients.
   * Call this whenever a tile's mutable fields change server-side.
   */
  private broadcastTileUpdate(key: string): void {
    const tile = this.tileData.get(key);
    if (!tile) return;
    this.broadcast(MessageType.TILE_UPDATE, {
      key,
      material: tile.material,
      compute: tile.compute,
    } satisfies TileUpdateMessage);
  }

  /** Villagers idle on a tile harvest material (forest) or compute (data center). */
  private tryVillagerGather(blob: Blob, dt: number): void {
    if (blob.unitType !== UnitType.VILLAGER) return;
    const player = this.state.players.get(blob.ownerId);
    if (!player) return;
    const tile = this.getTileAtWorld(blob.x, blob.y);
    if (!tile || tile.isMountain) return;

    let gathered = false;
    if (tile.material > 0) {
      const n = Math.min(
        tile.material,
        Math.max(1, Math.round(CONFIG.VILLAGER_GATHER_MATERIAL_PER_SEC * dt))
      );
      tile.material -= n;
      player.material += n;
      gathered = true;
    } else if (tile.compute > 0) {
      const n = Math.min(
        tile.compute,
        Math.max(1, Math.round(CONFIG.VILLAGER_GATHER_COMPUTE_PER_SEC * dt))
      );
      tile.compute -= n;
      player.compute += n;
      gathered = true;
    }
    if (gathered) this.broadcastTileUpdate(tile.key);
  }

  private stepBuildingProduction(building: Building, dtMs: number) {
    if (building.productionQueue.length === 0) {
      building.productionProgressMs = 0;
      return;
    }

    building.productionProgressMs += dtMs;
    while (building.productionQueue.length > 0) {
      const currentType = building.productionQueue[0];
      if (!isUnitType(currentType)) {
        building.productionQueue.shift();
        building.productionProgressMs = 0;
        continue;
      }

      const unitRules = getUnitRules(currentType);
      if (building.productionProgressMs < unitRules.trainTimeMs) break;

      building.productionProgressMs -= unitRules.trainTimeMs;
      building.productionQueue.shift();
      this.spawnProducedUnit(building, currentType);
    }

    if (building.productionQueue.length === 0) {
      building.productionProgressMs = 0;
    }
  }

  private refreshBlobDerived(blob: Blob): void {
    blob.radius = getSquadRadius(blob.unitCount, blob.spread);
  }

  private syncBlobHealthToUnitCount(blob: Blob): void {
    const hpPerUnit = Math.max(1, getUnitRules(blob.unitType).health);
    blob.health = Math.max(0, blob.health);
    blob.unitCount = Math.max(0, Math.ceil(blob.health / hpPerUnit));
    const maxHealth = getBlobMaxHealth(blob.unitType, blob.unitCount);
    blob.health = Math.min(blob.health, maxHealth);
    this.refreshBlobDerived(blob);
  }

  private isBlobHeavilyEngaged(blob: Blob): boolean {
    for (const other of this.state.blobs.values()) {
      if (other.id === blob.id || other.ownerId === blob.ownerId) continue;
      const engageDistance = blob.radius + other.radius + BLOB_REBALANCE_BATTLE_BUFFER;
      if (Math.hypot(blob.x - other.x, blob.y - other.y) <= engageDistance) return true;
    }
    return false;
  }

  private canRebalancePair(a: Blob, b: Blob): boolean {
    if (a.id === b.id) return false;
    if (a.ownerId !== b.ownerId || a.unitType !== b.unitType) return false;

    const balanceRules = getUnitBalanceRules(a.unitType);
    if (Math.hypot(a.x - b.x, a.y - b.y) > balanceRules.mergeDistance) return false;
    if (this.isBlobHeavilyEngaged(a) || this.isBlobHeavilyEngaged(b)) return false;

    const diff = Math.abs(a.unitCount - b.unitCount);
    if (diff < balanceRules.rebalanceThreshold) return false;

    const total = a.unitCount + b.unitCount;
    const nextA = Math.max(Math.ceil(total / 2), Math.floor(total / 2));
    const nextB = Math.min(Math.ceil(total / 2), Math.floor(total / 2));
    const wouldMove = Math.min(Math.abs(a.unitCount - nextA), Math.abs(b.unitCount - nextB));
    return wouldMove >= balanceRules.rebalanceThreshold;
  }

  private rebalancePair(a: Blob, b: Blob): void {
    const totalHealth = a.health + b.health;
    const total = a.unitCount + b.unitCount;
    if (a.unitCount >= b.unitCount) {
      a.unitCount = Math.ceil(total / 2);
      b.unitCount = Math.floor(total / 2);
    } else {
      a.unitCount = Math.floor(total / 2);
      b.unitCount = Math.ceil(total / 2);
    }
    if (total > 0 && totalHealth > 0) {
      a.health = totalHealth * (a.unitCount / total);
      b.health = totalHealth - a.health;
    }
    this.refreshBlobDerived(a);
    this.refreshBlobDerived(b);
  }

  private rebalanceFriendlyBlobs(): void {
    const groups = new Map<string, Blob[]>();
    for (const blob of this.state.blobs.values()) {
      const key = `${blob.ownerId}:${blob.unitType}`;
      const arr = groups.get(key);
      if (arr) arr.push(blob);
      else groups.set(key, [blob]);
    }

    for (const blobs of groups.values()) {
      blobs.sort((a, b) => a.id.localeCompare(b.id));
      const locked = new Set<string>();

      for (let i = 0; i < blobs.length; i++) {
        const a = blobs[i]!;
        if (locked.has(a.id)) continue;

        let best: Blob | null = null;
        let bestDistance = Infinity;
        let bestDiff = -1;
        for (let j = i + 1; j < blobs.length; j++) {
          const b = blobs[j]!;
          if (locked.has(b.id) || !this.canRebalancePair(a, b)) continue;
          const diff = Math.abs(a.unitCount - b.unitCount);
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (diff > bestDiff || (diff === bestDiff && distance < bestDistance)) {
            best = b;
            bestDiff = diff;
            bestDistance = distance;
          }
        }

        if (!best) continue;
        this.rebalancePair(a, best);
        locked.add(a.id);
        locked.add(best.id);
      }
    }
  }

  private findNearbyFriendlyBlobForTrainedUnits(ownerId: string, unitType: UnitType, x: number, y: number): Blob | null {
    const balanceRules = getUnitBalanceRules(unitType);
    let best: Blob | null = null;
    let bestDistance = Infinity;

    for (const blob of this.state.blobs.values()) {
      if (blob.ownerId !== ownerId || blob.unitType !== unitType) continue;
      if (blob.unitCount >= balanceRules.targetSize) continue;
      if (this.isBlobHeavilyEngaged(blob)) continue;
      const distance = Math.hypot(blob.x - x, blob.y - y);
      if (distance > balanceRules.mergeDistance) continue;
      if (distance < bestDistance) {
        best = blob;
        bestDistance = distance;
      }
    }

    return best;
  }

  private resolveBlobCombat(dt: number): void {
    const locked = new Set<string>();
    const deadIds = new Set<string>();

    for (const blob of this.state.blobs.values()) {
      if (locked.has(blob.id) || blob.attackTargetBlobId.length === 0) continue;
      const target = this.state.blobs.get(blob.attackTargetBlobId);
      if (!target || target.ownerId === blob.ownerId || locked.has(target.id)) continue;

      if (!this.blobsCanEngage(blob, target)) continue;

      const blobRules = getUnitRules(blob.unitType);
      const targetRules = getUnitRules(target.unitType);
      blob.health -= target.unitCount * targetRules.dpsPerUnit * dt;
      target.health -= blob.unitCount * blobRules.dpsPerUnit * dt;

      this.syncBlobHealthToUnitCount(blob);
      this.syncBlobHealthToUnitCount(target);

      if (blob.unitCount <= 0 || blob.health <= 0) deadIds.add(blob.id);
      if (target.unitCount <= 0 || target.health <= 0) deadIds.add(target.id);

      locked.add(blob.id);
      locked.add(target.id);
    }

    if (deadIds.size === 0) return;
    for (const deadId of deadIds) {
      this.blobPaths.delete(deadId);
      this.state.blobs.delete(deadId);
    }
    for (const blob of this.state.blobs.values()) {
      if (deadIds.has(blob.attackTargetBlobId)) blob.attackTargetBlobId = "";
    }
  }

  private spawnProducedUnit(building: Building, unitType: UnitType, unitCountOverride?: number) {
    const buildingRules = getBuildingRules(building.buildingType);
    const unitRules = getUnitRules(unitType);
    const spawnX = clamp(building.x + buildingRules.trainSpawnOffsetX, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    const spawnY = clamp(building.y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    const producedCount = unitCountOverride ?? unitRules.unitCount;

    const nearby = this.findNearbyFriendlyBlobForTrainedUnits(building.ownerId, unitType, spawnX, spawnY);
    if (nearby) {
      nearby.unitCount += producedCount;
      nearby.health += getBlobMaxHealth(unitType, producedCount);
      this.refreshBlobDerived(nearby);
      return;
    }

    const blob = new Blob();
    blob.id = makeId("blob");
    blob.ownerId = building.ownerId;
    blob.x = spawnX;
    blob.y = spawnY;
    blob.targetX = blob.x;
    blob.targetY = blob.y;
    blob.vx = 0;
    blob.vy = 0;
    blob.unitCount = producedCount;
    blob.spread = unitType === UnitType.VILLAGER ? SquadSpread.TIGHT : SquadSpread.DEFAULT;
    blob.radius = getSquadRadius(blob.unitCount, blob.spread);
    blob.health = getBlobMaxHealth(unitType, producedCount);
    blob.unitType = unitType;
    this.state.blobs.set(blob.id, blob);
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function spendPlayerResources(player: ResourceCost & Player, cost: ResourceCost) {
  const next = subtractCost(player, cost);
  player.biomass = next.biomass;
  player.material = next.material;
  player.compute = next.compute;
}

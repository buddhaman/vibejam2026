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
  getTileCenter,
  getBlobMaxHealth,
  getTileCoordsFromWorld,
  getTileKey,
  getBuildingRules,
  getBlobMoveRules,
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
  AttackTargetType,
  BlobActionState,
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
const DISENGAGE_LOCK_RELEASE_BUFFER = GAME_RULES.TILE_SIZE * 0.35;
const RANGED_ATTACK_HYSTERESIS = GAME_RULES.TILE_SIZE * 1.1;
const RANGED_ATTACK_COMMIT_INSET = GAME_RULES.TILE_SIZE * 0.55;

type AttackableTarget =
  | { type: typeof AttackTargetType.BLOB; entity: Blob }
  | { type: typeof AttackTargetType.BUILDING; entity: Building };

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
  /** Pairwise "do not instantly re-engage" locks, used when fast units break contact. */
  private disengageLocks = new Set<string>();
  /** Latched enemy contact graph for melee combat; components become combat groups. */
  private combatLinks = new Set<string>();
  /** Explicit retreat orders issued while in melee combat; keeps combat-state rules separate from pathing. */
  private combatRetreatTargets = new Map<string, { x: number; y: number }>();

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
      const hasCombatPressure =
        this.blobHasCombatGroup(blob) ||
        this.getCombatNeighborIds(blob.id).some((neighborId) => {
          const neighbor = this.state.blobs.get(neighborId);
          return !!neighbor && neighbor.ownerId !== blob.ownerId;
        });
      for (const neighborId of this.getCombatNeighborIds(blob.id)) {
        const neighbor = this.state.blobs.get(neighborId);
        if (!neighbor || neighbor.ownerId === blob.ownerId) continue;
        if (this.canBlobInstantlyDisengage(blob, neighbor)) {
          this.addDisengageLock(blob, neighbor);
        }
      }
      if (hasCombatPressure) {
        this.combatRetreatTargets.set(blob.id, { x: msg.targetX, y: msg.targetY });
      } else {
        this.combatRetreatTargets.delete(blob.id);
      }
      this.clearBlobAttackTarget(blob);
      this.setBlobDestination(blob, msg.targetX, msg.targetY, client);
    });

    this.onMessage(MessageType.ATTACK, (client, raw) => {
      const msg = raw as AttackMessage;
      if (typeof msg?.blobId !== "string" || typeof msg.targetId !== "string") return;
      const blob = this.state.blobs.get(msg.blobId);
      if (!blob || blob.ownerId !== client.sessionId) return;
      const target = this.getAttackableTarget(msg.targetType, msg.targetId);
      if (!target || target.entity.ownerId === client.sessionId) return;

      this.combatRetreatTargets.delete(blob.id);
      blob.attackTargetType = msg.targetType;
      blob.attackTargetId = msg.targetId;
      const approach = this.getBlobAttackApproachPoint(blob, target);
      if (!approach) {
        blob.targetX = blob.x;
        blob.targetY = blob.y;
        blob.vx = 0;
        blob.vy = 0;
        this.clearBlobPath(blob, client);
        return;
      }
      this.setBlobDestination(blob, approach.x, approach.y, client, { snapToNearestWalkable: true });
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
    this.spawnStartingBlob(townCenter, UnitType.VILLAGER, CONFIG.START_AGENT_UNIT_COUNT, 0);
    this.spawnStartingBlob(townCenter, UnitType.WARBAND, CONFIG.START_WARBAND_UNIT_COUNT, 1);
    this.spawnStartingBlob(townCenter, UnitType.ARCHER, CONFIG.START_ARCHER_UNIT_COUNT, 2);
    this.spawnStartingBlob(townCenter, UnitType.SYNTHAUR, CONFIG.START_SYNTHAUR_UNIT_COUNT, 3);
  }

  onLeave(client: Client, _code: number) {
    const sid = client.sessionId;
    this.state.players.delete(sid);

    const blobIds: string[] = [];
    this.state.blobs.forEach((b, id) => {
      if (b.ownerId === sid) blobIds.push(id as string);
    });
    for (const id of blobIds) {
      this.combatRetreatTargets.delete(id);
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

  private getAttackableTarget(type: number, id: string): AttackableTarget | null {
    if (type === AttackTargetType.BLOB) {
      const entity = this.state.blobs.get(id);
      return entity ? { type: AttackTargetType.BLOB, entity } : null;
    }
    if (type === AttackTargetType.BUILDING) {
      const entity = this.state.buildings.get(id);
      return entity ? { type: AttackTargetType.BUILDING, entity } : null;
    }
    return null;
  }

  private getBlobAttackTarget(blob: Blob): AttackableTarget | null {
    if (!blob.attackTargetId) return null;
    return this.getAttackableTarget(blob.attackTargetType, blob.attackTargetId);
  }

  private getBlobEngagedBlobTarget(blob: Blob): Blob | null {
    if (blob.engagedTargetType !== AttackTargetType.BLOB || !blob.engagedTargetId) return null;
    return this.state.blobs.get(blob.engagedTargetId) ?? null;
  }

  private clearBlobAttackTarget(blob: Blob): void {
    blob.attackTargetType = AttackTargetType.NONE;
    blob.attackTargetId = "";
  }

  private clearBlobEngagedTarget(blob: Blob): void {
    blob.engagedTargetType = AttackTargetType.NONE;
    blob.engagedTargetId = "";
  }

  private getAttackTargetRadius(target: AttackableTarget): number {
    if (target.type === AttackTargetType.BLOB) return target.entity.radius;
    const rules = getBuildingRules(target.entity.buildingType);
    return Math.hypot(rules.selectionWidth * 0.5, rules.selectionDepth * 0.5);
  }

  private getBlobAttackRange(blob: Blob, target: AttackableTarget): number {
    const rules = getUnitRules(blob.unitType);
    if (rules.attackStyle === "ranged") return rules.attackRange + this.getAttackTargetRadius(target);
    if (target.type === AttackTargetType.BLOB) return this.getBlobEngageDistance(blob, target.entity);
    return blob.radius + this.getAttackTargetRadius(target) + GAME_RULES.UNIT_RADIUS * 0.6;
  }

  private isBlobRangedAttackActive(blob: Blob, target: AttackableTarget): boolean {
    const rules = getUnitRules(blob.unitType);
    if (rules.attackStyle !== "ranged") return false;
    const distance = Math.hypot(blob.x - target.entity.x, blob.y - target.entity.y);
    const attackRange = this.getBlobAttackRange(blob, target);
    const commitRange = Math.max(0, attackRange - RANGED_ATTACK_COMMIT_INSET);
    const keepRange = attackRange + RANGED_ATTACK_HYSTERESIS;
    const wasActive = blob.actionState === BlobActionState.RANGED_ATTACKING;
    return distance <= (wasActive ? keepRange : commitRange);
  }

  private refreshBlobActionState(blob: Blob): void {
    const rules = getUnitRules(blob.unitType);
    if (this.blobHasCombatGroup(blob)) {
      blob.actionState = this.blobHasRetreatIntent(blob)
        ? BlobActionState.RETREATING
        : BlobActionState.ENGAGED;
      return;
    }

    const target = this.getBlobAttackTarget(blob);
    if (target && target.entity.ownerId !== blob.ownerId) {
      blob.actionState =
        rules.attackStyle === "ranged" && this.isBlobRangedAttackActive(blob, target)
          ? BlobActionState.RANGED_ATTACKING
          : BlobActionState.PURSUING;
      return;
    }

    const isMoving =
      this.blobPaths.has(blob.id) ||
      Math.hypot(blob.targetX - blob.x, blob.targetY - blob.y) > CONFIG.BLOB_STOP_EPSILON * 1.5 ||
      Math.hypot(blob.vx, blob.vy) > 0.1;
    blob.actionState = isMoving ? BlobActionState.MOVING : BlobActionState.IDLE;
  }

  private getBlobPairKey(a: Blob, b: Blob): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  private clearBlobCombatAssignment(blob: Blob): void {
    blob.combatGroupId = "";
    blob.combatCenterX = blob.x;
    blob.combatCenterY = blob.y;
    this.clearBlobEngagedTarget(blob);
  }

  private blobHasCombatGroup(blob: Blob): boolean {
    return blob.combatGroupId.length > 0;
  }

  private getCombatNeighborIds(blobId: string): string[] {
    const neighbors: string[] = [];
    for (const key of this.combatLinks) {
      const [aId, bId] = key.split(":");
      if (aId === blobId && bId) neighbors.push(bId);
      else if (bId === blobId && aId) neighbors.push(aId);
    }
    return neighbors;
  }

  private refreshCombatLinks(): void {
    const blobList = Array.from(this.state.blobs.values());
    const nextLinks = new Set<string>();

    for (const existingKey of Array.from(this.combatLinks)) {
      const [aId, bId] = existingKey.split(":");
      const a = aId ? this.state.blobs.get(aId) : null;
      const b = bId ? this.state.blobs.get(bId) : null;
      if (!a || !b || a.ownerId === b.ownerId) {
        this.combatLinks.delete(existingKey);
        continue;
      }

      const aRetreat = this.blobHasRetreatIntent(a);
      const bRetreat = this.blobHasRetreatIntent(b);
      if (aRetreat && bRetreat) continue;
      if (aRetreat && this.canBlobInstantlyDisengage(a, b)) {
        this.addDisengageLock(a, b);
        continue;
      }
      if (bRetreat && this.canBlobInstantlyDisengage(b, a)) {
        this.addDisengageLock(a, b);
        continue;
      }

      const releaseDistance = this.getBlobEngageDistance(a, b) + DISENGAGE_LOCK_RELEASE_BUFFER;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= releaseDistance) {
        nextLinks.add(existingKey);
      }
    }

    for (let i = 0; i < blobList.length; i++) {
      const a = blobList[i]!;
      for (let j = i + 1; j < blobList.length; j++) {
        const b = blobList[j]!;
        if (a.ownerId === b.ownerId) continue;
        const key = this.getBlobPairKey(a, b);
        if (nextLinks.has(key) || this.hasDisengageLock(a, b)) continue;
        if (!this.blobsCanEngage(a, b)) continue;
        nextLinks.add(key);
      }
    }

    this.combatLinks = nextLinks;
  }

  private assignCombatGroups(): void {
    for (const blob of this.state.blobs.values()) {
      this.clearBlobCombatAssignment(blob);
    }

    const visited = new Set<string>();
    for (const blob of this.state.blobs.values()) {
      if (visited.has(blob.id)) continue;
      const neighbors = this.getCombatNeighborIds(blob.id);
      if (neighbors.length === 0) continue;

      const queue = [blob.id];
      const memberIds: string[] = [];
      const owners = new Set<string>();
      while (queue.length > 0) {
        const currentId = queue.pop()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const current = this.state.blobs.get(currentId);
        if (!current) continue;
        memberIds.push(currentId);
        owners.add(current.ownerId);
        for (const neighborId of this.getCombatNeighborIds(currentId)) {
          if (!visited.has(neighborId)) queue.push(neighborId);
        }
      }
      if (memberIds.length <= 1 || owners.size <= 1) continue;

      let totalWeight = 0;
      let centerX = 0;
      let centerY = 0;
      for (const memberId of memberIds) {
        const member = this.state.blobs.get(memberId);
        if (!member) continue;
        const weight = Math.max(1, member.unitCount);
        totalWeight += weight;
        centerX += member.x * weight;
        centerY += member.y * weight;
      }
      if (totalWeight <= 0) continue;
      centerX /= totalWeight;
      centerY /= totalWeight;

      const groupId = `cg:${memberIds.slice().sort()[0]}`;
      for (const memberId of memberIds) {
        const member = this.state.blobs.get(memberId);
        if (!member) continue;
        member.combatGroupId = groupId;
        member.combatCenterX = centerX;
        member.combatCenterY = centerY;

        let bestEnemy: Blob | null = null;
        let bestDistance = Infinity;
        for (const otherId of memberIds) {
          const other = this.state.blobs.get(otherId);
          if (!other || other.ownerId === member.ownerId) continue;
          const distance = Math.hypot(member.x - other.x, member.y - other.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestEnemy = other;
          }
        }
        if (bestEnemy) {
          member.engagedTargetType = AttackTargetType.BLOB;
          member.engagedTargetId = bestEnemy.id;
        }
      }
    }
  }

  private resolveCombatGroupRetreats(): boolean {
    const groups = new Map<string, Blob[]>();
    for (const blob of this.state.blobs.values()) {
      if (!this.blobHasCombatGroup(blob)) continue;
      const list = groups.get(blob.combatGroupId) ?? [];
      list.push(blob);
      groups.set(blob.combatGroupId, list);
    }

    let changed = false;
    for (const members of groups.values()) {
      const owners = new Set<string>();
      const retreatOwners = new Set<string>();
      for (const blob of members) {
        owners.add(blob.ownerId);
        if (this.blobHasRetreatIntent(blob)) retreatOwners.add(blob.ownerId);
      }
      if (owners.size === 0 || retreatOwners.size !== owners.size) continue;

      for (let i = 0; i < members.length; i++) {
        const a = members[i]!;
        for (let j = i + 1; j < members.length; j++) {
          const b = members[j]!;
          if (a.ownerId === b.ownerId) continue;
          this.addDisengageLock(a, b);
          changed = this.combatLinks.delete(this.getBlobPairKey(a, b)) || changed;
        }
      }
    }
    return changed;
  }

  private addDisengageLock(a: Blob, b: Blob): void {
    this.disengageLocks.add(this.getBlobPairKey(a, b));
  }

  private hasDisengageLock(a: Blob, b: Blob): boolean {
    return this.disengageLocks.has(this.getBlobPairKey(a, b));
  }

  private pruneDisengageLocks(): void {
    for (const key of Array.from(this.disengageLocks)) {
      const [aId, bId] = key.split(":");
      const a = aId ? this.state.blobs.get(aId) : null;
      const b = bId ? this.state.blobs.get(bId) : null;
      if (!a || !b) {
        this.disengageLocks.delete(key);
        continue;
      }
      const releaseDistance = this.getBlobEngageDistance(a, b) + DISENGAGE_LOCK_RELEASE_BUFFER;
      if (Math.hypot(a.x - b.x, a.y - b.y) > releaseDistance) {
        this.disengageLocks.delete(key);
      }
    }
  }

  private blobIsWithinAttackRange(blob: Blob, target: AttackableTarget, extraRange = 0): boolean {
    return Math.hypot(blob.x - target.entity.x, blob.y - target.entity.y) <= this.getBlobAttackRange(blob, target) + extraRange;
  }

  private blobsCanEngage(a: Blob, b: Blob): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= this.getBlobEngageDistance(a, b);
  }

  /**
   * Only lock engagement if the defender is idle or fighting back.
   * If they issued a move (flee) and are not attacking this enemy, stay disengaged even when overlapping.
   */
  private defenderAllowsEngagement(defender: Blob, attacker: Blob): boolean {
    if (this.blobsCanEngage(defender, attacker)) return true;
    if (defender.attackTargetType === AttackTargetType.BLOB && defender.attackTargetId === attacker.id) return true;
    const moveSlack = CONFIG.BLOB_STOP_EPSILON * 2.5;
    const hasActiveMove =
      this.blobPaths.has(defender.id) ||
      Math.hypot(defender.targetX - defender.x, defender.targetY - defender.y) > moveSlack;
    return !hasActiveMove;
  }

  private clearBlobCombatState(blob: Blob): void {
    const other = this.getBlobEngagedBlobTarget(blob);
    if (other?.engagedTargetType === AttackTargetType.BLOB && other.engagedTargetId === blob.id) {
      this.clearBlobEngagedTarget(other);
    }
    this.clearBlobEngagedTarget(blob);
  }

  private getBlobOwnerClient(blob: Blob): Client | undefined {
    return this.clients.find((candidate) => candidate.sessionId === blob.ownerId);
  }

  private clearBlobPath(blob: Blob, client?: Client): void {
    const removed = this.blobPaths.delete(blob.id);
    this.combatRetreatTargets.delete(blob.id);
    if (!removed) return;
    (client ?? this.getBlobOwnerClient(blob))?.send(MessageType.PATH, {
      blobId: blob.id,
      waypoints: [],
    } satisfies PathMessage);
  }

  private getBlobRetreatTarget(blob: Blob): { x: number; y: number } | null {
    return this.combatRetreatTargets.get(blob.id) ?? null;
  }

  private blobHasRetreatIntent(blob: Blob): boolean {
    const target = this.getBlobRetreatTarget(blob);
    if (!target) return false;
    return Math.hypot(target.x - blob.x, target.y - blob.y) > CONFIG.BLOB_STOP_EPSILON * 2.5;
  }

  private canBlobInstantlyDisengage(blob: Blob, target: Blob): boolean {
    const rules = getBlobMoveRules(blob.unitType);
    return rules.canAlwaysDisengage && blob.unitType !== target.unitType;
  }

  private advanceBlobAlongPath(blob: Blob, dt: number, speedScale = 1): boolean {
    let pathData = this.blobPaths.get(blob.id);
    if (pathData && pathData.index < pathData.waypoints.length) {
      const wp = pathData.waypoints[pathData.index]!;
      const waypointDist = Math.hypot(blob.x - wp.x, blob.y - wp.y);
      const reachRadius = pathData.index === pathData.waypoints.length - 1 ? CONFIG.BLOB_STOP_EPSILON : WAYPOINT_REACH;
      if (waypointDist < reachRadius) pathData.index++;
    }

    if (!pathData || pathData.index >= pathData.waypoints.length) {
      this.clearBlobPath(blob);
      const currentSpeed = Math.hypot(blob.vx, blob.vy);
      const slowDown = Math.max(0, 1 - dt * 18);
      blob.vx *= slowDown;
      blob.vy *= slowDown;
      if (Math.hypot(blob.vx, blob.vy) < 0.05) {
        blob.vx = 0;
        blob.vy = 0;
      }
      if (Math.hypot(blob.targetX - blob.x, blob.targetY - blob.y) < CONFIG.BLOB_STOP_EPSILON && currentSpeed < 0.75) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
      }
      return false;
    }

    const next = pathData.waypoints[pathData.index]!;
    const isFinalWaypoint = pathData.index === pathData.waypoints.length - 1;
    const dx = next.x - blob.x;
    const dy = next.y - blob.y;
    const dist = Math.hypot(dx, dy);
    const currentSpeed = Math.hypot(blob.vx, blob.vy);
    const rules = getBlobMoveRules(blob.unitType);

    if (isFinalWaypoint && dist < CONFIG.BLOB_STOP_EPSILON && currentSpeed < 0.75) {
      blob.x = blob.targetX;
      blob.y = blob.targetY;
      blob.vx = 0;
      blob.vy = 0;
      this.clearBlobPath(blob);
      return false;
    }

    const desiredSpeed = isFinalWaypoint && dist < rules.decelerationRadius
      ? rules.moveSpeed * speedScale * Math.max(0, dist / rules.decelerationRadius)
      : rules.moveSpeed * speedScale;

    const nx = dist > 0.0001 ? dx / dist : 0;
    const ny = dist > 0.0001 ? dy / dist : 0;
    const desiredVx = nx * desiredSpeed;
    const desiredVy = ny * desiredSpeed;
    const deltaVx = desiredVx - blob.vx;
    const deltaVy = desiredVy - blob.vy;
    const deltaSpeed = Math.hypot(deltaVx, deltaVy);
    const accel = desiredSpeed > currentSpeed ? rules.acceleration : rules.acceleration * 1.6;
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

    if (isFinalWaypoint && Math.hypot(blob.targetX - blob.x, blob.targetY - blob.y) < CONFIG.BLOB_STOP_EPSILON) {
      blob.x = blob.targetX;
      blob.y = blob.targetY;
      blob.vx = 0;
      blob.vy = 0;
      this.clearBlobPath(blob);
    }
    return true;
  }

  /**
   * Every melee combat group collapses toward one shared center.
   * If some members are trying to leave, the whole melee scrimmage drifts slowly
   * in that weighted direction instead of instantly breaking.
   */
  private applyCombatGroupOverlap(dt: number): void {
    const groups = new Map<string, Blob[]>();
    for (const blob of this.state.blobs.values()) {
      if (!this.blobHasCombatGroup(blob)) continue;
      const list = groups.get(blob.combatGroupId) ?? [];
      list.push(blob);
      groups.set(blob.combatGroupId, list);
    }

    for (const members of groups.values()) {
      let totalWeight = 0;
      let centerX = 0;
      let centerY = 0;
      let driftX = 0;
      let driftY = 0;
      let driftWeight = 0;

      for (const blob of members) {
        const weight = Math.max(1, blob.unitCount);
        totalWeight += weight;
        centerX += blob.x * weight;
        centerY += blob.y * weight;
        if (!this.blobHasRetreatIntent(blob)) this.clearBlobPath(blob);

        if (!this.blobHasRetreatIntent(blob)) continue;
        const retreatTarget = this.getBlobRetreatTarget(blob);
        if (!retreatTarget) continue;
        const dx = retreatTarget.x - blob.x;
        const dy = retreatTarget.y - blob.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 1e-4) continue;
        const rules = getBlobMoveRules(blob.unitType);
        driftX += (dx / dist) * rules.moveSpeed * rules.retreatSpeedMultiplier * weight;
        driftY += (dy / dist) * rules.moveSpeed * rules.retreatSpeedMultiplier * weight;
        driftWeight += weight;
      }

      if (totalWeight <= 0) continue;
      centerX /= totalWeight;
      centerY /= totalWeight;
      if (driftWeight > 0) {
        centerX += (driftX / driftWeight) * dt;
        centerY += (driftY / driftWeight) * dt;
      }

      const step = CONFIG.ENGAGE_OVERLAP_CONVERGE_SPEED * dt;
      for (const blob of members) {
        const dx = centerX - blob.x;
        const dy = centerY - blob.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= CONFIG.ENGAGE_OVERLAP_EPSILON) {
          blob.x = centerX;
          blob.y = centerY;
          blob.vx = 0;
          blob.vy = 0;
        } else {
          const move = Math.min(step, dist);
          const ox = blob.x;
          const oy = blob.y;
          blob.x = clamp(blob.x + (dx / dist) * move, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
          blob.y = clamp(blob.y + (dy / dist) * move, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
          blob.vx = (blob.x - ox) / Math.max(dt, 1e-4);
          blob.vy = (blob.y - oy) / Math.max(dt, 1e-4);
        }
        blob.targetX = centerX;
        blob.targetY = centerY;
        blob.combatCenterX = centerX;
        blob.combatCenterY = centerY;
      }
    }
  }

  private findNearestWalkablePoint(x: number, y: number, maxRadiusTiles = 0): { x: number; y: number } | null {
    const goalX = clamp(x, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    const goalY = clamp(y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    const start = getTileCoordsFromWorld(goalX, goalY);
    const walkable = (tx: number, tz: number) => this.tileData.get(getTileKey(tx, tz))?.canWalk ?? false;

    if (walkable(start.tx, start.tz)) return { x: goalX, y: goalY };

    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    const tileCount = getWorldTileCount();

    for (let radius = 1; radius <= maxRadiusTiles; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const tx = start.tx + dx;
          const tz = start.tz + dz;
          if (tx < 0 || tz < 0 || tx >= tileCount || tz >= tileCount || !walkable(tx, tz)) continue;
          const center = getTileCenter(tx, tz);
          const distance = Math.hypot(center.x - goalX, center.z - goalY);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { x: center.x, y: center.z };
          }
        }
      }
      if (best) return best;
    }

    return null;
  }

  /**
   * Attack move goal: the enemy squad center (nearest walkable point).
   * Engagement triggers as soon as centers are within range — no stop at a ring outside the target.
   */
  private getBlobAttackApproachPoint(blob: Blob, target: AttackableTarget): { x: number; y: number } | null {
    const rules = getUnitRules(blob.unitType);
    if (rules.attackStyle !== "ranged") {
      return this.findNearestWalkablePoint(target.entity.x, target.entity.y, 3);
    }

    const dx = blob.x - target.entity.x;
    const dy = blob.y - target.entity.y;
    const dist = Math.hypot(dx, dy);
    const targetRadius = this.getAttackTargetRadius(target);
    const holdRadius = Math.max(
      targetRadius + Math.max(0, rules.attackRange - RANGED_ATTACK_COMMIT_INSET),
      targetRadius + GAME_RULES.TILE_SIZE * 0.18
    );
    const dirX = dist > 1e-4 ? dx / dist : 1;
    const dirY = dist > 1e-4 ? dy / dist : 0;
    return this.findNearestWalkablePoint(target.entity.x + dirX * holdRadius, target.entity.y + dirY * holdRadius, 3);
  }

  private setBlobDestination(
    blob: Blob,
    targetX: number,
    targetY: number,
    client?: Client,
    options?: { snapToNearestWalkable?: boolean }
  ): void {
    const resolvedGoal =
      this.findNearestWalkablePoint(targetX, targetY, options?.snapToNearestWalkable ? 3 : 0);
    if (!resolvedGoal) {
      blob.targetX = blob.x;
      blob.targetY = blob.y;
      blob.vx = 0;
      blob.vy = 0;
      this.clearBlobPath(blob, client);
      return;
    }

    blob.targetX = resolvedGoal.x;
    blob.targetY = resolvedGoal.y;

    const walkable = (tx: number, tz: number) => this.tileData.get(getTileKey(tx, tz))?.canWalk ?? false;
    const start = getTileCoordsFromWorld(blob.x, blob.y);
    const goalTile = getTileCoordsFromWorld(blob.targetX, blob.targetY);
    const path = findPath(start.tx, start.tz, goalTile.tx, goalTile.tz, walkable);

    if (path.length === 0) {
      blob.targetX = blob.x;
      blob.targetY = blob.y;
      blob.vx = 0;
      blob.vy = 0;
      this.clearBlobPath(blob, client);
      return;
    }

    path[path.length - 1] = { x: blob.targetX, y: blob.targetY };
    // Start from actual squad position so the first segment is not a jog to the start tile center.
    if (path.length >= 2) {
      path[0] = { x: blob.x, y: blob.y };
    } else {
      const gx = blob.targetX;
      const gy = blob.targetY;
      path[0] = { x: blob.x, y: blob.y };
      if (Math.hypot(gx - blob.x, gy - blob.y) > 1e-4) {
        path.push({ x: gx, y: gy });
      }
    }

    this.blobPaths.set(blob.id, { waypoints: path, index: 0 });

    (client ?? this.getBlobOwnerClient(blob))?.send(MessageType.PATH, {
      blobId: blob.id,
      waypoints: path,
    } satisfies PathMessage);
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;
    this.pruneDisengageLocks();

    for (const building of this.state.buildings.values()) {
      this.stepBuildingProduction(building, dtMs);
    }

    for (const blob of this.state.blobs.values()) {
      blob.radius = getSquadRadius(blob.unitCount, blob.spread);
    }

    this.refreshCombatLinks();
    this.assignCombatGroups();
    if (this.resolveCombatGroupRetreats()) {
      this.assignCombatGroups();
    }

    for (const blob of this.state.blobs.values()) {
      if (this.blobHasCombatGroup(blob)) continue;
      if (blob.attackTargetId.length > 0) {
        const target = this.getBlobAttackTarget(blob);
        if (!target || target.entity.ownerId === blob.ownerId) {
          this.clearBlobAttackTarget(blob);
          blob.targetX = blob.x;
          blob.targetY = blob.y;
          blob.vx = 0;
          blob.vy = 0;
          this.clearBlobPath(blob);
        } else {
          const rules = getUnitRules(blob.unitType);
          if (
            rules.attackStyle === "ranged"
              ? this.isBlobRangedAttackActive(blob, target)
              : this.blobIsWithinAttackRange(blob, target, GAME_RULES.UNIT_RADIUS * 0.3)
          ) {
            blob.targetX = blob.x;
            blob.targetY = blob.y;
            blob.vx = 0;
            blob.vy = 0;
            this.clearBlobPath(blob);
          } else {
            const approach = this.getBlobAttackApproachPoint(blob, target);
            const needNewPath =
              !approach ||
              !this.blobPaths.has(blob.id) ||
              Math.hypot(blob.targetX - approach.x, blob.targetY - approach.y) > GAME_RULES.TILE_SIZE * 0.35;
            if (approach && needNewPath) {
              this.setBlobDestination(
                blob,
                approach.x,
                approach.y,
                this.getBlobOwnerClient(blob),
                { snapToNearestWalkable: true }
              );
            } else if (!approach) {
              blob.targetX = blob.x;
              blob.targetY = blob.y;
              blob.vx = 0;
              blob.vy = 0;
              this.clearBlobPath(blob);
            }
          }
        }
      }
    }

    this.refreshCombatLinks();
    this.assignCombatGroups();
    if (this.resolveCombatGroupRetreats()) {
      this.assignCombatGroups();
    }
    this.applyCombatGroupOverlap(dt);

    for (const blob of this.state.blobs.values()) {
      if (this.blobHasCombatGroup(blob)) {
        continue;
      }
      const moved = this.advanceBlobAlongPath(blob, dt);
      if (!moved) this.tryVillagerGather(blob, dt);
    }

    for (const blob of this.state.blobs.values()) {
      this.refreshBlobActionState(blob);
    }

    this.resolveRangedBlobCombat(dt);
    this.resolveBlobCombat(dt);
    this.rebalanceFriendlyBlobs();

    for (const blob of this.state.blobs.values()) {
      this.refreshBlobActionState(blob);
    }
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
    const deadIds = new Set<string>();
    const pendingDamage = new Map<string, number>();
    const groups = new Map<string, Blob[]>();

    for (const blob of this.state.blobs.values()) {
      if (!this.blobHasCombatGroup(blob)) continue;
      const list = groups.get(blob.combatGroupId) ?? [];
      list.push(blob);
      groups.set(blob.combatGroupId, list);
    }

    for (const members of groups.values()) {
      for (const attacker of members) {
        const attackerRules = getUnitRules(attacker.unitType);
        const enemies = members.filter((candidate) => candidate.ownerId !== attacker.ownerId);
        const totalEnemyUnits = enemies.reduce((sum, enemy) => sum + Math.max(1, enemy.unitCount), 0);
        if (totalEnemyUnits <= 0) continue;
        const totalDamage = attacker.unitCount * attackerRules.meleeDpsPerUnit * dt;
        for (const enemy of enemies) {
          const weight = Math.max(1, enemy.unitCount) / totalEnemyUnits;
          pendingDamage.set(enemy.id, (pendingDamage.get(enemy.id) ?? 0) + totalDamage * weight);
        }
      }
    }

    for (const [blobId, damage] of pendingDamage) {
      const blob = this.state.blobs.get(blobId);
      if (!blob) continue;
      blob.health -= damage;
      this.syncBlobHealthToUnitCount(blob);
      if (blob.unitCount <= 0 || blob.health <= 0) deadIds.add(blob.id);
    }

    if (deadIds.size === 0) return;
    for (const deadId of deadIds) {
      this.blobPaths.delete(deadId);
      this.state.blobs.delete(deadId);
    }
    this.clearDeadBlobTargetRefs(deadIds);
  }

  private resolveRangedBlobCombat(dt: number): void {
    const deadBlobIds = new Set<string>();
    const deadBuildingIds = new Set<string>();

    for (const blob of this.state.blobs.values()) {
      if (this.blobHasCombatGroup(blob)) continue;
      if (blob.attackTargetId.length === 0) continue;
      const rules = getUnitRules(blob.unitType);
      const target = this.getBlobAttackTarget(blob);
      if (!target || target.entity.ownerId === blob.ownerId) continue;
      if (rules.attackStyle === "ranged") {
        if (blob.actionState !== BlobActionState.RANGED_ATTACKING) continue;
      } else if (!this.blobIsWithinAttackRange(blob, target, GAME_RULES.UNIT_RADIUS * 0.3)) {
        continue;
      }

      const damage = blob.unitCount * (rules.attackStyle === "ranged" ? rules.dpsPerUnit : rules.meleeDpsPerUnit) * dt;
      if (target.type === AttackTargetType.BLOB) {
        target.entity.health -= damage;
        this.syncBlobHealthToUnitCount(target.entity);
        if (target.entity.unitCount <= 0 || target.entity.health <= 0) deadBlobIds.add(target.entity.id);
      } else {
        target.entity.health = Math.max(0, target.entity.health - damage);
        if (target.entity.health <= 0) deadBuildingIds.add(target.entity.id);
      }
    }

    if (deadBlobIds.size === 0 && deadBuildingIds.size === 0) return;
    for (const deadId of deadBlobIds) {
      this.blobPaths.delete(deadId);
      this.state.blobs.delete(deadId);
    }
    this.clearDeadBlobTargetRefs(deadBlobIds);
    this.destroyBuildings(deadBuildingIds);
  }

  private clearDeadBlobTargetRefs(deadIds: Set<string>): void {
    if (deadIds.size === 0) return;
    for (const key of Array.from(this.combatLinks)) {
      const [aId, bId] = key.split(":");
      if ((aId && deadIds.has(aId)) || (bId && deadIds.has(bId))) {
        this.combatLinks.delete(key);
      }
    }
    for (const blob of this.state.blobs.values()) {
      if (blob.attackTargetType === AttackTargetType.BLOB && deadIds.has(blob.attackTargetId)) {
        this.clearBlobAttackTarget(blob);
        blob.targetX = blob.x;
        blob.targetY = blob.y;
        blob.vx = 0;
        blob.vy = 0;
        this.clearBlobPath(blob);
      }
      if (blob.engagedTargetType === AttackTargetType.BLOB && deadIds.has(blob.engagedTargetId)) {
        this.clearBlobCombatState(blob);
      }
    }
    for (const deadId of deadIds) this.combatRetreatTargets.delete(deadId);
  }

  private destroyBuildings(deadBuildingIds: Set<string>): void {
    if (deadBuildingIds.size === 0) return;
    for (const id of deadBuildingIds) {
      const building = this.state.buildings.get(id);
      if (!building) continue;
      this.removeBuildingFootprint(building);
      this.state.buildings.delete(id);
    }
    for (const blob of this.state.blobs.values()) {
      if (blob.attackTargetType === AttackTargetType.BUILDING && deadBuildingIds.has(blob.attackTargetId)) {
        this.clearBlobAttackTarget(blob);
        blob.targetX = blob.x;
        blob.targetY = blob.y;
        blob.vx = 0;
        blob.vy = 0;
        this.clearBlobPath(blob);
      }
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

  private spawnStartingBlob(building: Building, unitType: UnitType, unitCount: number, slotIndex: number): void {
    const angle = slotIndex * (Math.PI * 0.5) - Math.PI * 0.75;
    const radius = GAME_RULES.TILE_SIZE * 1.65;
    const spawnX = clamp(building.x + Math.cos(angle) * radius, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    const spawnY = clamp(building.y + Math.sin(angle) * radius, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);

    const blob = new Blob();
    blob.id = makeId("blob");
    blob.ownerId = building.ownerId;
    blob.x = spawnX;
    blob.y = spawnY;
    blob.targetX = spawnX;
    blob.targetY = spawnY;
    blob.vx = 0;
    blob.vy = 0;
    blob.unitCount = unitCount;
    blob.spread = unitType === UnitType.VILLAGER ? SquadSpread.TIGHT : SquadSpread.DEFAULT;
    blob.radius = getSquadRadius(blob.unitCount, blob.spread);
    blob.health = getBlobMaxHealth(unitType, unitCount);
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

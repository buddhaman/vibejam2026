import { Room, type Client } from "colyseus";
import { GameState, Player, Blob, Building } from "./state.js";
import { CONFIG } from "./config.js";
import {
  BuildingType,
  SquadSpread,
  getBuildingRules,
  getSquadRadius,
  isBuildingType,
  isSquadSpread,
  snapWorldToTileCenter,
} from "../../shared/game-rules.js";
import { MessageType, type IntentMessage, type BuildMessage, type SquadSpreadMessage, type TrainMessage } from "../../shared/protocol.js";

let nextId = 1;
function makeId(prefix: string) {
  return `${prefix}_${nextId++}`;
}

function hashColor(sessionId: string): number {
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = 80 + (h & 0x7f);
  const g = 80 + ((h >> 8) & 0x7f);
  const b = 80 + ((h >> 16) & 0x7f);
  return (r << 16) | (g << 8) | b;
}

/** @see https://docs.colyseus.io/state/ — state is assigned on the class in 0.17+ */
export class BattleRoom extends Room<{ state: GameState }> {
  maxClients = 64;
  state = new GameState();

  onCreate() {
    this.state.terrainSeed = Math.floor(Math.random() * 0xffffffff);

    const intervalMs = 1000 / CONFIG.TICK_HZ;
    this.setSimulationInterval((dt) => this.tick(dt), intervalMs);

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
      blob.targetX = clamp(msg.targetX, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.targetY = clamp(msg.targetY, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
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
      this.state.buildings.forEach((b) => { if (b.ownerId === client.sessionId) count++; });
      if (count >= CONFIG.MAX_BUILDINGS_PER_PLAYER) return;

      const building = new Building();
      const snapped = snapWorldToTileCenter(msg.worldX, msg.worldZ);
      building.id = makeId("bld");
      building.ownerId = client.sessionId;
      building.x = snapped.x;
      building.y = snapped.z;
      building.buildingType = msg.type;
      building.health = getBuildingRules(msg.type).health;

      this.state.buildings.set(building.id, building);
    });

    this.onMessage(MessageType.TRAIN, (client, raw) => {
      const msg = raw as TrainMessage;
      if (typeof msg?.buildingId !== "string") {
        return;
      }

      const building = this.state.buildings.get(msg.buildingId);
      if (!building || building.ownerId !== client.sessionId || building.buildingType !== BuildingType.BARRACKS) {
        return;
      }

      const blob = new Blob();
      const buildingRules = getBuildingRules(building.buildingType);
      blob.id = makeId("blob");
      blob.ownerId = client.sessionId;
      blob.x = clamp(building.x + buildingRules.trainSpawnOffsetX, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.y = clamp(building.y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.targetX = blob.x;
      blob.targetY = blob.y;
      blob.vx = 0;
      blob.vy = 0;
      blob.unitCount = CONFIG.DEFAULT_UNIT_COUNT;
      blob.spread = SquadSpread.DEFAULT;
      blob.radius = getSquadRadius(blob.unitCount, blob.spread);
      blob.health = CONFIG.DEFAULT_BLOB_HEALTH;
      this.state.blobs.set(blob.id, blob);
    });
  }

  onJoin(client: Client) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.color = hashColor(client.sessionId);
    this.state.players.set(client.sessionId, player);

    const cx = (Math.random() - 0.5) * 40;
    const cy = (Math.random() - 0.5) * 40;

    const offsets = [
      { dx: -CONFIG.START_BLOB_SPACING * 0.5, dy: 0 },
      { dx: CONFIG.START_BLOB_SPACING * 0.5, dy: 0 },
    ];

    for (const o of offsets) {
      const blob = new Blob();
      blob.id = makeId("blob");
      blob.ownerId = client.sessionId;
      blob.x = cx + o.dx;
      blob.y = cy + o.dy;
      blob.targetX = blob.x;
      blob.targetY = blob.y;
      blob.vx = 0;
      blob.vy = 0;
      blob.unitCount = CONFIG.DEFAULT_UNIT_COUNT;
      blob.spread = SquadSpread.DEFAULT;
      blob.radius = getSquadRadius(blob.unitCount, blob.spread);
      blob.health = CONFIG.DEFAULT_BLOB_HEALTH;
      this.state.blobs.set(blob.id, blob);
    }
  }

  onLeave(client: Client, _code: number) {
    const sid = client.sessionId;
    this.state.players.delete(sid);

    const blobIds: string[] = [];
    this.state.blobs.forEach((b, id) => {
      if (b.ownerId === sid) blobIds.push(id as string);
    });
    for (const id of blobIds) this.state.blobs.delete(id);

    const buildingIds: string[] = [];
    this.state.buildings.forEach((b, id) => {
      if (b.ownerId === sid) buildingIds.push(id as string);
    });
    for (const id of buildingIds) this.state.buildings.delete(id);
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;

    for (const blob of this.state.blobs.values()) {
      blob.radius = getSquadRadius(blob.unitCount, blob.spread);
      const dx = blob.targetX - blob.x;
      const dy = blob.targetY - blob.y;
      const dist = Math.hypot(dx, dy);
      const currentSpeed = Math.hypot(blob.vx, blob.vy);

      if (dist < CONFIG.BLOB_STOP_EPSILON && currentSpeed < 0.75) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
        blob.vx = 0;
        blob.vy = 0;
        continue;
      }

      const desiredSpeed =
        dist < CONFIG.BLOB_DECELERATION_RADIUS
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

      const remainingDx = blob.targetX - blob.x;
      const remainingDy = blob.targetY - blob.y;
      if (Math.hypot(remainingDx, remainingDy) < CONFIG.BLOB_STOP_EPSILON) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
        blob.vx = 0;
        blob.vy = 0;
      }
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

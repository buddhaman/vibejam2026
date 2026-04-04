import { Room, type Client } from "colyseus";
import { GameState, Player, Blob, Building } from "./state.js";
import { CONFIG } from "./config.js";
import { BuildingType, getBlobRadius, isBuildingType } from "../../shared/game-rules.js";
import { MessageType, type IntentMessage, type BuildMessage, type TrainMessage } from "../../shared/protocol.js";

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
      building.id = makeId("bld");
      building.ownerId = client.sessionId;
      building.x = clamp(msg.worldX, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      building.y = clamp(msg.worldZ, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      building.buildingType = msg.type;
      building.health =
        msg.type === BuildingType.TOWER ? CONFIG.TOWER_HEALTH : CONFIG.BARRACKS_HEALTH;

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
      blob.id = makeId("blob");
      blob.ownerId = client.sessionId;
      blob.x = clamp(building.x + 6, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.y = clamp(building.y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.targetX = blob.x;
      blob.targetY = blob.y;
      blob.unitCount = CONFIG.DEFAULT_UNIT_COUNT;
      blob.radius = getBlobRadius(blob.unitCount);
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
      blob.unitCount = CONFIG.DEFAULT_UNIT_COUNT;
      blob.radius = getBlobRadius(blob.unitCount);
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
    const speed = CONFIG.BLOB_MOVE_SPEED;

    for (const blob of this.state.blobs.values()) {
      const dx = blob.targetX - blob.x;
      const dy = blob.targetY - blob.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05) {
        blob.x = blob.targetX;
        blob.y = blob.targetY;
        continue;
      }
      const step = Math.min(speed * dt, dist);
      blob.x += (dx / dist) * step;
      blob.y += (dy / dist) * step;
      blob.x = clamp(blob.x, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
      blob.y = clamp(blob.y, CONFIG.WORLD_MIN, CONFIG.WORLD_MAX);
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

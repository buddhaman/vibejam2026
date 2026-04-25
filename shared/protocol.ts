import type { BuildingType, SquadSpread, TileType, UnitType } from "./game-rules.js";

export const CLIENT_PROTOCOL_VERSION = 1;

export const MessageType = {
  INTENT:        "intent",
  ATTACK:        "attack",
  GATHER:        "gather",
  BUILD:         "build",
  TRAIN:         "train",
  SET_RALLY:     "set_rally",
  SQUAD_SPREAD:  "squad_spread",
  BLOB_AGGRO:    "blob_aggro",
  SET_NAME:      "set_name",
  CHAT:          "chat",
  SYSTEM_NOTICE: "system_notice",
  ROUND_RESET:   "round_reset",
  // Tile streaming — client requests chunks, server replies; server pushes mutations
  TILES_REQUEST: "tiles_req",
  TILE_CHUNKS_REQUEST: "tile_chunks_req",
  TILE_CHUNK:    "tile_chunk",
  TILE_UPDATE:   "tile_update",
  // Path — server sends A* result to the owning client after each move intent
  PATH:          "path",
} as const;

export const AttackTargetType = {
  NONE: 0,
  BLOB: 1,
  BUILDING: 2,
} as const;

export type AttackTargetType = (typeof AttackTargetType)[keyof typeof AttackTargetType];

export const BlobActionState = {
  IDLE: 0,
  MOVING: 1,
  PURSUING: 2,
  RANGED_ATTACKING: 3,
  ENGAGED: 4,
  RETREATING: 5,
} as const;

export type BlobActionState = (typeof BlobActionState)[keyof typeof BlobActionState];

export const BlobAggroMode = {
  PASSIVE: 0,
  ACTIVE: 1,
} as const;

export type BlobAggroMode = (typeof BlobAggroMode)[keyof typeof BlobAggroMode];

export type IntentMessage = {
  blobId: string;
  targetX: number;
  targetY: number;
};

export type AttackMessage = {
  blobId: string;
  targetType: AttackTargetType;
  targetId: string;
};

export const CarriedResourceType = {
  NONE: 0,
  MATERIAL: 1,
  COMPUTE: 2,
  BIOMASS: 3,
} as const;

export type CarriedResourceType = (typeof CarriedResourceType)[keyof typeof CarriedResourceType];

export const BlobGatherPhase = {
  NONE: 0,
  MOVING_TO_RESOURCE: 1,
  PICKING_UP: 2,
  RETURNING: 3,
  DROPPING_OFF: 4,
} as const;

export type BlobGatherPhase = (typeof BlobGatherPhase)[keyof typeof BlobGatherPhase];

export type GatherMessage = {
  blobId: string;
  tileKey?: string;
  buildingId?: string;
};

export type BuildMessage = {
  type: BuildingType;
  worldX: number;
  worldZ: number;
};

export type TrainMessage = {
  buildingId: string;
  unitType: UnitType;
};

export type SetRallyMessage = {
  buildingId: string;
  worldX: number;
  worldZ: number;
};

export type SquadSpreadMessage = {
  blobId: string;
  spread: SquadSpread;
};

export type BlobAggroMessage = {
  blobId: string;
  aggroMode: BlobAggroMode;
};

export type SetNameMessage = {
  name: string;
};

export type ChatMessage = {
  text: string;
};

export type ChatBroadcastMessage = {
  senderId: string;
  senderName: string;
  text: string;
  sentAt: number;
};

export type SystemNoticeMessage = {
  text: string;
  kind: "info" | "join" | "leave" | "rename";
  sentAt: number;
};

export type RoundResetMessage = {
  terrainSeed: number;
  sentAt: number;
};

/** Client → Server: request one chunk of tile data by index. */
export type TilesRequestMessage = { chunk: number };

/** Client → Server: request specific world chunks by key. */
export type TileChunksRequestMessage = { keys: string[] };

/** The plain tile data sent over the wire (not a Colyseus Schema). */
export type TileData = {
  key: string;
  tx: number;
  tz: number;
  h00: number;
  h10: number;
  h11: number;
  h01: number;
  height: number;
  tileType: TileType;
  material: number;
  maxMaterial: number;
  compute: number;
  maxCompute: number;
  isMountain: boolean;
  canBuild: boolean;
  canWalk: boolean;
};

/** Server → Client: one chunk of the world tile map. */
export type TileChunkMessage = {
  chunk: number;   // 0-based index
  total: number;   // total number of chunks
  key?: string;
  cx?: number;
  cz?: number;
  tiles: TileData[];
};

/** Server → Client: partial tile patch (only fields present are applied). */
export type TileUpdateMessage = {
  key: string;
  material?: number;
  compute?: number;
  canWalk?: boolean;
  canBuild?: boolean;
  h00?: number;
  h10?: number;
  h11?: number;
  h01?: number;
  height?: number;
};

/** Server → Client (owner only): A* path computed after a move intent. Empty waypoints = no path / direct move. */
export type PathMessage = {
  blobId: string;
  waypoints: { x: number; y: number }[];
};

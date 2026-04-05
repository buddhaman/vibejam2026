import type { BuildingType, SquadSpread, TileType, UnitType } from "./game-rules.js";

export const MessageType = {
  INTENT:        "intent",
  BUILD:         "build",
  TRAIN:         "train",
  SQUAD_SPREAD:  "squad_spread",
  // Tile streaming — client requests chunks, server replies; server pushes mutations
  TILES_REQUEST: "tiles_req",
  TILE_CHUNK:    "tile_chunk",
  TILE_UPDATE:   "tile_update",
} as const;

export type IntentMessage = {
  blobId: string;
  targetX: number;
  targetY: number;
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

export type SquadSpreadMessage = {
  blobId: string;
  spread: SquadSpread;
};

/** Client → Server: request one chunk of tile data by index. */
export type TilesRequestMessage = { chunk: number };

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
  wood: number;
  maxWood: number;
  gold: number;
  isMountain: boolean;
  canBuild: boolean;
  canWalk: boolean;
};

/** Server → Client: one chunk of the world tile map. */
export type TileChunkMessage = {
  chunk: number;   // 0-based index
  total: number;   // total number of chunks
  tiles: TileData[];
};

/** Server → Client: a single tile whose mutable state changed (wood / gold). */
export type TileUpdateMessage = {
  key: string;
  wood: number;
  gold: number;
};

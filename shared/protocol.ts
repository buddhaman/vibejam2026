import type { BuildingType, SquadSpread } from "./game-rules.js";

export const MessageType = {
  INTENT: "intent",
  BUILD: "build",
  TRAIN: "train",
  SQUAD_SPREAD: "squad_spread",
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
};

export type SquadSpreadMessage = {
  blobId: string;
  spread: SquadSpread;
};

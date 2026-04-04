import type { BuildingType } from "./game-rules.js";

export const MessageType = {
  INTENT: "intent",
  BUILD: "build",
  TRAIN: "train",
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

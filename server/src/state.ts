import { Schema, type, MapSchema } from "@colyseus/schema";

/** Identity + ownership bookkeeping (blobs/buildings reference ownerId). */
export class Player extends Schema {
  @type("string") sessionId: string = "";
  /** Packed RGB for client tint */
  @type("uint32") color: number = 0xffffff;
}

export class Blob extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") targetX: number = 0;
  @type("number") targetY: number = 0;
  @type("number") radius: number = 0;
  @type("number") health: number = 0;
  @type("uint32") unitCount: number = 0;
}

export class Building extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") buildingType: string = "none";
  @type("number") health: number = 0;
}

/** Authoritative world — gameplay truth only. */
export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Blob }) blobs = new MapSchema<Blob>();
  @type({ map: Building }) buildings = new MapSchema<Building>();
}

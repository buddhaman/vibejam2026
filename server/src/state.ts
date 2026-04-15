import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import type { BuildingType, SquadSpread, UnitType } from "../../shared/game-rules.js";
import type { AttackTargetType, BlobActionState } from "../../shared/protocol.js";

/** Identity + ownership bookkeeping (blobs/buildings reference ownerId). */
export class Player extends Schema {
  @type("string") sessionId: string = "";
  /** Packed RGB for client tint */
  @type("uint32") color: number = 0xffffff;
  @type("uint16") biomass: number = 0;
  @type("uint16") material: number = 0;
  @type("uint16") compute: number = 0;
}

export class Blob extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("uint8") actionState: BlobActionState = 0 as BlobActionState;
  @type("uint8") attackTargetType: AttackTargetType = 0 as AttackTargetType;
  @type("string") attackTargetId: string = "";
  @type("uint8") engagedTargetType: AttackTargetType = 0 as AttackTargetType;
  @type("string") engagedTargetId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") targetX: number = 0;
  @type("number") targetY: number = 0;
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;
  @type("number") radius: number = 0;
  @type("number") health: number = 0;
  @type("uint32") unitCount: number = 0;
  @type("uint8") spread: SquadSpread = 0 as SquadSpread;
  @type("uint8") unitType: UnitType = 0 as UnitType;
}

export class Building extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  /** Numeric type — see BuildingType constants. uint8 keeps wire size minimal. */
  @type("uint8") buildingType: BuildingType = 0 as BuildingType;
  @type("number") health: number = 0;
  @type(["uint8"]) productionQueue = new ArraySchema<UnitType>();
  @type("number") productionProgressMs: number = 0;
}

/** Authoritative world — gameplay truth only. Tiles are streamed separately. */
export class GameState extends Schema {
  @type("uint32") terrainSeed: number = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Blob }) blobs = new MapSchema<Blob>();
  @type({ map: Building }) buildings = new MapSchema<Building>();
}

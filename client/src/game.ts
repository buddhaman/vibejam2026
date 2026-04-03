import type { Room } from "@colyseus/sdk";

/** Thin client-side view — not authoritative. */
export type Game = {
  room: Room;
  /** Selected blob id for issuing move intent (own blobs only). */
  selectedBlobId: string | null;
};

export function createGame(room: Room): Game {
  return { room, selectedBlobId: null };
}

export function isMyBlob(game: Game, ownerId: string): boolean {
  return ownerId === game.room.sessionId;
}

export function sendMoveIntent(game: Game, targetX: number, targetY: number) {
  const id = game.selectedBlobId;
  if (!id) {
    return;
  }
  game.room.send("intent", { blobId: id, targetX, targetY });
}

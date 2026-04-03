import { defineServer, defineRoom } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BattleRoom } from "./room.js";

/**
 * Colyseus 0.17: rooms are registered here. Client uses joinOrCreate("battle").
 * @see https://docs.colyseus.io/server/
 */
export const gameServer = defineServer({
  transport: new WebSocketTransport({}),
  express: (app) => {
    app.get("/", (_req, res) => {
      res
        .type("text/plain")
        .send("Colyseus battle server — connect WebSocket clients to this host.");
    });
  },
  rooms: {
    battle: defineRoom(BattleRoom),
  },
});

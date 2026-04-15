# Vibejam

**Simplicity is the rule.** This repo is a small **TypeScript** stack: an **authoritative Colyseus** server and a **Three.js** browser client. Gameplay truth lives on the server; the client sends **intent** and **renders** what the server says is true.

## What this is

- **Server (`server/src`)** — One room type: `battle`. Fixed tick, movement, spawning. State uses **Colyseus Schema** (`players`, `blobs`, `buildings`). Buildings exist in the model for later; MVP focuses on blobs.
- **Client (`client/src`)** — Connects with `joinOrCreate("battle")`, selects **your** blobs, sends move **intent**, draws a **top-down 3D** view (gameplay stays **2D**: `x` / `y` on the ground plane; Three.js uses `x` / `z`).

## Colyseus stack (current docs)

This project follows the **0.17** line described in the official docs:

- **Server:** [`colyseus`](https://docs.colyseus.io/server/) with [`defineServer` / `defineRoom`](https://docs.colyseus.io/server/) and [`WebSocketTransport`](https://docs.colyseus.io/server/transport/ws) from `@colyseus/ws-transport`.
- **State:** [`@colyseus/schema` 4.x](https://docs.colyseus.io/state/) (`Schema`, `MapSchema`, decorators).
- **Browser client:** [`@colyseus/sdk`](https://docs.colyseus.io/sdk/) — **not** the legacy `colyseus.js` package. The migration guide explicitly says to replace `colyseus.js` with `@colyseus/sdk` when upgrading ([Migrating to 0.17](https://docs.colyseus.io/migrating/0.17/)).
- **Connection URL:** `new Client("http://localhost:2567")` (HTTP origin); the SDK handles WebSockets.

Keep **server**, **schema**, **ws-transport**, and **@colyseus/sdk** on compatible **0.17.x** releases so the binary protocol and schema handshake match.

## Architecture: state-driven sync

**Core principle:** the server sends authoritative state, not gameplay events. The client derives all visuals and effects from state changes over time.

### Data flow

```
Server tick (20 Hz)
  1. process inputs
  2. mutate Schema (players / blobs / buildings)
  3. Colyseus auto-sends binary diff to all clients

Client frame (60 FPS)
  4. Colyseus applies diff → local state mirror updated
  5. onAdd / onRemove callbacks fire for new/removed entities
  6. render loop reads current state → syncs visuals
```

### No gameplay events rule

The server never broadcasts `"unitDied"`, `"buildingDestroyed"`, etc.
State is the single source of truth. The client detects what changed:

| Diff | Client reaction |
|---|---|
| Entity added to `blobs` | spawn visual group |
| Entity removed from `blobs` | remove visual, trigger death FX |
| `unitCount` decreased | kill some ragdolls, spawn hit effects |
| Entity added to `buildings` | spawn building mesh |
| Entity removed from `buildings` | collapse + debris (future) |

### Shared protocol and gameplay rules

Packet names, payload shapes, and gameplay numbers that matter to both server authority and client prediction live in one place:

```
shared/protocol.ts    # wire message names + payload types
shared/game-rules.ts  # building ids + gameplay tuning used on both sides
```

This is important:

- Do not redefine packet payloads in `client/` and `server/` separately.
- Do not duplicate gameplay values like move speed, world bounds, or build type ids.
- If the client needs a value for prediction, interpolation, or validation, define it in `shared/` and import it from both sides.

That keeps prediction honest and avoids server/client drift.

### Message protocol (client → server)

| Message | Payload | Effect |
|---|---|---|
| `"intent"` | `{ blobId, targetX, targetY }` | move a blob toward a world point |
| `"build"` | `{ type: number, worldX, worldZ }` | place a building at a world point |

World coordinates: server uses `x` / `y` for the 2D ground plane. Three.js uses `x` / `z` — translation happens only at the render boundary (`position.set(s.x, height, s.y)`).

### Layer responsibilities

| Layer | Owns |
|---|---|
| Server | truth: positions, health, counts, ownership |
| Client | visuals: meshes, prediction, effects, camera, HUD |

The server only updates numbers. The client interprets those numbers as a living world.

## Visual Direction

The current rendering target is a stylized RTS look: simple shapes, bold colors, and readable lighting instead of realistic PBR detail. The working art-direction notes live in [docs/art-style.md](/Users/tim/Code/vibejam/docs/art-style.md).

---

## Direction (not implemented yet)

Aggregate RTS: many **visual** units per blob, **instancing**, local ragdoll/floppy physics, fake arrows and blood — all **client-only**. The server keeps **tens** of entities; the client may show **hundreds** of decorative bodies. **Bandwidth stays small** because only aggregates sync.

Friendly blobs of the same owner and unit type also rebalance on the server as aggregate counters only. Each unit type defines a `targetSize`, `rebalanceThreshold`, and `mergeDistance` in [shared/game-rules.ts](/Users/tim/Code/vibejam/shared/game-rules.ts). When two nearby friendly blobs are close enough and not heavily engaged, the server may rebalance them toward an even split if the move would be meaningful. Newly trained units first try to join a nearby same-type blob that is still below its target size; otherwise they spawn as their own blob. The server never tracks individual soldiers for this.

Next steps when the MVP is stable:

1. Multiple blobs per player (already two at join for testing selection).
2. Active **buildings**.
3. Blob composition (melee / ranged / workers).
4. Resources and obstacles.
5. Local-only visual units and physics.

## Run

Requires **Node 20+** (Colyseus 0.17).

```bash
npm install
npm run dev
```

- **Server:** listens on **2567** by default. HTTP `GET /` returns a short plain-text message; gameplay uses the Colyseus WebSocket endpoint behind that origin.
- **Client:** Vite (usually `http://localhost:5173`). In **development**, the client uses the **`/colyseus` Vite proxy** (see `client/vite.config.ts`) so matchmaking hits the same origin as the page. That avoids **CORS** issues with the SDK’s credentialed `fetch` to `/matchmake`. In production builds, the client uses **`window.location` + `VITE_COLYSEUS_PORT`** (default **2567**).
- **Startup order:** `npm run dev` starts the server and a small **`scripts/wait-for-colyseus.mjs`** loop that opens **Vite only after** Colyseus accepts TCP on **`PORT`** (default **2567**). That avoids Vite proxy `ECONNREFUSED` when the browser opens too early. If you use **`npm run dev:client` alone**, start the server first or expect that error until Colyseus is up.

### “Failed to fetch” in the browser

Usually either the **game server is not running** on the expected port, or a **browser / CORS** problem in dev. This repo proxies **`/colyseus` → Colyseus** during `npm run dev`; use **`npm run dev`** (both processes), not the client alone. If you change the game port, set **`VITE_COLYSEUS_PORT`** (and **`PORT`**) so the Vite proxy target and the client stay aligned:

```bash
PORT=2568 VITE_COLYSEUS_PORT=2568 npm run dev
```

### Port 2567 already in use (`EADDRINUSE`)

Another process—usually a **previous** `npm run dev` / `tsx` that did not exit—is still listening. Free the port, then start again:

```bash
# macOS / Linux: show PID using 2567
lsof -i :2567
# Stop it (replace PID), or:
kill $(lsof -ti:2567)
```

Or run on a **different** port (server + client must match):

```bash
PORT=2568 VITE_COLYSEUS_PORT=2568 npm run dev
```

Or run each side alone:

```bash
npm run dev:server
npm run dev:client
```

Production server (after `npm run build:server`):

```bash
npm start
```

The compiled output under `dist/server` ships a tiny `package.json` with `"type": "commonjs"` so the TypeScript emit loads cleanly under Node while the repo root stays ESM for Vite.

## Controls (MVP)

- **Click** one of **your** blobs (brighter) to select — ring appears.
- **Click** empty ground to move the selected blob toward that point.

Other players’ blobs appear dimmer; you cannot select them.

## Layout (flat, on purpose)

```
server/src/index.ts      # boot
server/src/app.config.ts # defineServer + battle room
server/src/room.ts       # tick, join/leave, messages
server/src/state.ts      # Schema: authoritative shape
server/src/config.ts     # tick rate, world size, speeds

client/src/main.ts
client/src/network.ts
client/src/game.ts
client/src/render.ts
client/index.html
```

No deep `systems/` tree — add files only when they earn their place.

## Tech notes

- Server **Schema** needs `experimentalDecorators` and `useDefineForClassFields: false` (see `tsconfig.server.json`). **`npm run dev:server`** passes that file to `tsx` (`--tsconfig tsconfig.server.json`) so decorators work.
- Client sync is entity-driven through `Game.sync()`: each frame the client reconciles Colyseus room state into client entities, then renders those entities.

---

Keep the architecture **boring on the wire**, **expressive on the GPU**.

### TODO:
 - Villagers gather resources
 - Farms
 - Behavior trees (behavior of all units)
 - Villagers build buildings
 - Buildings can be demolished

 - Build walls.
 - Make trees cuttable and collectable
 - Bows
 - Add water
 - In game text 
 - Music
 - Sounds and voiceover
 - User chat
 - Score per user, realtime leaderboards
 - Nice icons for everything

 Stretch:
  - Ships
  - Show building damage by deteriorating

 Mabye:
 - Map editor
 - Map savefile design
 - Sync map

### Done
 - Give health to buildings
 - Buildings produce units that auto join in blobs
 - Design attack mechanics
 - Villagers join in blobs
 - Make weapons
 - Swing animation
 - Arrows and shooting animation
 - Give proper colors to all buildings and units in an efficient way
 - Health per unit
 - Make terrain more pretty
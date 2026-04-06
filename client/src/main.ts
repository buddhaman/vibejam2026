import { joinBattle, waitForSyncedGameState } from "./network.js";
import { Game } from "./game.js";
import { startRender } from "./render.js";
import { ensureBuildingModelsLoaded } from "./building-model-registry.js";
import { ensurePhalanxUnitModelLoaded } from "./phalanx-unit-model.js";
import { ensureTileVisualAssetsLoaded } from "./tile-visuals.js";

async function boot() {
  const room = await joinBattle();
  // Register Colyseus custom message handlers before any await — the server can broadcast
  // `tile_update` during onJoin (e.g. town-center footprint) while we are still syncing.
  const game = new Game(room);
  await waitForSyncedGameState(room);
  await ensureBuildingModelsLoaded();
  await ensureTileVisualAssetsLoaded();
  await ensurePhalanxUnitModelLoaded();
  await game.streamTiles(); // request chunks sequentially until world is fully loaded
  startRender(game);
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f88;padding:16px">Failed to connect: ${String(
    err?.message ?? err
  )}

Common fixes:
• Free port 2567:  kill $(lsof -ti:2567)
• Or use another port:  PORT=2568 VITE_COLYSEUS_PORT=2568 npm run dev
• Server must be running:  npm run dev:server</pre>`;
});

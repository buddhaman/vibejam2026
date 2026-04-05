import { joinBattle, waitForSyncedGameState } from "./network.js";
import { Game } from "./game.js";
import { startRender } from "./render.js";
import { ensureBuildingModelsLoaded } from "./building-model-registry.js";

async function boot() {
  const room = await joinBattle();
  await waitForSyncedGameState(room);
  await ensureBuildingModelsLoaded();
  const game = new Game(room);
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

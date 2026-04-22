import { joinBattle, waitForSyncedGameState } from "./network.js";
import { Game } from "./game.js";
import { startRender } from "./render.js";
import { ensureBuildingModelsLoaded } from "./building-model-registry.js";
import { ensureUnitInstancedModelsLoaded } from "./unit-instanced-models.js";
import { ensureTileVisualAssetsLoaded } from "./tile-visuals.js";

function createBootShell() {
  const shell = document.createElement("div");
  shell.style.cssText = [
    "position:fixed",
    "inset:0",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "background:radial-gradient(circle at 50% 35%, rgba(38,84,155,0.18), rgba(7,14,27,0.96))",
    "z-index:1000",
    "font-family:system-ui,sans-serif",
    "color:#f2edd7",
  ].join(";");
  shell.innerHTML = `
    <div style="width:min(420px, calc(100vw - 40px));padding:24px 22px;border:1px solid rgba(201,145,30,0.35);border-radius:18px;background:rgba(10,18,34,0.72);box-shadow:0 20px 60px rgba(0,0,0,0.35);backdrop-filter:blur(10px);">
      <div style="font:700 24px Cinzel,serif;letter-spacing:0.08em;color:#f0c060;margin-bottom:8px;">AGI of Mythology</div>
      <div style="font-size:14px;line-height:1.5;color:rgba(242,237,215,0.72);">Joining battle...</div>
    </div>
  `;
  document.body.appendChild(shell);
  const status = shell.querySelector("div div:nth-child(2)") as HTMLDivElement | null;
  return {
    setStatus(text: string) {
      if (status) status.textContent = text;
    },
    remove() {
      shell.remove();
    },
  };
}

async function boot() {
  const shell = createBootShell();
  shell.setStatus("Connecting to the server...");
  const room = await joinBattle();
  // Register Colyseus custom message handlers before any await — the server can broadcast
  // `tile_update` during onJoin (e.g. town-center footprint) while we are still syncing.
  const game = new Game(room);
  shell.setStatus("Syncing your match...");
  await waitForSyncedGameState(room);
  shell.setStatus("Loading world...");
  const buildingModelsPromise = ensureBuildingModelsLoaded().catch((err) => {
    console.warn("[boot] building models failed to load", err);
  });
  const tileVisualsPromise = ensureTileVisualAssetsLoaded().catch((err) => {
    console.warn("[boot] tile visuals failed to load", err);
  });
  const unitModelsPromise = ensureUnitInstancedModelsLoaded().catch((err) => {
    console.warn("[boot] unit models failed to load", err);
  });
  await game.streamTiles();
  startRender(game);
  shell.remove();
  void Promise.all([buildingModelsPromise, tileVisualsPromise, unitModelsPromise]);
}

boot().catch((err) => {
  console.error(err);
  const message = String(err?.message ?? err);
  const extra =
    /out of date|latest build|refresh/i.test(message)
      ? "\n\nRefresh this page to load the latest release."
      : "";
  document.body.innerHTML = `<pre style="color:#f88;padding:16px">Failed to connect: ${String(
    message
  )}${extra}

Common fixes:
• Free port 2567:  kill $(lsof -ti:2567)
• Or use another port:  PORT=2568 VITE_COLYSEUS_PORT=2568 npm run dev
• Server must be running:  npm run dev:server</pre>`;
});

import { joinBattle, waitForSyncedGameState } from "./network.js";
import { Game } from "./game.js";
import { startRender } from "./render.js";
import { ensureBuildingModelsLoaded } from "./building-model-registry.js";
import { ensureUnitInstancedModelsLoaded } from "./unit-instanced-models.js";
import { ensureTileVisualAssetsLoaded } from "./tile-visuals.js";
import { initProfiling, profileMark, profileMeasure, profileMeasureAsync } from "./profile.js";

const bootStart = performance.now();

function bootLog(label: string, extra?: Record<string, unknown>): void {
  const elapsedMs = Math.round(performance.now() - bootStart);
  console.info(`[boot] ${label} at ${elapsedMs}ms`, extra ?? "");
}

function tameVibeJamWidget(): void {
  const apply = () => {
    const candidates = Array.from(document.body.querySelectorAll<HTMLElement>(
      'iframe[src*="vibej.am"], [id*="vibe" i], [class*="vibe" i]'
    ));
    for (const el of candidates) {
      if (el === document.body) continue;
      el.style.setProperty("transform", "scale(0.72)", "important");
      el.style.setProperty("transform-origin", "right bottom", "important");
      el.style.setProperty("z-index", "8", "important");
    }
  };
  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}

async function boot() {
  initProfiling();
  bootLog("script started");
  profileMark("boot script started");
  tameVibeJamWidget();
  const joinStart = performance.now();
  const room = await profileMeasureAsync("startup joinBattle", () => joinBattle());
  bootLog("joined room", { ms: Math.round(performance.now() - joinStart) });
  // Register Colyseus custom message handlers before any await — the server can broadcast
  // `tile_update` during onJoin (e.g. town-center footprint) while we are still syncing.
  const game = new Game(room);
  const stateStart = performance.now();
  await profileMeasureAsync("startup waitForSyncedGameState", () => waitForSyncedGameState(room));
  bootLog("state synced", { ms: Math.round(performance.now() - stateStart) });
  const spawnChunkStart = performance.now();
  await profileMeasureAsync("startup streamSpawnChunks", () => game.streamSpawnChunks());
  bootLog("spawn chunks ready", { ms: Math.round(performance.now() - spawnChunkStart) });
  profileMeasure("startup startRender", () => {
    startRender(game);
  });
  bootLog("first render started");
  void game.streamRemainingChunks().catch((err) => console.warn("[boot] background chunk streaming failed", err));
  window.setTimeout(() => {
    const unitStart = performance.now();
    const unitModelsPromise = profileMeasureAsync("startup unit models", () => ensureUnitInstancedModelsLoaded()).catch((err) => {
      console.warn("[boot] unit models failed to load", err);
    }).then(() => {
      bootLog("unit models ready", { ms: Math.round(performance.now() - unitStart) });
    });
    const buildingStart = performance.now();
    const buildingModelsPromise = profileMeasureAsync("startup building models", () => ensureBuildingModelsLoaded()).catch((err) => {
      console.warn("[boot] building models failed to load", err);
    }).then(() => {
      bootLog("building models ready", { ms: Math.round(performance.now() - buildingStart) });
    });
    const tileVisualStart = performance.now();
    const tileVisualsPromise = profileMeasureAsync("startup tile visual assets", () => ensureTileVisualAssetsLoaded()).catch((err) => {
      console.warn("[boot] tile visuals failed to load", err);
    }).then(() => {
      bootLog("tile visuals ready", { ms: Math.round(performance.now() - tileVisualStart) });
    });
    void Promise.all([unitModelsPromise, buildingModelsPromise, tileVisualsPromise]);
  }, 0);
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

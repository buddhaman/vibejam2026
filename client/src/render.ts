import * as THREE from "three";
import { BuildingType, UnitType, snapWorldToTileCenter } from "../../shared/game-rules.js";
import { AttackTargetType } from "../../shared/protocol.js";
import type { Game } from "./game.js";
import { BlobEntity } from "./blob-entity.js";
import { BuildingEntity } from "./building-entity.js";
import {
  addMoveMarker,
  createHudCanvas,
  createHudState,
  drawHUD,
  drawFloatingResourceTexts,
  hitTestDeselect,
  hitTestMenu,
  hitTestSelectionAction,
  showWarning,
} from "./hud.js";
import type { SelectionInfo } from "./entity.js";
import { type TileView } from "./terrain.js";
import { attachDevNetworkPerf } from "./network-perf.js";
import { drawTileDebugPanel } from "./tile-debug.js";
import { drawDevOverlay } from "./dev-overlay.js";
import { CAMERA_CONFIG, createInitialFrameStats, createRenderWorld } from "./render-world.js";
import { projectFloatingResourceTexts } from "./world-text.js";

const WALKABILITY_DEBUG_KEY = "KeyV";
const TILE_DEBUG_KEY = "Backquote"; // ` key toggles developer mode too
const DEV_MODE_KEY = "KeyG";
const DESKTOP_RENDER_HZ = 60;
const MOBILE_RENDER_HZ = 30;

export function startRender(game: Game) {
  const netPerf = attachDevNetworkPerf(game.room);
  const world = createRenderWorld(game);
  const { scene } = game;
  const { renderer, canvas, cameraRig, walkabilityOverlay, tileDebug, tileVisuals, buildingDestructionFx, beamDrawer, brightBeamDrawer, sunLight } = world;
  const camera = cameraRig.camera;
  let tileDebugInspected: TileView | null = null;
  let devModeVisible = false;
  let frameStats = createInitialFrameStats();

  function onCameraKeyDown(e: KeyboardEvent) {
    if (e.code === TILE_DEBUG_KEY || (e.shiftKey && e.code === DEV_MODE_KEY)) {
      devModeVisible = !devModeVisible;
      tileDebug.root.visible = devModeVisible;
      if (!devModeVisible) {
        tileDebugInspected = null;
        tileDebug.clearInspect();
      }
      walkabilityOverlayVisible = devModeVisible;
      walkabilityOverlay.visible = walkabilityOverlayVisible;
      world.syncWalkabilityOverlay(walkabilityOverlayVisible, true);
      e.preventDefault();
      return;
    }
    if (e.code === WALKABILITY_DEBUG_KEY && devModeVisible) {
      walkabilityOverlayVisible = !walkabilityOverlayVisible;
      walkabilityOverlay.visible = walkabilityOverlayVisible;
      world.syncWalkabilityOverlay(walkabilityOverlayVisible, true);
      e.preventDefault();
      return;
    }
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      cameraRig.arrowKeysHeld.add(e.key);
      e.preventDefault();
    }
  }

  function onCameraKeyUp(e: KeyboardEvent) {
    cameraRig.arrowKeysHeld.delete(e.key);
  }

  window.addEventListener("keydown", onCameraKeyDown);
  window.addEventListener("keyup", onCameraKeyUp);

  const raycaster = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const terrainHits: THREE.Intersection<THREE.Object3D>[] = [];
  let walkabilityOverlayVisible = false;

  const hudCanvas = createHudCanvas();
  const hud = createHudState();
  const DRAG_THRESHOLD = 5;

  let drag: { startX: number; startY: number; prevX: number; prevY: number; moved: boolean } | null = null;
  let lastGroundTap = { t: 0, x: 0, y: 0, wx: 0, wz: 0 };
  /** Second tap within this window + distance → build menu (never blocked by move). */
  const DOUBLE_MS = 450;
  const DOUBLE_SCREEN_PX = 36;
  const DOUBLE_WORLD = 22;
  /** Move is issued only after this delay so a double-tap can cancel it and open build. */
  const MOVE_DELAY_MS = 280;

  let pendingMoveTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingMove() {
    if (pendingMoveTimer !== null) {
      clearTimeout(pendingMoveTimer);
      pendingMoveTimer = null;
    }
  }

  function groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
    ndcV.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndcV, camera);
    terrainHits.length = 0;
    raycaster.intersectObject(world.terrain, false, terrainHits);
    for (const terrainHit of terrainHits) {
      if (terrainHit.face) return terrainHit.point.clone();
    }
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit.clone() : null;
  }

  function panCamera(fromX: number, fromY: number, toX: number, toY: number) {
    const from = groundHit(fromX, fromY);
    const to = groundHit(toX, toY);
    if (!from || !to) return;
    cameraRig.lookTarget.x += from.x - to.x;
    cameraRig.lookTarget.z += from.z - to.z;
    cameraRig.placeCamera();
  }

  function deselect() {
    cancelPendingMove();
    game.clearSelection();
    hud.buildMenu.visible = false;
  }

  function getMoveBlockedMessage(tile: TileView | null): string {
    if (!tile) return "Units can't walk there";
    if (tile.isMountain) return "Units can't walk on mountains";
    return "Units can't walk through blocked tiles";
  }

  function getBuildBlockedMessage(tile: TileView | null): string {
    if (!tile) return "Can't build there";
    if (tile.isMountain) return "Can't build on mountains";
    return "Can't build on blocked tiles";
  }

  function handleClick(clientX: number, clientY: number) {
    // In tile debug mode, clicks select a tile for inspection instead of normal game actions.
    if (devModeVisible) {
      const point = groundHit(clientX, clientY);
      if (point) {
        const tile = game.getTileAtWorld(point.x, point.z) ?? null;
        tileDebugInspected = tile;
        tileDebug.inspectTile(tile, game.getTiles());
      }
      return;
    }

    const selectedInfo = game.getSelectedEntity()?.getSelectionInfo() ?? null;

    if (hitTestDeselect(clientX, clientY, game.selectedEntityId !== null)) {
      deselect();
      return;
    }

    const selectionAction = hitTestSelectionAction(clientX, clientY, selectedInfo);
    if (selectionAction !== null) {
      cancelPendingMove();
      game.runSelectionAction(selectionAction);
      return;
    }

    const menuAction = hitTestMenu(hud, clientX, clientY);
    if (menuAction !== null) {
      cancelPendingMove();
      if (menuAction !== "dismiss") {
        const tile = game.getTileAtWorld(hud.buildMenu.worldX, hud.buildMenu.worldZ);
        if (!tile?.canBuild) {
          showWarning(hud, getBuildBlockedMessage(tile), performance.now() / 1000);
        } else {
          game.sendBuildIntent(menuAction, hud.buildMenu.worldX, hud.buildMenu.worldZ);
        }
      }
      hud.buildMenu.visible = false;
      return;
    }
    if (hud.buildMenu.visible) {
      cancelPendingMove();
      hud.buildMenu.visible = false;
      return;
    }

    ndcV.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndcV, camera);
    const point = groundHit(clientX, clientY);
    const ownedPointPicked = point ? game.pickOwnedEntity(point.x, point.z) : null;
    const pointPicked = point ? game.pickEntityAtWorldPoint(point.x, point.z) : null;
    const selectedBlob = game.getSelectedMyBlobEntity();
    const attackPicked =
      game.pickAttackableEntityFromRay(raycaster, { enemyOnly: true }) ??
      (point ? game.pickAttackableEntityAtWorldPoint(point.x, point.z, { enemyOnly: true }) : null);
    if (selectedBlob && attackPicked) {
      cancelPendingMove();
      game.sendAttackIntent(
        selectedBlob.id,
        attackPicked instanceof BlobEntity ? AttackTargetType.BLOB : AttackTargetType.BUILDING,
        attackPicked.id
      );
      lastGroundTap.t = 0;
      return;
    }

    const picked =
      game.pickOwnedEntityFromRay(raycaster) ??
      ownedPointPicked ??
      game.pickEntityFromRay(raycaster) ??
      pointPicked;
    if (picked) {
      cancelPendingMove();
      if (
        selectedBlob &&
        picked.isOwnedByMe() &&
        picked instanceof BuildingEntity &&
        picked.getBuildingType() === BuildingType.FARM &&
        selectedBlob.getUnitType() === UnitType.VILLAGER
      ) {
        game.sendGatherBuildingIntent(selectedBlob.id, picked.id);
        lastGroundTap.t = 0;
        return;
      }
      if (selectedBlob && !picked.isOwnedByMe() && (picked instanceof BlobEntity || picked instanceof BuildingEntity)) {
        game.sendAttackIntent(
          selectedBlob.id,
          picked instanceof BlobEntity ? AttackTargetType.BLOB : AttackTargetType.BUILDING,
          picked.id
        );
        lastGroundTap.t = 0;
        return;
      }
      game.toggleSelection(picked.id);
      lastGroundTap.t = 0;
      return;
    }

    if (!point) return;

    const now = performance.now();

    if (game.getSelectedMyBlobEntity()) {
      cancelPendingMove();
      const tx = point.x;
      const tz = point.z;
      const sx = clientX;
      const sy = clientY;
      const selectedBlob = game.getSelectedMyBlobEntity();
      const tile = game.getTileAtWorld(tx, tz);
      if (
        selectedBlob &&
        selectedBlob.getUnitType() === UnitType.VILLAGER &&
        tile &&
        (tile.material > 0 || tile.compute > 0)
      ) {
        game.sendGatherIntent(selectedBlob.id, tile.key);
        addMoveMarker(hud, sx, sy, performance.now() / 1000);
        return;
      }
      pendingMoveTimer = setTimeout(() => {
        pendingMoveTimer = null;
        const moveTile = game.getTileAtWorld(tx, tz);
        if (!moveTile?.canWalk) {
          showWarning(hud, getMoveBlockedMessage(moveTile), performance.now() / 1000);
          return;
        }
        game.sendMoveIntent(tx, tz);
        addMoveMarker(hud, sx, sy, performance.now() / 1000);
      }, MOVE_DELAY_MS);
      lastGroundTap = { t: now, x: clientX, y: clientY, wx: point.x, wz: point.z };
      return;
    }

    const dtMs = now - lastGroundTap.t;
    const dScr = Math.hypot(clientX - lastGroundTap.x, clientY - lastGroundTap.y);
    const dW = Math.hypot(point.x - lastGroundTap.wx, point.z - lastGroundTap.wz);
    const isDouble =
      lastGroundTap.t > 0 &&
      dtMs < DOUBLE_MS &&
      dtMs > 30 &&
      dScr < DOUBLE_SCREEN_PX &&
      dW < DOUBLE_WORLD;

    if (isDouble) {
      cancelPendingMove();
      game.clearSelection();
      const snapped = snapWorldToTileCenter(point.x, point.z);
      const tile = game.getTileAtWorld(snapped.x, snapped.z);
      if (!tile?.canBuild) {
        showWarning(hud, getBuildBlockedMessage(tile), now / 1000);
        lastGroundTap.t = 0;
        return;
      }
      hud.buildMenu = { visible: true, screenX: clientX, screenY: clientY, worldX: snapped.x, worldZ: snapped.z };
      lastGroundTap.t = 0;
      return;
    }

    lastGroundTap = { t: now, x: clientX, y: clientY, wx: point.x, wz: point.z };

    const tile = game.getTileAtWorld(point.x, point.z);
    game.selectTile(tile?.key ?? null);
  }

  function handleSecondaryClick(clientX: number, clientY: number) {
    cancelPendingMove();
    ndcV.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndcV, camera);
    const point = groundHit(clientX, clientY);
    const selectedBlob = game.getSelectedMyBlobEntity();
    if (!selectedBlob) return;

    const attackPicked =
      game.pickAttackableEntityFromRay(raycaster, { enemyOnly: true }) ??
      (point ? game.pickAttackableEntityAtWorldPoint(point.x, point.z, { enemyOnly: true }) : null);
    if (!attackPicked) return;

    game.sendAttackIntent(
      selectedBlob.id,
      attackPicked instanceof BlobEntity ? AttackTargetType.BLOB : AttackTargetType.BUILDING,
      attackPicked.id
    );
    lastGroundTap.t = 0;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    drag = { startX: ev.clientX, startY: ev.clientY, prevX: ev.clientX, prevY: ev.clientY, moved: false };
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      cancelPendingMove();
      game.clearSelection();
      hud.buildMenu.visible = false;
    }
    if (drag.moved) panCamera(drag.prevX, drag.prevY, ev.clientX, ev.clientY);
    drag.prevX = ev.clientX;
    drag.prevY = ev.clientY;
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (!drag) return;
    if (!drag.moved) {
      if (ev.button === 2) handleSecondaryClick(ev.clientX, ev.clientY);
      else handleClick(ev.clientX, ev.clientY);
    }
    canvas.releasePointerCapture(ev.pointerId);
    drag = null;
  });

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
  });

  canvas.addEventListener("pointercancel", (ev) => {
    canvas.releasePointerCapture(ev.pointerId);
    drag = null;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cameraRig.zoom(e.deltaY);
    },
    { passive: false }
  );

  window.addEventListener("resize", () => {
    cameraRig.resize(window.innerWidth, window.innerHeight);
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const prefersCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const isTouchDevice = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const isMobileLike = prefersCoarsePointer || isTouchDevice;
  const targetRenderHz = isMobileLike ? MOBILE_RENDER_HZ : DESKTOP_RENDER_HZ;
  const targetFrameMs = 1000 / targetRenderHz;
  let lastFrameTime = performance.now();
  let lastRenderTime = lastFrameTime;

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    if (now - lastRenderTime < targetFrameMs) return;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    lastRenderTime = now;
    cameraRig.applyArrowKeys(dt);
    const perfSync0 = performance.now();
    game.sync();
    const perfSync1 = performance.now();
    game.clearBeamDraws();
    if (game.consumeTerrainDirty()) {
      world.rebuildTerrain();
    }

    const perfTile0 = performance.now();
    tileVisuals.sync(game);
    const perfTile1 = performance.now();
    if (devModeVisible) tileDebug.refresh(game.getTilesOrdered(), game.getTiles());
    const perf0 = performance.now();
    world.syncWalkabilityOverlay(walkabilityOverlayVisible);
    game.setOrbitCameraForFrame(cameraRig.distance, CAMERA_CONFIG.distanceMin, CAMERA_CONFIG.distanceMax);
    game.updateRagdollFx(dt);
    game.updateArrowFx(dt);
    buildingDestructionFx.update(dt, game.getTiles());
    const perf1 = performance.now();
    for (const entity of game.entities) entity.render(dt);
    const perf2 = performance.now();
    game.flushBeamDraws();
    const perf3 = performance.now();
    sunLight.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const perf4 = performance.now();
    frameStats = {
      fps: dt > 0 ? 1 / dt : 0,
      ms: dt * 1000,
      totalWorkMs: perf4 - perfSync0,
      idleBudgetMs: dt * 1000 - (perf4 - perfSync0),
      syncMs: perfSync1 - perfSync0,
      tileVisualsMs: perfTile1 - perfTile0,
      entityRenderMs: perf2 - perf1,
      beamFlushMs: perf3 - perf2,
      sceneRenderMs: perf4 - perf3,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.programs?.length ?? 0,
      entities: game.entities.length,
      beamBuckets: beamDrawer.getBucketCount() + brightBeamDrawer.getBucketCount(),
    };

    const myColor = game.getPlayerColor(game.room.sessionId);
    const mySquadCount = game.getMySquadCount();
    const myResources = game.getMyResources();
    const selectedInfo: SelectionInfo | null = game.getSelectedEntity()?.getSelectionInfo() ?? null;
    const selectedTile: TileView | null = game.getSelectedTile();

    drawHUD(hudCanvas, hud, myColor, mySquadCount, myResources, selectedInfo, selectedTile, now / 1000);
    drawFloatingResourceTexts(hudCanvas, projectFloatingResourceTexts(game, camera, hudCanvas, now / 1000));

    if (devModeVisible) {
      const ctx = hudCanvas.getContext("2d")!;
      drawDevOverlay(ctx, renderer, frameStats, netPerf.getSnapshot(), {
        tileDebug: tileDebugInspected !== null,
        walkability: walkabilityOverlayVisible,
      });
      if (tileDebugInspected) {
        drawTileDebugPanel(ctx, tileDebugInspected, hudCanvas.width, hudCanvas.height);
      }
    }

    netPerf.tick(now);
  }

  tick();
}

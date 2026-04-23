import * as THREE from "three";
import { BuildingType, GAME_RULES, UnitType, snapWorldToTileCenter } from "../../shared/game-rules.js";
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
  drawVictoryOverlay,
  hitTestContextBar,
  hitTestContextBuildAction,
  hitTestContextCancel,
  hitTestContextSelectionAction,
  getHudBottomInset,
  showWarning,
  type KothState,
} from "./hud.js";
import type { SelectionInfo } from "./entity.js";
import { getTerrainHeightAt, type TileView } from "./terrain.js";
import { attachDevNetworkPerf } from "./network-perf.js";
import { drawTileDebugPanel } from "./tile-debug.js";
import { drawDevOverlay } from "./dev-overlay.js";
import { CAMERA_CONFIG, createInitialFrameStats, createRenderWorld } from "./render-world.js";
import { projectFloatingResourceTexts } from "./world-text.js";
import { createChatUi } from "./chat-ui.js";

const WALKABILITY_DEBUG_KEY = "KeyV";
const TILE_DEBUG_KEY = "Backquote"; // ` key toggles developer mode too
const DEV_MODE_KEY = "KeyG";
const DESKTOP_RENDER_HZ = 60;
const MOBILE_RENDER_HZ = 30;

export function startRender(game: Game) {
  const netPerf = attachDevNetworkPerf(game.room);
  const world = createRenderWorld(game);
  const { scene } = game;
  const { renderer, canvas, cameraRig, walkabilityOverlay, tileDebug, chunkDebug, tileVisuals, buildingDestructionFx, beamDrawer, brightBeamDrawer, sunLight, centralServer } = world;
  const camera = cameraRig.camera;
  let tileDebugInspected: TileView | null = null;
  let devModeVisible = false;
  let frameStats = createInitialFrameStats();

  function onCameraKeyDown(e: KeyboardEvent) {
    if (e.code === TILE_DEBUG_KEY || (e.shiftKey && e.code === DEV_MODE_KEY)) {
      devModeVisible = !devModeVisible;
      tileDebug.root.visible = devModeVisible;
      chunkDebug.root.visible = devModeVisible;
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

  // Ghost preview mesh for build placement mode
  const GHOST_HALF_H = 3.5;
  const ghostGeometry = new THREE.BoxGeometry(
    GAME_RULES.TILE_SIZE * 0.88,
    GHOST_HALF_H * 2,
    GAME_RULES.TILE_SIZE * 0.88
  );
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x44ff88,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const ghostMesh = new THREE.Mesh(ghostGeometry, ghostMaterial);
  ghostMesh.visible = false;
  scene.add(ghostMesh);

  const hudCanvas = createHudCanvas();
  const hud = createHudState();
  const chatUi = createChatUi(game, getHudBottomInset);
  const DRAG_THRESHOLD = 8; // slightly larger on touch
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_PX = 16;
  let lastTap: { x: number; y: number; t: number } | null = null;
  let buildAnchorWorld: { x: number; z: number } | null = null;

  // ── Victory state ────────────────────────────────────────────────────────────
  let victoryState: { name: string; color: number; isMe: boolean; startT: number } | null = null;
  let observedRoundResetCount = game.getRoundResetCount();

  function resetViewForNewRound(): void {
    const myTownCenter = game.getMyTownCenterPosition();
    cameraRig.lookTarget.set(myTownCenter?.x ?? 0, 0, myTownCenter?.z ?? 0);
    cameraRig.distance = CAMERA_CONFIG.distanceStart;
    cameraRig.polarFromDownDeg = CAMERA_CONFIG.polarFromDownDeg;
    cameraRig.azimuthDeg = CAMERA_CONFIG.azimuthDeg;
    cameraRig.arrowKeysHeld.clear();
    cameraRig.placeCamera();
    hud.buildPanelOpen = false;
    hud.activeBuildType = null;
    hud.buildAnchorTileKey = null;
    buildAnchorWorld = null;
    game.clearSelection();
  }

  function triggerVictoryExplosions(winnerSessionId: string) {
    const snapshots = game.getBuildingSnapshots();
    let delay = 0;
    for (const snapshot of snapshots.values()) {
      if (snapshot.ownerId === winnerSessionId) continue;
      const capturedDelay = delay;
      setTimeout(() => {
        buildingDestructionFx.spawn({
          x: snapshot.x,
          z: snapshot.y,
          buildingType: snapshot.buildingType,
          teamColor: game.getPlayerColor(snapshot.ownerId),
          tiles: game.getTiles(),
        });
      }, capturedDelay);
      delay += 60 + Math.random() * 100;
    }
    // Central server mega-explosion — cluster of blasts
    const serverDelay = Math.max(delay * 0.4, 800);
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        buildingDestructionFx.spawn({
          x: (Math.random() - 0.5) * 14,
          z: (Math.random() - 0.5) * 14,
          buildingType: BuildingType.TOWN_CENTER,
          teamColor: 0xffffff,
          tiles: game.getTiles(),
        });
      }, serverDelay + i * 260);
    }
    // Hide the central server model when it explodes
    setTimeout(() => { centralServer.root.visible = false; }, serverDelay + 400);
  }

  // ── Multi-touch pointer tracking ─────────────────────────────────────────────
  type PointerPos = { x: number; y: number };
  const activePointers = new Map<number, PointerPos>();

  /** Single-finger drag state (pan + tap discrimination). */
  let singleDrag: { startX: number; startY: number; prevX: number; prevY: number; moved: boolean } | null = null;
  /** Previous two-finger snapshot for delta computation. */
  let prevTwoFinger: { dist: number; cx: number; cy: number; angle: number } | null = null;
  /** True once two fingers were ever active this gesture — suppresses tap on finger-lift. */
  let hadTwoFingers = false;

  function getTwoFingerState(): { dist: number; cx: number; cy: number; angle: number } | null {
    if (activePointers.size !== 2) return null;
    const [a, b] = [...activePointers.values()] as [PointerPos, PointerPos];
    return {
      dist:  Math.hypot(b.x - a.x, b.y - a.y),
      cx:    (a.x + b.x) * 0.5,
      cy:    (a.y + b.y) * 0.5,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
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

    if (hitTestContextCancel(clientX, clientY)) {
      hud.buildPanelOpen = false;
      hud.activeBuildType = null;
      hud.buildAnchorTileKey = null;
      buildAnchorWorld = null;
      ghostMesh.visible = false;
      game.clearSelection();
      return;
    }

    if (hud.buildPanelOpen) {
      const buildType = hitTestContextBuildAction(clientX, clientY, true);
      if (buildType !== null) {
        const anchor = buildAnchorWorld;
        const tile = anchor ? game.getTileAtWorld(anchor.x, anchor.z) : null;
        if (!anchor || !tile?.canBuild) {
          showWarning(hud, getBuildBlockedMessage(tile), performance.now() / 1000);
        } else {
          game.sendBuildIntent(buildType, anchor.x, anchor.z);
          hud.buildPanelOpen = false;
          hud.activeBuildType = null;
          hud.buildAnchorTileKey = null;
          buildAnchorWorld = null;
          ghostMesh.visible = false;
        }
        return;
      }
      if (hitTestContextBar(clientX, clientY)) return;
      hud.buildPanelOpen = false;
      hud.activeBuildType = null;
      hud.buildAnchorTileKey = null;
      buildAnchorWorld = null;
      ghostMesh.visible = false;
      return;
    }

    const selectionAction = hitTestContextSelectionAction(clientX, clientY, selectedInfo);
    if (selectionAction !== null) {
      game.runSelectionAction(selectionAction);
      return;
    }
    if (hitTestContextBar(clientX, clientY)) return;

    // World picking
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
      game.sendAttackIntent(
        selectedBlob.id,
        attackPicked instanceof BlobEntity ? AttackTargetType.BLOB : AttackTargetType.BUILDING,
        attackPicked.id
      );
      return;
    }

    const picked =
      game.pickOwnedEntityFromRay(raycaster) ??
      ownedPointPicked ??
      game.pickEntityFromRay(raycaster) ??
      pointPicked;

    if (picked) {
      if (
        selectedBlob &&
        picked.isOwnedByMe() &&
        picked instanceof BuildingEntity &&
        picked.getBuildingType() === BuildingType.FARM &&
        selectedBlob.getUnitType() === UnitType.VILLAGER
      ) {
        game.sendGatherBuildingIntent(selectedBlob.id, picked.id);
        return;
      }
      if (selectedBlob && !picked.isOwnedByMe() && (picked instanceof BlobEntity || picked instanceof BuildingEntity)) {
        game.sendAttackIntent(
          selectedBlob.id,
          picked instanceof BlobEntity ? AttackTargetType.BLOB : AttackTargetType.BUILDING,
          picked.id
        );
        return;
      }
      if (game.getSelectedEntity()?.id !== picked.id) game.toggleSelection(picked.id);
      return;
    }

    if (!point) return;

    // 7. Movement or gather when own blob is selected — instant, no delay
    if (selectedBlob) {
      const tile = game.getTileAtWorld(point.x, point.z);
      if (
        selectedBlob.getUnitType() === UnitType.VILLAGER &&
        tile &&
        (tile.material > 0 || tile.compute > 0)
      ) {
        game.sendGatherIntent(selectedBlob.id, tile.key);
        addMoveMarker(hud, clientX, clientY, performance.now() / 1000);
        return;
      }
      if (!tile?.canWalk) {
        showWarning(hud, getMoveBlockedMessage(tile), performance.now() / 1000);
        return;
      }
      game.sendMoveIntent(point.x, point.z);
      addMoveMarker(hud, clientX, clientY, performance.now() / 1000);
      return;
    }

    // 8. Enemy/neutral selected + tap ground → deselect
    const selectedEntity = game.getSelectedEntity();
    if (selectedEntity && !selectedEntity.isOwnedByMe()) {
      game.clearSelection();
      return;
    }

    // 9. Select terrain tile for info
    const tile = game.getTileAtWorld(point.x, point.z);
    game.selectTile(tile?.key ?? null);
  }

  function handleSecondaryClick(clientX: number, clientY: number) {
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
  }

  function tryOpenBuildContext(clientX: number, clientY: number): boolean {
    if (game.getSelectedMyBlobEntity()) return false;
    ndcV.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndcV, camera);
    const point = groundHit(clientX, clientY);
    if (!point) return false;
    const entity =
      game.pickOwnedEntityFromRay(raycaster) ??
      game.pickEntityFromRay(raycaster) ??
      game.pickEntityAtWorldPoint(point.x, point.z);
    if (entity) return false;
    const snapped = snapWorldToTileCenter(point.x, point.z);
    const tile = game.getTileAtWorld(snapped.x, snapped.z);
    if (!tile?.canBuild) {
      showWarning(hud, getBuildBlockedMessage(tile), performance.now() / 1000);
      return true;
    }
    hud.buildPanelOpen = true;
    hud.activeBuildType = null;
    hud.buildAnchorTileKey = tile.key;
    buildAnchorWorld = { x: snapped.x, z: snapped.z };
    game.selectTile(tile.key);
    ghostMaterial.color.setHex(0x44ff88);
    ghostMesh.position.set(
      snapped.x,
      getTerrainHeightAt(snapped.x, snapped.z, game.getTiles()) + GHOST_HALF_H,
      snapped.z
    );
    ghostMesh.visible = true;
    return true;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (activePointers.size === 1) {
      // First finger down — start a potential tap / single-finger pan
      singleDrag = { startX: ev.clientX, startY: ev.clientY, prevX: ev.clientX, prevY: ev.clientY, moved: false };
      hadTwoFingers = false;
    } else if (activePointers.size === 2) {
      // Second finger joined — cancel single-finger drag, enter two-finger gesture
      hadTwoFingers = true;
      singleDrag = null;
      prevTwoFinger = getTwoFingerState();
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    const ptr = activePointers.get(ev.pointerId);
    if (!ptr) return;
    ptr.x = ev.clientX;
    ptr.y = ev.clientY;

    if (activePointers.size >= 2) {
      // ── Two-finger gesture: pinch zoom + pan + twist rotate ────────────────
      const curr = getTwoFingerState();
      if (!curr || !prevTwoFinger) { prevTwoFinger = curr; return; }

      // Pinch → zoom (ratio of distance change drives distance)
      if (prevTwoFinger.dist > 1 && curr.dist > 1) {
        cameraRig.distance = THREE.MathUtils.clamp(
          cameraRig.distance * (prevTwoFinger.dist / curr.dist),
          CAMERA_CONFIG.distanceMin,
          CAMERA_CONFIG.distanceMax
        );
      }

      // Center movement → pan
      panCamera(prevTwoFinger.cx, prevTwoFinger.cy, curr.cx, curr.cy);

      // Twist → azimuth rotation (wrap angle delta to [-π, π])
      if (prevTwoFinger.dist > 20 && curr.dist > 20) {
        let dAngle = curr.angle - prevTwoFinger.angle;
        if (dAngle > Math.PI)  dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        cameraRig.azimuthDeg += dAngle * (180 / Math.PI);
      }

      cameraRig.placeCamera();
      prevTwoFinger = curr;
      return;
    }

    // ── Single-finger ghost preview ─────────────────────────────────────────
    if ((hud.activeBuildType !== null || hud.buildPanelOpen) && !(singleDrag?.moved)) {
      const previewPoint = hud.buildPanelOpen && buildAnchorWorld ? buildAnchorWorld : groundHit(ev.clientX, ev.clientY);
      if (previewPoint) {
        const snapped = snapWorldToTileCenter(previewPoint.x, previewPoint.z);
        const gTile = game.getTileAtWorld(snapped.x, snapped.z);
        ghostMaterial.color.setHex(gTile?.canBuild ? 0x44ff88 : 0xff4455);
        ghostMesh.position.set(
          snapped.x,
          getTerrainHeightAt(snapped.x, snapped.z, game.getTiles()) + GHOST_HALF_H,
          snapped.z
        );
        ghostMesh.visible = true;
      } else {
        ghostMesh.visible = false;
      }
    } else if (singleDrag?.moved) {
      ghostMesh.visible = false;
    }

    // ── Single-finger pan ───────────────────────────────────────────────────
    if (!singleDrag) return;
    const dx = ev.clientX - singleDrag.startX;
    const dy = ev.clientY - singleDrag.startY;
    if (!singleDrag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      singleDrag.moved = true;
      hud.buildPanelOpen = false;
      hud.buildAnchorTileKey = null;
      buildAnchorWorld = null;
    }
    if (singleDrag.moved) panCamera(singleDrag.prevX, singleDrag.prevY, ev.clientX, ev.clientY);
    singleDrag.prevX = ev.clientX;
    singleDrag.prevY = ev.clientY;
  });

  canvas.addEventListener("pointerup", (ev) => {
    canvas.releasePointerCapture(ev.pointerId);
    activePointers.delete(ev.pointerId);

    if (activePointers.size < 2) prevTwoFinger = null;

    if (activePointers.size === 0) {
      // All fingers lifted — fire tap only if this was a clean single-finger tap
      if (!hadTwoFingers && singleDrag && !singleDrag.moved) {
        const now = performance.now();
        if (hitTestContextBar(ev.clientX, ev.clientY)) {
          if (ev.button !== 2) handleClick(ev.clientX, ev.clientY);
          lastTap = null;
          singleDrag = null;
          hadTwoFingers = false;
          return;
        }
        const isDoubleTap =
          ev.button !== 2 &&
          lastTap !== null &&
          now - lastTap.t <= DOUBLE_TAP_MS &&
          Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) <= DOUBLE_TAP_PX;
        if (isDoubleTap && tryOpenBuildContext(ev.clientX, ev.clientY)) {
          lastTap = null;
        } else {
          if (ev.button === 2) handleSecondaryClick(ev.clientX, ev.clientY);
          else handleClick(ev.clientX, ev.clientY);
          lastTap = ev.button === 2 ? null : { x: ev.clientX, y: ev.clientY, t: now };
        }
      }
      singleDrag = null;
      hadTwoFingers = false;
    }
  });

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
  });

  canvas.addEventListener("pointercancel", (ev) => {
    canvas.releasePointerCapture(ev.pointerId);
    activePointers.delete(ev.pointerId);
    if (activePointers.size < 2) prevTwoFinger = null;
    if (activePointers.size === 0) {
      singleDrag = null;
      hadTwoFingers = false;
    }
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
    if (observedRoundResetCount !== game.getRoundResetCount()) {
      observedRoundResetCount = game.getRoundResetCount();
      victoryState = null;
      centralServer.root.visible = true;
      resetViewForNewRound();
    }
    cameraRig.applyArrowKeys(dt);
    const perfSync0 = performance.now();
    game.sync();
    chatUi.update();
    const perfSync1 = performance.now();
    game.clearBeamDraws();
    if (game.consumeTerrainDirty()) {
      world.rebuildTerrain();
    }

    const perfTile0 = performance.now();
    tileVisuals.sync(game);
    const perfTile1 = performance.now();
    if (devModeVisible) tileDebug.refresh(game.getTilesOrdered(), game.getTiles());
    if (devModeVisible) chunkDebug.refresh(game.getLoadedChunkKeys());
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
    const chunkStats = game.getChunkLoadStats();
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
      chunksLoaded: chunkStats.loaded,
      chunksTotal: chunkStats.total,
      chunksPending: chunkStats.pending,
      chunkFirstMs: chunkStats.firstMs,
      chunkSpawnMs: chunkStats.spawnMs,
      chunkFullMs: chunkStats.fullMs,
    };

    const myColor = game.getPlayerColor(game.room.sessionId);
    const mySquadCount = game.getMySquadCount();
    const myResources = game.getMyResources();
    const selectedInfo: SelectionInfo | null = game.getSelectedEntity()?.getSelectionInfo() ?? null;
    const selectedTile: TileView | null = game.getSelectedTile();
    const kothState: KothState = game.getKothState();
    // Sync central server model color + terrain height
    centralServer.syncOwner(kothState.ownerColor || null);
    centralServer.syncTerrainY(getTerrainHeightAt(0, 0, game.getTiles()));

    // Victory detection — trigger once when any player reaches 0ms
    if (!victoryState) {
      const winner = kothState.entries.find((e) => e.timeMs <= 0);
      if (winner) {
        victoryState = {
          name: winner.name,
          color: winner.color,
          isMe: winner.sessionId === game.room.sessionId,
          startT: now / 1000,
        };
        triggerVictoryExplosions(winner.sessionId);
      }
    }

    drawHUD(hudCanvas, hud, myColor, mySquadCount, myResources, selectedInfo, selectedTile, now / 1000, kothState);
    drawFloatingResourceTexts(hudCanvas, projectFloatingResourceTexts(game, camera, hudCanvas, now / 1000));
    if (victoryState) drawVictoryOverlay(hudCanvas, victoryState, now / 1000, victoryState.startT);

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

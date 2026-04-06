import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GAME_RULES, snapWorldToTileCenter } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { BeamDrawer } from "./beam-drawer.js";
import {
  addMoveMarker,
  createHudCanvas,
  createHudState,
  drawHUD,
  hitTestDeselect,
  hitTestMenu,
  hitTestSelectionAction,
  showWarning,
} from "./hud.js";
import type { SelectionInfo } from "./entity.js";
import { createTerrainMesh, type TileView } from "./terrain.js";
import { attachDevNetworkPerf } from "./network-perf.js";
import { TileVisualManager } from "./tile-visuals.js";

const CAM = {
  polarFromDownDeg: 55,
  azimuthDeg: 45,
  distanceStart: 165,
  distanceMin: 26,
  distanceMax: 420,
  zoomFactor: 1.035,
  fov: 52,
  /** Orbit / tilt with arrow keys (deg/s). */
  arrowYawDegPerSec: 78,
  arrowPitchDegPerSec: 52,
  polarPitchMinDeg: 38,
  polarPitchMaxDeg: 72,
} as const;

const SUN = {
  direction: new THREE.Vector3(-0.55, 1, -0.35).normalize(),
  intensity: 0.72,
  shadowRadius: 44,
  shadowDepth: 160,
  shadowDistance: 90,
  mapSize: 2048,
} as const;

/**
 * `scene.environment` adds both reflections and diffuse IBL; RoomEnvironment is quite hot at 1.
 * Keep low enough to avoid blown highlights while metals still pick up reflections.
 */
const SCENE_ENVIRONMENT_INTENSITY = 0.38;

export function startRender(game: Game) {
  const netPerf = attachDevNetworkPerf(game.room);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;";
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0xb8e4ff, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const { scene } = game;

  /* IBL for MeshStandardMaterial / glTF metal — without this, reflections are black. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0).texture;
  scene.environmentIntensity = SCENE_ENVIRONMENT_INTENSITY;
  pmrem.dispose();

  scene.fog = new THREE.Fog(0xb8e4ff, 380, 1280);
  scene.add(new THREE.AmbientLight(0xfff6d8, 0.34));
  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x9bc67a, 1.02));

  const dir = new THREE.DirectionalLight(0xfff3d6, SUN.intensity);
  dir.castShadow = true;
  dir.shadow.mapSize.setScalar(SUN.mapSize);
  dir.shadow.bias = -0.00008;
  dir.shadow.normalBias = 0.01;
  dir.shadow.radius = 2.5;
  dir.shadow.blurSamples = 8;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = SUN.shadowDepth;
  dir.shadow.camera.left = -SUN.shadowRadius;
  dir.shadow.camera.right = SUN.shadowRadius;
  dir.shadow.camera.top = SUN.shadowRadius;
  dir.shadow.camera.bottom = -SUN.shadowRadius;
  scene.add(dir);
  scene.add(dir.target);

  const terrain = createTerrainMesh(game.getTilesOrdered());
  scene.add(terrain);
  const tileVisuals = new TileVisualManager();
  scene.add(tileVisuals.root);
  const beamDrawer = new BeamDrawer(12_288);
  scene.add(beamDrawer.root);
  game.setBeamDrawer(beamDrawer);

  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / Math.max(window.innerHeight, 1), 0.5, 5200);
  camera.up.set(0, 1, 0);

  let distance: number = CAM.distanceStart;
  let polarFromDownDeg = CAM.polarFromDownDeg;
  let azimuthDeg = CAM.azimuthDeg;
  const myTownCenter = game.getMyTownCenterPosition();
  const lookTarget = new THREE.Vector3(myTownCenter?.x ?? 0, 0, myTownCenter?.z ?? 0);
  const shadowCenter = new THREE.Vector3();
  const shadowOffset = SUN.direction.clone().multiplyScalar(SUN.shadowDistance);
  const arrowKeysHeld = new Set<string>();

  function placeCamera() {
    const theta = THREE.MathUtils.degToRad(polarFromDownDeg);
    const phi = THREE.MathUtils.degToRad(azimuthDeg);
    camera.position.set(
      lookTarget.x + distance * Math.sin(theta) * Math.sin(phi),
      lookTarget.y + distance * Math.cos(theta),
      lookTarget.z + distance * Math.sin(theta) * Math.cos(phi)
    );
    camera.lookAt(lookTarget);

    const forward = new THREE.Vector3(lookTarget.x - camera.position.x, 0, lookTarget.z - camera.position.z).normalize();
    shadowCenter.copy(lookTarget).addScaledVector(forward, SUN.shadowRadius * 0.35);
    dir.target.position.copy(shadowCenter);
    dir.position.copy(shadowCenter).add(shadowOffset);
    dir.target.updateMatrixWorld();
  }
  placeCamera();

  function onCameraKeyDown(e: KeyboardEvent) {
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      arrowKeysHeld.add(e.key);
      e.preventDefault();
    }
  }

  function onCameraKeyUp(e: KeyboardEvent) {
    arrowKeysHeld.delete(e.key);
  }

  function applyCameraArrowKeys(dt: number) {
    if (arrowKeysHeld.size === 0) return;
    if (arrowKeysHeld.has("ArrowLeft")) azimuthDeg -= CAM.arrowYawDegPerSec * dt;
    if (arrowKeysHeld.has("ArrowRight")) azimuthDeg += CAM.arrowYawDegPerSec * dt;
    if (arrowKeysHeld.has("ArrowUp")) {
      polarFromDownDeg = THREE.MathUtils.clamp(
        polarFromDownDeg - CAM.arrowPitchDegPerSec * dt,
        CAM.polarPitchMinDeg,
        CAM.polarPitchMaxDeg
      );
    }
    if (arrowKeysHeld.has("ArrowDown")) {
      polarFromDownDeg = THREE.MathUtils.clamp(
        polarFromDownDeg + CAM.arrowPitchDegPerSec * dt,
        CAM.polarPitchMinDeg,
        CAM.polarPitchMaxDeg
      );
    }
    placeCamera();
  }

  window.addEventListener("keydown", onCameraKeyDown);
  window.addEventListener("keyup", onCameraKeyUp);

  const raycaster = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const terrainHits: THREE.Intersection<THREE.Object3D>[] = [];
  const hitNormal = new THREE.Vector3();
  const hitNormalMatrix = new THREE.Matrix3();

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
    raycaster.intersectObject(terrain, false, terrainHits);
    hitNormalMatrix.getNormalMatrix(terrain.matrixWorld);
    for (const terrainHit of terrainHits) {
      if (!terrainHit.face) continue;
      hitNormal.copy(terrainHit.face.normal).applyMatrix3(hitNormalMatrix).normalize();
      if (hitNormal.y > 0.35) {
        return terrainHit.point.clone();
      }
    }
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit.clone() : null;
  }

  function panCamera(fromX: number, fromY: number, toX: number, toY: number) {
    const from = groundHit(fromX, fromY);
    const to = groundHit(toX, toY);
    if (!from || !to) return;
    lookTarget.x += from.x - to.x;
    lookTarget.z += from.z - to.z;
    placeCamera();
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

  function handleClick(clientX: number, clientY: number) {
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
          showWarning(hud, "Can't build on mountains", performance.now() / 1000);
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
    const picked = game.pickEntityFromRay(raycaster);
    if (picked) {
      cancelPendingMove();
      game.toggleSelection(picked.id);
      lastGroundTap.t = 0;
      return;
    }

    const point = groundHit(clientX, clientY);
    if (!point) return;

    const now = performance.now();

    if (game.getSelectedMyBlobEntity()) {
      cancelPendingMove();
      const tx = point.x;
      const tz = point.z;
      const sx = clientX;
      const sy = clientY;
      pendingMoveTimer = setTimeout(() => {
        pendingMoveTimer = null;
        const tile = game.getTileAtWorld(tx, tz);
        if (!tile?.canWalk) {
          showWarning(hud, getMoveBlockedMessage(tile), performance.now() / 1000);
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
        showWarning(hud, "Can't build on mountains", now / 1000);
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
    if (!drag.moved) handleClick(ev.clientX, ev.clientY);
    canvas.releasePointerCapture(ev.pointerId);
    drag = null;
  });

  canvas.addEventListener("pointercancel", (ev) => {
    canvas.releasePointerCapture(ev.pointerId);
    drag = null;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? CAM.zoomFactor : 1 / CAM.zoomFactor;
      distance = THREE.MathUtils.clamp(distance * factor, CAM.distanceMin, CAM.distanceMax);
      placeCamera();
    },
    { passive: false }
  );

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let lastFrameTime = performance.now();

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    applyCameraArrowKeys(dt);
    game.sync();
    game.clearBeamDraws();
    tileVisuals.sync(game);
    game.setOrbitCameraForFrame(distance, CAM.distanceMin, CAM.distanceMax);
    for (const entity of game.entities) entity.render(dt);
    game.flushBeamDraws();
    dir.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    const myColor = game.getPlayerColor(game.room.sessionId);
    const mySquadCount = game.getMySquadCount();
    const myResources = game.getMyResources();
    const selectedInfo: SelectionInfo | null = game.getSelectedEntity()?.getSelectionInfo() ?? null;
    const selectedTile: TileView | null = game.getSelectedTile();

    drawHUD(hudCanvas, hud, myColor, mySquadCount, myResources, selectedInfo, selectedTile, now / 1000);

    netPerf.tick(now);
  }

  tick();
}

import * as THREE from "three";
import { GAME_RULES } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { createHudCanvas, createHudState, drawHUD, hitTestDeselect, hitTestMenu, hitTestSelectionAction } from "./hud.js";
import type { SelectionInfo } from "./entity.js";
import { createTerrainMesh } from "./terrain.js";

const CAM = {
  polarFromDownDeg: 45,
  azimuthDeg: 0,
  distanceStart: 95,
  distanceMin: 52,
  distanceMax: 185,
  zoomFactor: 1.035,
  fov: 52,
} as const;

const SUN = {
  direction: new THREE.Vector3(-0.55, 1, -0.35).normalize(),
  intensity: 0.8,
  shadowRadius: 44,
  shadowDepth: 160,
  shadowDistance: 90,
  mapSize: 2048,
} as const;

export function startRender(game: Game) {
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
  renderer.toneMappingExposure = 1.08;

  const { scene } = game;
  scene.fog = new THREE.Fog(0xb8e4ff, 180, 620);
  scene.add(new THREE.AmbientLight(0xfff6d8, 0.5));
  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x9bc67a, 1.35));

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

  const terrainSeed = (game.room.state as { terrainSeed: number }).terrainSeed;
  const terrain = createTerrainMesh(terrainSeed);
  scene.add(terrain);

  const camera = new THREE.PerspectiveCamera(CAM.fov, window.innerWidth / Math.max(window.innerHeight, 1), 0.5, 2500);
  camera.up.set(0, 1, 0);

  let distance = CAM.distanceStart;
  const lookTarget = new THREE.Vector3(0, 0, 0);
  const shadowCenter = new THREE.Vector3();
  const shadowOffset = SUN.direction.clone().multiplyScalar(SUN.shadowDistance);

  function placeCamera() {
    const theta = THREE.MathUtils.degToRad(CAM.polarFromDownDeg);
    const phi = THREE.MathUtils.degToRad(CAM.azimuthDeg);
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

  const raycaster = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const hudCanvas = createHudCanvas();
  const hud = createHudState();
  const DRAG_THRESHOLD = 5;

  let drag: { startX: number; startY: number; prevX: number; prevY: number; moved: boolean } | null = null;
  let lastGroundTap = { t: 0, x: 0, y: 0, wx: 0, wz: 0 };
  const DOUBLE_MS = 420;
  const DOUBLE_SCREEN_PX = 32;
  const DOUBLE_WORLD = 18;

  function groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
    ndcV.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndcV, camera);
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
    game.clearSelection();
    hud.buildMenu.visible = false;
  }

  function handleClick(clientX: number, clientY: number) {
    const selectedInfo = game.getSelectedEntity()?.getSelectionInfo() ?? null;

    if (hitTestDeselect(clientX, clientY, game.selectedEntityId !== null)) {
      deselect();
      return;
    }

    const selectionAction = hitTestSelectionAction(clientX, clientY, selectedInfo);
    if (selectionAction !== null) {
      game.runSelectionAction(selectionAction);
      return;
    }

    const menuAction = hitTestMenu(hud, clientX, clientY);
    if (menuAction !== null) {
      if (menuAction !== "dismiss") {
        game.sendBuildIntent(menuAction, hud.buildMenu.worldX, hud.buildMenu.worldZ);
      }
      hud.buildMenu.visible = false;
      return;
    }
    if (hud.buildMenu.visible) {
      hud.buildMenu.visible = false;
      return;
    }

    const point = groundHit(clientX, clientY);
    if (!point) return;

    const picked = game.pickOwnedEntity(point.x, point.z);
    if (picked) {
      game.toggleSelection(picked.id);
      lastGroundTap.t = 0;
      return;
    }

    const now = performance.now();
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
      game.clearSelection();
      hud.buildMenu = { visible: true, screenX: clientX, screenY: clientY, worldX: point.x, worldZ: point.z };
      lastGroundTap.t = 0;
      return;
    }

    lastGroundTap = { t: now, x: clientX, y: clientY, wx: point.x, wz: point.z };
    if (game.getSelectedBlobEntity()) {
      game.sendMoveIntent(point.x, point.z);
    }
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
    game.sync();
    for (const entity of game.entities) entity.render(dt);
    dir.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    const myColor = game.getPlayerColor(game.room.sessionId);
    const mySquadCount = game.getMySquadCount();
    const selectedInfo: SelectionInfo | null = game.getSelectedEntity()?.getSelectionInfo() ?? null;

    drawHUD(hudCanvas, hud, myColor, mySquadCount, selectedInfo, now / 1000);
  }

  tick();
}

import * as THREE from "three";
import { Callbacks } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import type { Game } from "./game.js";
import { isMyBlob, sendMoveIntent } from "./game.js";
import { createHudCanvas, createHudState, drawHUD, hitTestMenu, hitTestDeselect } from "./hud.js";
import type { SelectedBlobInfo } from "./hud.js";
import { BuildingType } from "./constants.js";

/**
 * Camera config — tweak freely.
 * polarFromDownDeg: 0 = top-down, 90 = horizon.
 * azimuthDeg: 0 = camera on +Z side.
 */
const CAM = {
  polarFromDownDeg: 45,
  azimuthDeg: 0,
  /** Starting distance — lower = closer to the action. */
  distanceStart: 95,
  /** Clamp range so zoom never feels extreme. */
  distanceMin: 52,
  distanceMax: 185,
  /** Multiplier per wheel tick — keep small (~3–4%) so zoom feels gradual. */
  zoomFactor: 1.035,
  fov: 52,
} as const;

// ── Server state mirror types ─────────────────────────────────────────────────
// These match the Schema fields on the server — typed here for compile-time safety.

type BlobState     = { x: number; y: number; radius: number; ownerId: string; unitCount: number; health: number };
type BuildingState = { x: number; y: number; buildingType: number; health: number; ownerId: string };

// ── Visual types ──────────────────────────────────────────────────────────────

type BlobVisual = {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

type BuildingVisual = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

export function startRender(room: Room, game: Game) {
  // ── WebGL canvas ────────────────────────────────────────────────────────────
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;";
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0f1218, 1);

  // ── Scene ───────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0f1218, 120, 520);

  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1f2e, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(40, 80, 20);
  scene.add(dir);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280),
    new THREE.MeshStandardMaterial({ color: 0x1e2433, roughness: 0.92, metalness: 0.05 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(260, 52, 0x2a3348, 0x222a3a);
  grid.position.y = 0.02;
  scene.add(grid);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    CAM.fov,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.5,
    2500
  );
  camera.up.set(0, 1, 0);

  let distance: number = CAM.distanceStart;
  const lookTarget = new THREE.Vector3(0, 0, 0);

  function placeCamera() {
    const θ = THREE.MathUtils.degToRad(CAM.polarFromDownDeg);
    const φ = THREE.MathUtils.degToRad(CAM.azimuthDeg);
    camera.position.set(
      lookTarget.x + distance * Math.sin(θ) * Math.sin(φ),
      lookTarget.y + distance * Math.cos(θ),
      lookTarget.z + distance * Math.sin(θ) * Math.cos(φ)
    );
    camera.lookAt(lookTarget);
  }
  placeCamera();

  // ── Raycasting ──────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _hit = new THREE.Vector3();

  function groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
    ndcV.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndcV, camera);
    return raycaster.ray.intersectPlane(groundPlane, _hit) ? _hit.clone() : null;
  }

  function pickMyBlob(clientX: number, clientY: number): string | null {
    const p = groundHit(clientX, clientY);
    if (!p) return null;
    let bestId: string | null = null;
    let bestD = Infinity;
    room.state.blobs.forEach((blob: BlobState, id: string) => {
      if (!isMyBlob(game, blob.ownerId)) return;
      const d = Math.hypot(p.x - blob.x, p.z - blob.y);
      if (d <= blob.radius * 1.2 && d < bestD) { bestD = d; bestId = id; }
    });
    return bestId;
  }

  // ── Shared color helper ───────────────────────────────────────────────────────
  function playerColor(ownerId: string): number {
    const p = room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof p?.color === "number" ? p.color : 0x8899aa;
  }

  // ── Blob visuals ──────────────────────────────────────────────────────────────
  const blobVisuals = new Map<string, BlobVisual>();
  const sphereGeom = new THREE.SphereGeometry(1, 22, 16);
  const ringGeom = new THREE.RingGeometry(1.05, 1.2, 48);

  function addBlob(id: string, blob: BlobState): BlobVisual {
    const body = new THREE.Mesh(
      sphereGeom,
      new THREE.MeshStandardMaterial({ color: playerColor(blob.ownerId), roughness: 0.45, metalness: 0.15 })
    );
    const ring = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;

    const group = new THREE.Group();
    group.add(body);
    group.add(ring);
    scene.add(group);

    const vis: BlobVisual = { group, body, ring };
    blobVisuals.set(id, vis);
    return vis;
  }

  function removeBlob(id: string) {
    const vis = blobVisuals.get(id);
    if (!vis) return;
    scene.remove(vis.group);
    blobVisuals.delete(id);
  }

  function syncBlob(vis: BlobVisual, id: string, blob: BlobState) {
    vis.body.material.color.setHex(playerColor(blob.ownerId));
    const r = blob.radius;
    vis.group.position.set(blob.x, r * 0.65, blob.y);
    vis.group.scale.setScalar(r);
    const mine = isMyBlob(game, blob.ownerId);
    vis.body.material.opacity = mine ? 1 : 0.55;
    vis.body.material.transparent = !mine;
    vis.ring.material.opacity = mine && game.selectedBlobId === id ? 0.9 : 0;
  }

  // ── Building visuals ──────────────────────────────────────────────────────────
  const buildingVisuals = new Map<string, BuildingVisual>();

  // Geometries: barracks = wide flat box, tower = tall narrow box.
  // Half-heights: barracks 1, tower 4 — used to set y so the base sits on ground.
  const BUILDING_GEOM = {
    [BuildingType.BARRACKS]: { geom: new THREE.BoxGeometry(5, 2, 5),  halfH: 1 },
    [BuildingType.TOWER]:    { geom: new THREE.BoxGeometry(2, 8, 2),  halfH: 4 },
  } as const;

  function addBuilding(id: string, bld: BuildingState): BuildingVisual {
    const def = BUILDING_GEOM[bld.buildingType as BuildingType] ?? BUILDING_GEOM[BuildingType.BARRACKS];
    const mesh = new THREE.Mesh(
      def.geom,
      new THREE.MeshStandardMaterial({ color: playerColor(bld.ownerId), roughness: 0.7, metalness: 0.1 })
    );
    mesh.position.set(bld.x, def.halfH, bld.y);
    scene.add(mesh);
    buildingVisuals.set(id, mesh);
    return mesh;
  }

  function removeBuilding(id: string) {
    const mesh = buildingVisuals.get(id);
    if (!mesh) return;
    scene.remove(mesh);
    buildingVisuals.delete(id);
  }

  // ── State callbacks (Colyseus diff reactions) ─────────────────────────────────
  const callbacks = Callbacks.get(room);

  callbacks.onAdd("blobs", (blob, id) => {
    const key = id as string;
    syncBlob(addBlob(key, blob as BlobState), key, blob as BlobState);
  });
  callbacks.onRemove("blobs", (_blob, id) => removeBlob(id as string));

  callbacks.onAdd("buildings", (bld, id) => addBuilding(id as string, bld as BuildingState));
  callbacks.onRemove("buildings", (_bld, id) => removeBuilding(id as string));

  // ── HUD ─────────────────────────────────────────────────────────────────────
  const hudCanvas = createHudCanvas();
  const hud = createHudState();

  // ── Input ────────────────────────────────────────────────────────────────────
  const DRAG_THRESHOLD = 5;

  let drag: {
    startX: number; startY: number;
    prevX: number;  prevY: number;
    moved: boolean;
  } | null = null;

  function panCamera(fromX: number, fromY: number, toX: number, toY: number) {
    const from = groundHit(fromX, fromY);
    const to   = groundHit(toX,   toY);
    if (!from || !to) return;
    lookTarget.x += from.x - to.x;
    lookTarget.z += from.z - to.z;
    placeCamera();
  }

  let lastGroundTap = { t: 0, x: 0, y: 0, wx: 0, wz: 0 };
  const DOUBLE_MS = 420;
  const DOUBLE_SCREEN_PX = 32;
  const DOUBLE_WORLD = 18;

  function deselect() {
    game.selectedBlobId = null;
    hud.buildMenu.visible = false;
  }

  function handleClick(clientX: number, clientY: number) {
    // 0. Deselect × button on the selection card
    if (hitTestDeselect(clientX, clientY, game.selectedBlobId !== null)) {
      deselect();
      return;
    }

    // 1. HUD build menu hit-test
    const menuAction = hitTestMenu(hud, clientX, clientY);
    if (menuAction !== null) {
      if (menuAction !== "dismiss") {
        room.send("build", {
          type: menuAction,
          worldX: hud.buildMenu.worldX,
          worldZ: hud.buildMenu.worldZ,
        });
      }
      hud.buildMenu.visible = false;
      return;
    }
    if (hud.buildMenu.visible) {
      hud.buildMenu.visible = false;
      return;
    }

    // 2. Blob pick — click to select, click again to deselect
    const picked = pickMyBlob(clientX, clientY);
    if (picked) {
      game.selectedBlobId = picked === game.selectedBlobId ? null : picked;
      lastGroundTap.t = 0; // blob click resets double-click chain
      return;
    }

    // 3. Ground point
    const pt = groundHit(clientX, clientY);
    if (!pt) return;

    // 4. Double-click detection — always active, regardless of selection state
    const now = performance.now();
    const dtMs = now - lastGroundTap.t;
    const dScr = Math.hypot(clientX - lastGroundTap.x, clientY - lastGroundTap.y);
    const dW = Math.hypot(pt.x - lastGroundTap.wx, pt.z - lastGroundTap.wz);
    const isDouble =
      lastGroundTap.t > 0 &&
      dtMs < DOUBLE_MS &&
      dtMs > 30 &&
      dScr < DOUBLE_SCREEN_PX &&
      dW < DOUBLE_WORLD;

    if (isDouble) {
      game.selectedBlobId = null; // leave selection mode, enter build mode
      hud.buildMenu = { visible: true, screenX: clientX, screenY: clientY, worldX: pt.x, worldZ: pt.z };
      lastGroundTap.t = 0;
      return;
    }

    // 5. Single ground tap — record for potential double-click, then handle
    lastGroundTap = { t: now, x: clientX, y: clientY, wx: pt.x, wz: pt.z };

    if (game.selectedBlobId) {
      sendMoveIntent(game, pt.x, pt.z);
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
      game.selectedBlobId = null;
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

  // ── Loop ─────────────────────────────────────────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);

    room.state.blobs.forEach((blob: BlobState, id: string) => {
      let vis = blobVisuals.get(id);
      if (!vis) vis = addBlob(id, blob);
      syncBlob(vis, id, blob);
    });

    renderer.render(scene, camera);

    let myBlobCount = 0;
    room.state.blobs.forEach((b: BlobState) => {
      if (b.ownerId === room.sessionId) myBlobCount++;
    });

    const me = room.state.players.get(room.sessionId) as { color?: number } | undefined;
    const myColor = typeof me?.color === "number" ? me.color : 0x8899aa;

    let selectedInfo: SelectedBlobInfo | null = null;
    if (game.selectedBlobId) {
      const sb = room.state.blobs.get(game.selectedBlobId) as BlobState | undefined;
      if (sb) {
        selectedInfo = {
          unitCount: sb.unitCount,
          health: sb.health,
          maxHealth: 100,
          color: playerColor(sb.ownerId),
        };
      }
    }

    drawHUD(hudCanvas, hud, myColor, myBlobCount, selectedInfo, performance.now() / 1000);
  }
  tick();
}

import * as THREE from "three";
import { Callbacks } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import type { Game } from "./game.js";
import { isMyBlob, sendMoveIntent } from "./game.js";

/**
 * Oblique RTS-style camera: always looks at a ground point; height / distance set by zoom.
 * `polarFromDownDeg`: 0 = top-down, 90 = horizon; 45 is a typical “isometric” tilt.
 */
const VIEW = {
  polarFromDownDeg: 45,
  /** Orbit around world Y, degrees. 0 = camera on +Z side of the target. */
  azimuthDeg: 0,
  /** Initial straight-line distance from camera to look-at point (same units as world). */
  distance: 140,
  /** Each wheel step multiplies distance by this (or its inverse when zooming out). */
  zoomStep: 1.12,
  distanceMin: 28,
  distanceMax: 520,
  fov: 52,
} as const;

const lookTarget = new THREE.Vector3(0, 0, 0);

/** Fields we read from synced blob state (server is authoritative). */
type BlobState = {
  x: number;
  y: number;
  radius: number;
  ownerId: string;
};

/** One blob in the scene: sphere mesh + flat ring (selection hint). Kept in a Map by blob id. */
type BlobVisual = {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Lies on the ground (XZ); opacity toggled for “selected”. Not a mesh outline shader—just a ring decal. */
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

export function startRender(room: Room, game: Game) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0f1218, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0f1218, 120, 520);

  const camera = new THREE.PerspectiveCamera(
    VIEW.fov,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.5,
    2500
  );
  camera.up.set(0, 1, 0);

  let distance: number = VIEW.distance;

  function placeCamera() {
    const θ = THREE.MathUtils.degToRad(VIEW.polarFromDownDeg);
    const φ = THREE.MathUtils.degToRad(VIEW.azimuthDeg);
    const sinθ = Math.sin(θ);
    const cosθ = Math.cos(θ);
    const sinφ = Math.sin(φ);
    const cosφ = Math.cos(φ);
    camera.position.set(
      lookTarget.x + distance * sinθ * sinφ,
      lookTarget.y + distance * cosθ,
      lookTarget.z + distance * sinθ * cosφ
    );
    camera.lookAt(lookTarget);
  }
  placeCamera();

  function resizeCam() {
    const a = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.aspect = a;
    camera.updateProjectionMatrix();
  }
  resizeCam();

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const closer = e.deltaY < 0;
      const factor = closer ? VIEW.zoomStep : 1 / VIEW.zoomStep;
      distance = THREE.MathUtils.clamp(
        distance * factor,
        VIEW.distanceMin,
        VIEW.distanceMax
      );
      placeCamera();
    },
    { passive: false }
  );

  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1f2e, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.55);
  dir.position.set(40, 80, 20);
  scene.add(dir);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 280),
    new THREE.MeshStandardMaterial({
      color: 0x1e2433,
      roughness: 0.92,
      metalness: 0.05,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(260, 52, 0x2a3348, 0x222a3a);
  grid.position.y = 0.02;
  scene.add(grid);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  const visuals = new Map<string, BlobVisual>();
  const sphereGeom = new THREE.SphereGeometry(1, 22, 16);
  const ringGeom = new THREE.RingGeometry(1.05, 1.2, 48);

  function playerColor(ownerId: string): number {
    const p = room.state.players.get(ownerId) as { color?: number } | undefined;
    return typeof p?.color === "number" ? p.color : 0x8899aa;
  }

  function addBlob(id: string, blob: BlobState): BlobVisual {
    const body = new THREE.Mesh(
      sphereGeom,
      new THREE.MeshStandardMaterial({
        color: playerColor(blob.ownerId),
        roughness: 0.45,
        metalness: 0.15,
      })
    );
    const ring = new THREE.Mesh(
      ringGeom,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;

    const group = new THREE.Group();
    group.add(body);
    group.add(ring);
    scene.add(group);

    const vis: BlobVisual = { group, body, ring };
    visuals.set(id, vis);
    return vis;
  }

  function removeBlob(id: string) {
    const vis = visuals.get(id);
    if (!vis) {
      return;
    }
    scene.remove(vis.group);
    visuals.delete(id);
  }

  /** Push authoritative state into meshes (position, scale, tint, selection ring). */
  function syncBlob(vis: BlobVisual, id: string, blob: BlobState) {
    const { group, body, ring } = vis;
    body.material.color.setHex(playerColor(blob.ownerId));
    const r = blob.radius;
    group.position.set(blob.x, r * 0.65, blob.y);
    group.scale.setScalar(r);

    const mine = isMyBlob(game, blob.ownerId);
    body.material.opacity = mine ? 1 : 0.55;
    body.material.transparent = !mine;

    const selected = mine && game.selectedBlobId === id;
    ring.material.opacity = selected ? 0.9 : 0;
  }

  const callbacks = Callbacks.get(room);
  callbacks.onAdd("blobs", (blob, id) => {
    const key = id as string;
    syncBlob(addBlob(key, blob as BlobState), key, blob as BlobState);
  });
  callbacks.onRemove("blobs", (_blob, id) => {
    removeBlob(id as string);
  });

  function groundHit(ndcX: number, ndcY: number): THREE.Vector3 | null {
    ndc.set(ndcX, ndcY);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(groundPlane, hit) ? hit.clone() : null;
  }

  function pickMyBlob(ndcX: number, ndcY: number): string | null {
    const p = groundHit(ndcX, ndcY);
    if (!p) {
      return null;
    }
    let bestId: string | null = null;
    let bestD = Infinity;
    room.state.blobs.forEach((blob: BlobState, id: string) => {
      if (!isMyBlob(game, blob.ownerId)) {
        return;
      }
      const d = Math.hypot(p.x - blob.x, p.z - blob.y);
      if (d <= blob.radius * 1.2 && d < bestD) {
        bestD = d;
        bestId = id;
      }
    });
    return bestId;
  }

  window.addEventListener("pointerdown", (ev) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ndcX = (ev.clientX / w) * 2 - 1;
    const ndcY = -(ev.clientY / h) * 2 + 1;

    const picked = pickMyBlob(ndcX, ndcY);
    if (picked) {
      game.selectedBlobId = picked;
      return;
    }

    const pt = groundHit(ndcX, ndcY);
    if (pt) {
      sendMoveIntent(game, pt.x, pt.z);
    }
  });

  window.addEventListener("resize", () => {
    resizeCam();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function tick() {
    requestAnimationFrame(tick);
    room.state.blobs.forEach((blob: BlobState, id: string) => {
      let vis = visuals.get(id);
      if (!vis) {
        vis = addBlob(id, blob);
      }
      syncBlob(vis, id, blob);
    });
    renderer.render(scene, camera);
  }
  tick();
}

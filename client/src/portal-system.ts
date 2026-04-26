import * as THREE from "three";
import type { Game } from "./game.js";
import { BlobEntity } from "./blob-entity.js";
import { getTerrainHeightAt } from "./terrain.js";
import type { TileView } from "./terrain.js";

const PORTAL_TRIGGER_RADIUS = 13;
const PORTAL_EDGE_MARGIN = 20;      // units inside the square map boundary
const WORLD_HALF = 360;             // GAME_RULES.WORLD_MAX
const PORTAL_RING_RADIUS = 5.5;
// Return portal is placed this many units outward from town center so it's
// clearly visible near spawn but well clear of the playable area —
// agents moving inward won't stumble through it accidentally.
const RETURN_PORTAL_OFFSET = 45;
const PORTAL_URL = "https://vibejam.cc/portal/2026";

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeLabel(text: string, fillStyle: string): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = fillStyle;
  ctx.font = "bold 48px Cinzel, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(14, 3.5, 1);
  sprite.position.set(0, PORTAL_RING_RADIUS + 2.2, 0);
  sprite.frustumCulled = false;
  return sprite;
}

function makePortalGroup(
  ringColor: number, ringEmissive: number,
  discColor: number, discEmissive: number,
  labelText: string, labelFill: string
): { group: THREE.Group; ring: THREE.Mesh; disc: THREE.Mesh } {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(PORTAL_RING_RADIUS, 0.72, 8, 64),
    new THREE.MeshStandardMaterial({
      color: ringColor,
      emissive: new THREE.Color(ringEmissive),
      emissiveIntensity: 1.4,
      roughness: 0.18,
      metalness: 0.55,
    })
  );
  ring.castShadow = false;
  ring.frustumCulled = false;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_RING_RADIUS - 0.72, 64),
    new THREE.MeshStandardMaterial({
      color: discColor,
      emissive: new THREE.Color(discEmissive),
      emissiveIntensity: 1.8,
      transparent: true, opacity: 0.58,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  disc.frustumCulled = false;

  group.add(ring);
  group.add(disc);
  group.add(makeLabel(labelText, labelFill));
  group.visible = false;
  return { group, ring, disc };
}

function placeGroup(
  group: THREE.Group, x: number, z: number,
  tiles: Map<string, TileView>, facingNx: number, facingNz: number
): void {
  const terrainY = getTerrainHeightAt(x, z, tiles);
  group.position.set(x, terrainY + PORTAL_RING_RADIUS + 0.5, z);
  // Rotate so the torus face (+Z by default) points toward map center
  group.rotation.y = Math.atan2(-facingNx, -facingNz);
  group.visible = true;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class PortalSystem {
  // Outgoing portal — sends player to the Vibe Jam hub
  private readonly outGroup: THREE.Group;
  private readonly outRing: THREE.Mesh;
  private readonly outDisc: THREE.Mesh;
  private outReady = false;
  private outTriggered = false;
  private outX = 0;
  private outZ = 0;

  // Return portal — only shown when arriving via ?portal=true&ref=...
  private readonly retGroup: THREE.Group;
  private readonly retRing: THREE.Mesh;
  private readonly retDisc: THREE.Mesh;
  private retReady = false;
  private retTriggered = false;
  private retX = 0;
  private retZ = 0;
  private readonly hasIncoming: boolean;
  private readonly incomingRef: string;
  private readonly incomingParams: URLSearchParams;

  private animT = 0;

  constructor(scene: THREE.Scene) {
    // Outgoing portal — purple/violet
    { const p = makePortalGroup(0x9955ff, 0x6622dd, 0x3300aa, 0x4411cc, "✦ Vibe Jam Portal ✦", "rgba(180,120,255,0.92)");
      this.outGroup = p.group; this.outRing = p.ring; this.outDisc = p.disc; }

    // Return portal — amber/gold
    { const p = makePortalGroup(0xffaa22, 0xdd7700, 0xaa5500, 0xff9900, "← Return Portal", "rgba(255,200,80,0.95)");
      this.retGroup = p.group; this.retRing = p.ring; this.retDisc = p.disc; }

    scene.add(this.outGroup);
    scene.add(this.retGroup);

    // Parse incoming portal params once
    this.incomingParams = new URLSearchParams(window.location.search);
    this.incomingRef   = this.incomingParams.get("ref") ?? "";
    this.hasIncoming   = this.incomingParams.get("portal") === "true" && this.incomingRef.length > 0;
  }

  private initOut(tcX: number, tcZ: number, tiles: Map<string, TileView>): void {
    const len = Math.hypot(tcX, tcZ);
    if (len < 1) return;
    const nx = tcX / len, nz = tcZ / len;
    // Project to the square map boundary then pull back by margin
    const tX = Math.abs(nx) > 1e-6 ? WORLD_HALF / Math.abs(nx) : Infinity;
    const tZ = Math.abs(nz) > 1e-6 ? WORLD_HALF / Math.abs(nz) : Infinity;
    const t  = Math.min(tX, tZ) - PORTAL_EDGE_MARGIN;
    this.outX = nx * t;
    this.outZ = nz * t;
    placeGroup(this.outGroup, this.outX, this.outZ, tiles, nx, nz);
    this.outReady = true;
  }

  private initReturn(tcX: number, tcZ: number, tiles: Map<string, TileView>): void {
    const len = Math.hypot(tcX, tcZ);
    if (len < 1) return;
    const nx = tcX / len, nz = tcZ / len;
    // Place OUTWARD from town center so agents moving toward the action never hit it accidentally
    this.retX = tcX + nx * RETURN_PORTAL_OFFSET;
    this.retZ = tcZ + nz * RETURN_PORTAL_OFFSET;
    placeGroup(this.retGroup, this.retX, this.retZ, tiles, nx, nz);
    this.retReady = true;
  }

  update(dt: number, game: Game): void {
    this.animT += dt;

    const tc = !this.outReady || (this.hasIncoming && !this.retReady)
      ? game.getMyTownCenterPosition()
      : null;
    const tiles = tc ? game.getTiles() : null;

    if (!this.outReady && tc && tiles?.size) this.initOut(tc.x, tc.z, tiles);
    if (this.hasIncoming && !this.retReady && tc && tiles?.size) this.initReturn(tc.x, tc.z, tiles);

    this.animatePortal(this.outGroup, this.outRing, this.outDisc);
    if (this.hasIncoming) this.animatePortal(this.retGroup, this.retRing, this.retDisc);

    if (this.outReady && !this.outTriggered) this.checkTrigger(game, this.outX, this.outZ, () => this.triggerOut(game));
    if (this.retReady && !this.retTriggered) this.checkTrigger(game, this.retX, this.retZ, () => this.triggerReturn());
  }

  private animatePortal(group: THREE.Group, ring: THREE.Mesh, disc: THREE.Mesh): void {
    if (!group.visible) return;
    const pulse = Math.sin(this.animT * 2.2) * 0.35 + 1.4;
    (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    (disc.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.2;
    (disc.material as THREE.MeshStandardMaterial).opacity = 0.48 + Math.sin(this.animT * 2.2) * 0.12;
    ring.rotation.z = this.animT * 0.7;
    disc.rotation.z = -this.animT * 0.4;
  }

  private checkTrigger(game: Game, px: number, pz: number, fire: () => void): void {
    for (const entity of game.entities) {
      if (!(entity instanceof BlobEntity) || !entity.isOwnedByMe()) continue;
      const c = entity.getPredictedWorldCenter();
      if (Math.hypot(c.x - px, c.z - pz) < PORTAL_TRIGGER_RADIUS) { fire(); return; }
    }
  }

  private triggerOut(game: Game): void {
    this.outTriggered = true;
    const name     = game.getMyPlayerName();
    const colorNum = game.getPlayerColor(game.room.sessionId);
    const colorHex = colorNum.toString(16).padStart(6, "0");
    const ref      = encodeURIComponent(window.location.host);
    window.location.href = `${PORTAL_URL}?username=${encodeURIComponent(name)}&color=%23${colorHex}&ref=${ref}`;
  }

  private triggerReturn(): void {
    this.retTriggered = true;
    // Forward ALL original params back; update ref to current host so the
    // destination knows where the player is returning from.
    const returnParams = new URLSearchParams(this.incomingParams);
    returnParams.set("ref", window.location.host);
    window.location.href = `https://${this.incomingRef}/?${returnParams.toString()}`;
  }
}

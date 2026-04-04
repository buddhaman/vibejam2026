import * as THREE from "three";
import { GAME_RULES, getSquadAxes } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { getTerrainHeightAt } from "./terrain.js";

const UNIT_GEOM = new THREE.CylinderGeometry(
  GAME_RULES.UNIT_RADIUS,
  GAME_RULES.UNIT_RADIUS * 0.92,
  GAME_RULES.UNIT_HEIGHT,
  10
);
const UNIT_MAT = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.82,
  metalness: 0.02,
});
const OVAL_FILL_GEOM = new THREE.CircleGeometry(1, 48);
const OVAL_FILL_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.08,
  depthWrite: false,
});
const OVAL_RING_GEOM = new THREE.RingGeometry(0.93, 1, 64);
const OVAL_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.26,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const DUMMY = new THREE.Object3D();
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private units!: THREE.InstancedMesh;
  private ovalFill!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private ovalRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private blob: {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    ownerId: string;
    unitCount: number;
    health: number;
  } | null = null;
  private heading = 0;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): THREE.Group {
    this.units = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), 256);
    this.units.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.units.castShadow = true;
    this.units.receiveShadow = true;

    this.ovalFill = new THREE.Mesh(OVAL_FILL_GEOM, OVAL_FILL_MAT.clone());
    this.ovalFill.rotation.x = -Math.PI / 2;
    this.ovalFill.position.y = 0.02;

    this.ovalRing = new THREE.Mesh(OVAL_RING_GEOM, OVAL_RING_MAT.clone());
    this.ovalRing.rotation.x = -Math.PI / 2;
    this.ovalRing.position.y = 0.03;

    const group = new THREE.Group();
    group.add(this.ovalFill);
    group.add(this.ovalRing);
    group.add(this.units);
    return group;
  }

  public sync(blob: {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    ownerId: string;
    unitCount: number;
    health: number;
  }): void {
    this.blob = blob;
  }

  public render(): void {
    if (!this.blob) return;

    const dx = this.blob.targetX - this.blob.x;
    const dz = this.blob.targetY - this.blob.y;
    const moveDistance = Math.hypot(dx, dz);
    if (moveDistance > 0.05) {
      this.heading = Math.atan2(dx, dz);
    }

    const { major, minor } = getSquadAxes(this.blob.unitCount, moveDistance);
    const terrainY = getTerrainHeightAt(this.blob.x, this.blob.y, (this.game.room.state as { terrainSeed: number }).terrainSeed);
    const color = this.game.getPlayerColor(this.blob.ownerId);
    const tint = new THREE.Color(color);

    this.mesh.position.set(this.blob.x, terrainY, this.blob.y);
    this.mesh.rotation.y = this.heading;

    this.ovalFill.scale.set(major, minor, 1);
    this.ovalRing.scale.set(major * 1.04, minor * 1.04, 1);
    this.ovalFill.material.color.copy(tint).offsetHSL(0, 0.06, 0.1);
    this.ovalRing.material.color.copy(tint).offsetHSL(0, 0.03, this.isSelected() ? 0.18 : 0.08);
    this.ovalFill.material.opacity = this.isMine() ? 0.12 : 0.07;
    this.ovalRing.material.opacity = this.isSelected() ? 0.65 : this.isMine() ? 0.22 : 0.12;

    const unitsMaterial = this.units.material as THREE.MeshStandardMaterial;
    unitsMaterial.color.copy(tint).offsetHSL(0, 0.02, 0.02);
    unitsMaterial.opacity = this.isMine() ? 1 : 0.68;
    unitsMaterial.transparent = !this.isMine();

    this.units.count = Math.min(this.blob.unitCount, this.units.instanceMatrix.count);

    const unitHeight = GAME_RULES.UNIT_HEIGHT;
    for (let i = 0; i < this.units.count; i++) {
      const t = (i + 0.5) / this.units.count;
      const radius = Math.sqrt(t);
      const angle = i * GOLDEN_ANGLE;
      const px = Math.cos(angle) * radius * major * 0.82;
      const pz = Math.sin(angle) * radius * minor * 0.82;
      DUMMY.position.set(px, unitHeight * 0.5 + 0.02, pz);
      DUMMY.rotation.y = this.heading;
      DUMMY.updateMatrix();
      this.units.setMatrixAt(i, DUMMY.matrix);
    }
    this.units.instanceMatrix.needsUpdate = true;
  }

  public isMine(): boolean {
    return this.blob !== null && this.game.isMyBlob(this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.isMine() && this.game.selectedEntityId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    const dx = this.blob.targetX - this.blob.x;
    const dz = this.blob.targetY - this.blob.y;
    const { major, minor } = getSquadAxes(this.blob.unitCount, Math.hypot(dx, dz));
    const cos = Math.cos(-this.heading);
    const sin = Math.sin(-this.heading);
    const lx = (x - this.blob.x) * cos - (z - this.blob.y) * sin;
    const lz = (x - this.blob.x) * sin + (z - this.blob.y) * cos;
    return (lx * lx) / (major * major) + (lz * lz) / (minor * minor) <= 1.05;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.blob) return Infinity;
    return Math.hypot(x - this.blob.x, z - this.blob.y);
  }

  public getOwnerId(): string | null {
    return this.blob?.ownerId ?? null;
  }

  public getUnitCount(): number {
    return this.blob?.unitCount ?? 0;
  }

  public getHealth(): number {
    return this.blob?.health ?? 0;
  }

  public isStale(): boolean {
    return !this.game.room.state.blobs.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.isMine();
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.blob) return null;
    return {
      title: "Squad",
      detail: `${this.blob.unitCount} units`,
      health: this.blob.health,
      maxHealth: 100,
      color: this.game.getPlayerColor(this.blob.ownerId),
      action: null,
    };
  }
}

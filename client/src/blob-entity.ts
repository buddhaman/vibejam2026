import * as THREE from "three";
import { getBlobRadius } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";

const SPHERE_GEOM = new THREE.SphereGeometry(1, 22, 16);
const RING_GEOM = new THREE.RingGeometry(1.05, 1.2, 48);

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private body!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private ring!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private blob: {
    x: number;
    y: number;
    ownerId: string;
    unitCount: number;
    health: number;
  } | null = null;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): THREE.Group {
    this.body = new THREE.Mesh(
      SPHERE_GEOM,
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.45, metalness: 0.15 })
    );
    this.ring = new THREE.Mesh(
      RING_GEOM,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;

    const group = new THREE.Group();
    group.add(this.body);
    group.add(this.ring);
    return group;
  }

  public sync(blob: {
    x: number;
    y: number;
    ownerId: string;
    unitCount: number;
    health: number;
  }): void {
    this.blob = blob;
  }

  public render(): void {
    if (!this.blob) return;
    const radius = getBlobRadius(this.blob.unitCount);
    this.body.material.color.setHex(this.game.getPlayerColor(this.blob.ownerId));
    this.mesh.position.set(this.blob.x, radius * 0.65, this.blob.y);
    this.mesh.scale.setScalar(radius);
    this.body.material.opacity = this.isMine() ? 1 : 0.55;
    this.body.material.transparent = !this.isMine();
    this.ring.material.opacity = this.isSelected() ? 0.9 : 0;
  }

  public isMine(): boolean {
    return this.blob !== null && this.game.isMyBlob(this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.isMine() && this.game.selectedEntityId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    return Math.hypot(x - this.blob.x, z - this.blob.y) <= getBlobRadius(this.blob.unitCount) * 1.2;
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

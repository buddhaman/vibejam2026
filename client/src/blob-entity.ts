import * as THREE from "three";
import type { Game } from "./game.js";
import { isMyBlob } from "./game.js";
import { Entity } from "./entity.js";

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private body!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private ring!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private blob: {
    x: number;
    y: number;
    radius: number;
    ownerId: string;
    unitCount: number;
    health: number;
  } | null = null;

  public constructor(
    game: Game,
    id: string,
    private sphereGeom: THREE.SphereGeometry,
    private ringGeom: THREE.RingGeometry,
    private playerColor: (ownerId: string) => number
  ) {
    super(game, id);
  }

  protected createMesh(): THREE.Group {
    this.body = new THREE.Mesh(
      this.sphereGeom,
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.45, metalness: 0.15 })
    );
    this.ring = new THREE.Mesh(
      this.ringGeom,
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
    radius: number;
    ownerId: string;
    unitCount: number;
    health: number;
  }): void {
    this.blob = blob;
  }

  public render(): void {
    if (!this.blob) return;
    this.body.material.color.setHex(this.playerColor(this.blob.ownerId));
    this.mesh.position.set(this.blob.x, this.blob.radius * 0.65, this.blob.y);
    this.mesh.scale.setScalar(this.blob.radius);
    this.body.material.opacity = this.isMine() ? 1 : 0.55;
    this.body.material.transparent = !this.isMine();
    this.ring.material.opacity = this.isSelected() ? 0.9 : 0;
  }

  public isMine(): boolean {
    return this.blob !== null && isMyBlob(this.game, this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.isMine() && this.game.selectedBlobId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    return Math.hypot(x - this.blob.x, z - this.blob.y) <= this.blob.radius * 1.2;
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
}

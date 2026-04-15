import * as THREE from "three";
import type { TileView } from "./terrain.js";

const ARROW_GEOM = new THREE.BoxGeometry(0.08, 0.9, 0.08);
ARROW_GEOM.translate(0, 0.45, 0);

type ArrowFx = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  age: number;
  ttl: number;
  arcHeight: number;
};

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_POS = new THREE.Vector3();
const TEMP_NEXT = new THREE.Vector3();
const TEMP_DIR = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const DUMMY = new THREE.Object3D();

export class ArrowFxSystem {
  public readonly root: THREE.InstancedMesh;
  private readonly arrows: ArrowFx[] = [];

  public constructor(capacity = 2048) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2b1d12,
      roughness: 0.9,
      metalness: 0.06,
    });
    this.root = new THREE.InstancedMesh(ARROW_GEOM, material, capacity);
    this.root.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.castShadow = true;
    this.root.receiveShadow = true;
    this.root.frustumCulled = false;
    this.root.count = 0;
  }

  public spawn(params: { fromX: number; fromY: number; fromZ: number; toX: number; toY: number; toZ: number; speed: number }): void {
    if (this.arrows.length >= this.root.instanceMatrix.count) return;
    const dx = params.toX - params.fromX;
    const dy = params.toY - params.fromY;
    const dz = params.toZ - params.fromZ;
    const dist = Math.hypot(dx, dy, dz);
    this.arrows.push({
      from: new THREE.Vector3(params.fromX, params.fromY, params.fromZ),
      to: new THREE.Vector3(params.toX, params.toY, params.toZ),
      age: 0,
      ttl: Math.max(0.18, dist / Math.max(1, params.speed)),
      arcHeight: Math.max(1.8, dist * 0.09),
    });
  }

  public update(dt: number, _tiles: Map<string, TileView>): void {
    this.root.count = 0;
    let count = 0;
    for (const arrow of this.arrows) {
      arrow.age += dt;
      if (arrow.age >= arrow.ttl) continue;

      const t = Math.max(0, Math.min(1, arrow.age / arrow.ttl));
      const nextT = Math.max(t, Math.min(1, t + 0.025));
      this.sampleArrow(arrow, t, TEMP_POS);
      this.sampleArrow(arrow, nextT, TEMP_NEXT);

      TEMP_DIR.subVectors(TEMP_NEXT, TEMP_POS);
      if (TEMP_DIR.lengthSq() < 1e-6) TEMP_DIR.set(0, 1, 0);
      TEMP_DIR.normalize();
      TEMP_QUAT.setFromUnitVectors(UP_AXIS, TEMP_DIR);

      DUMMY.position.copy(TEMP_POS);
      DUMMY.quaternion.copy(TEMP_QUAT);
      DUMMY.scale.setScalar(1);
      DUMMY.updateMatrix();
      this.root.setMatrixAt(count++, DUMMY.matrix);
    }

    this.root.count = count;
    this.root.instanceMatrix.needsUpdate = true;
    let write = 0;
    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i]!;
      if (arrow.age < arrow.ttl) this.arrows[write++] = arrow;
    }
    this.arrows.length = write;
  }

  private sampleArrow(arrow: ArrowFx, t: number, out: THREE.Vector3): void {
    out.copy(arrow.from).lerp(arrow.to, t);
    out.y += 4 * arrow.arcHeight * t * (1 - t);
  }
}

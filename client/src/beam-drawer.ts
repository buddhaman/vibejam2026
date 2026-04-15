import * as THREE from "three";

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_DIR = new THREE.Vector3();
const TEMP_MID = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const DUMMY = new THREE.Object3D();

type BeamBucket = {
  mesh: THREE.InstancedMesh;
  count: number;
};

export class BeamDrawer {
  public readonly root = new THREE.Group();
  private readonly capacity: number;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly buckets = new Map<number, BeamBucket>();

  public constructor(capacity: number) {
    this.capacity = capacity;
  }

  private getBucket(color: THREE.Color): BeamBucket {
    const key = color.getHex(THREE.SRGBColorSpace);
    let bucket = this.buckets.get(key);
    if (bucket) return bucket;

    const material = new THREE.MeshBasicMaterial({
      color: color.clone(),
      toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(this.geometry, material, this.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.root.add(mesh);
    bucket = { mesh, count: 0 };
    this.buckets.set(key, bucket);
    return bucket;
  }

  public beginFrame(): void {
    for (const bucket of this.buckets.values()) {
      bucket.count = 0;
      bucket.mesh.count = 0;
    }
  }

  public drawBeam(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color): void {
    const bucket = this.getBucket(color);
    if (bucket.count >= this.capacity) return;

    TEMP_DIR.subVectors(to, from);
    const length = TEMP_DIR.length();
    if (length < 1e-4) {
      DUMMY.position.copy(from);
      DUMMY.quaternion.identity();
      DUMMY.scale.set(width, 1e-4, depth);
    } else {
      TEMP_DIR.multiplyScalar(1 / length);
      TEMP_MID.copy(from).add(to).multiplyScalar(0.5);
      TEMP_QUAT.setFromUnitVectors(UP_AXIS, TEMP_DIR);
      DUMMY.position.copy(TEMP_MID);
      DUMMY.quaternion.copy(TEMP_QUAT);
      DUMMY.scale.set(width, length, depth);
    }

    DUMMY.updateMatrix();
    bucket.mesh.setMatrixAt(bucket.count, DUMMY.matrix);
    bucket.count += 1;
    bucket.mesh.count = bucket.count;
  }

  public finishFrame(): void {
    for (const bucket of this.buckets.values()) {
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public getBucketCount(): number {
    return this.buckets.size;
  }
}

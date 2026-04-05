import * as THREE from "three";

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_DIR = new THREE.Vector3();
const TEMP_MID = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const DUMMY = new THREE.Object3D();

export class BeamDrawer {
  public readonly root: THREE.InstancedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private count = 0;

  public constructor(capacity: number) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.01,
    });
    this.root = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, capacity);
    this.root.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.castShadow = true;
    this.root.receiveShadow = true;
    this.root.count = 0;
    this.root.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  }

  public beginFrame(): void {
    this.count = 0;
    this.root.count = 0;
  }

  public drawBeam(from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color): void {
    if (this.count >= this.root.instanceMatrix.count) return;

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
    this.root.setMatrixAt(this.count, DUMMY.matrix);
    this.root.setColorAt(this.count, color);
    this.count += 1;
    this.root.count = this.count;
  }

  public finishFrame(): void {
    this.root.instanceMatrix.needsUpdate = true;
    if (this.root.instanceColor) this.root.instanceColor.needsUpdate = true;
  }
}

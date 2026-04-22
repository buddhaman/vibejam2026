import * as THREE from "three";

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ALT_AXIS = new THREE.Vector3(1, 0, 0);
const TEMP_DIR = new THREE.Vector3();
const TEMP_MID = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const TEMP_PERP_A = new THREE.Vector3();
const TEMP_PERP_B = new THREE.Vector3();
const TEMP_POINT_A = new THREE.Vector3();
const TEMP_POINT_B = new THREE.Vector3();
const TEMP_JITTER = new THREE.Vector3();
const DUMMY = new THREE.Object3D();

function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export class LightningBeamDrawer {
  public readonly root = new THREE.Group();
  private readonly capacity: number;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly seedAttribute: THREE.InstancedBufferAttribute;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;
  private count = 0;

  public constructor(capacity: number) {
    this.capacity = capacity;
    this.seedAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.colorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.geometry.setAttribute("instanceSeed", this.seedAttribute);
    this.geometry.setAttribute("instanceColor", this.colorAttribute);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float instanceSeed;
        attribute vec3 instanceColor;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vSeed;
        varying vec3 vLocal;

        void main() {
          vUv = uv;
          vColor = instanceColor;
          vSeed = instanceSeed;
          vLocal = position;
          vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vSeed;
        varying vec3 vLocal;

        float pulse(float t, float seed) {
          return
            sin(t * 41.0 + uTime * 20.0 + seed * 13.0) * 0.5 +
            sin(t * 89.0 - uTime * 31.0 + seed * 7.0) * 0.3 +
            sin(t * 151.0 + uTime * 47.0 + seed * 17.0) * 0.2;
        }

        void main() {
          float radial = length(vLocal.xz);
          float core = smoothstep(0.16, 0.0, radial);
          float halo = smoothstep(0.48, 0.02, radial);
          float along = clamp(vUv.y, 0.0, 1.0);
          float endFade = pow(max(0.0, sin(along * 3.14159265)), 0.55);
          float flicker = 0.75 + 0.25 * pulse(along, vSeed);
          float alpha = clamp((core * 1.35 + halo * 0.55) * endFade * flicker, 0.0, 1.0);
          if (alpha <= 0.02) discard;

          vec3 color = mix(vColor, vec3(1.0), core * 0.82);
          color += vec3(0.10, 0.24, 0.50) * halo;
          gl_FragColor = vec4(color * (1.3 + halo * 0.85), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.material.defines = { USE_INSTANCING: "" };
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.root.add(this.mesh);
  }

  public beginFrame(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  public drawBeam(
    from: THREE.Vector3,
    to: THREE.Vector3,
    width: number,
    depth: number,
    color: THREE.Color,
    seed = 0
  ): void {
    TEMP_DIR.subVectors(to, from);
    const totalLength = TEMP_DIR.length();
    if (totalLength < 1e-4) return;

    TEMP_DIR.multiplyScalar(1 / totalLength);
    TEMP_PERP_A.crossVectors(Math.abs(TEMP_DIR.y) > 0.92 ? ALT_AXIS : UP_AXIS, TEMP_DIR).normalize();
    TEMP_PERP_B.crossVectors(TEMP_DIR, TEMP_PERP_A).normalize();

    const segments = Math.max(7, Math.min(20, Math.round(totalLength / 5.5)));
    const amplitude = Math.min(totalLength * 0.07, Math.max(width, depth) * 7 + 2.4);
    TEMP_POINT_A.copy(from);

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      TEMP_POINT_B.copy(from).lerp(to, t);
      if (i < segments) {
        const jitterScale = Math.sin(t * Math.PI) * amplitude;
        const jitterA = (hash01(seed + i * 1.37) * 2 - 1) * jitterScale;
        const jitterB = (hash01(seed + i * 2.11 + 19.7) * 2 - 1) * jitterScale * 0.65;
        TEMP_JITTER.copy(TEMP_PERP_A).multiplyScalar(jitterA).addScaledVector(TEMP_PERP_B, jitterB);
        TEMP_POINT_B.add(TEMP_JITTER);
      }
      const taper = 1 - t * 0.45;
      this.addSegment(TEMP_POINT_A, TEMP_POINT_B, Math.max(0.045, width * taper), Math.max(0.035, depth * taper), color, seed + i * 0.73);
      TEMP_POINT_A.copy(TEMP_POINT_B);
    }

    const branchCount = totalLength > 12 ? 2 : 1;
    for (let branch = 0; branch < branchCount; branch++) {
      const t = 0.28 + branch * 0.28 + hash01(seed + branch * 5.9) * 0.1;
      TEMP_POINT_A.copy(from).lerp(to, t);
      const lengthScale = totalLength * (0.12 + hash01(seed + branch * 3.3) * 0.08);
      const sideA = (hash01(seed + branch * 8.1 + 2.0) * 2 - 1) * lengthScale;
      const sideB = (hash01(seed + branch * 9.7 + 5.0) * 2 - 1) * lengthScale * 0.6;
      TEMP_POINT_B.copy(TEMP_POINT_A)
        .addScaledVector(TEMP_PERP_A, sideA)
        .addScaledVector(TEMP_PERP_B, sideB)
        .addScaledVector(TEMP_DIR, -lengthScale * 0.18);
      this.addSegment(TEMP_POINT_A, TEMP_POINT_B, Math.max(0.03, width * 0.42), Math.max(0.025, depth * 0.42), color, seed + 30 + branch * 2.1);
    }
  }

  private addSegment(
    from: THREE.Vector3,
    to: THREE.Vector3,
    width: number,
    depth: number,
    color: THREE.Color,
    seed: number
  ): void {
    if (this.count >= this.capacity) return;
    TEMP_DIR.subVectors(to, from);
    const length = TEMP_DIR.length();
    if (length < 0.03) return;

    TEMP_DIR.multiplyScalar(1 / length);
    TEMP_MID.copy(from).add(to).multiplyScalar(0.5);
    TEMP_QUAT.setFromUnitVectors(UP_AXIS, TEMP_DIR);
    DUMMY.position.copy(TEMP_MID);
    DUMMY.quaternion.copy(TEMP_QUAT);
    DUMMY.scale.set(width, length, depth);
    DUMMY.updateMatrix();
    this.mesh.setMatrixAt(this.count, DUMMY.matrix);
    this.seedAttribute.setX(this.count, seed);
    this.colorAttribute.setXYZ(this.count, color.r, color.g, color.b);
    this.count += 1;
    this.mesh.count = this.count;
  }

  public finishFrame(): void {
    this.material.uniforms.uTime.value = performance.now() * 0.001;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.seedAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }
}

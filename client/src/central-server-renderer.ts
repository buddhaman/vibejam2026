import * as THREE from "three";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { stylizeObjectMaterials } from "./stylized-shading.js";

const GLB_URL = publicAssetUrl("models/buildings/central_server.glb");
const TARGET_HEIGHT = 18.0;

export class CentralServerRenderer {
  public readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private lastOwnerColor: number | null | undefined = undefined;

  async load(): Promise<void> {
    const loader = createGLTFLoader();
    try {
      const gltf = await loader.loadAsync(GLB_URL);
      const root = gltf.scene as THREE.Group;

      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const s = TARGET_HEIGHT / Math.max(size.y, 1e-3);
      root.scale.setScalar(s);
      root.updateMatrixWorld(true);

      const box2 = new THREE.Box3().setFromObject(root);
      root.position.y -= box2.min.y;
      root.updateMatrixWorld(true);

      const box3 = new THREE.Box3().setFromObject(root);
      const center = box3.getCenter(new THREE.Vector3());
      root.position.x -= center.x;
      root.position.z -= center.z;

      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      stylizeObjectMaterials(root);

      this.model = root;
      this.root.add(root);
      // Force tint on first render
      this.lastOwnerColor = undefined;
      this.syncOwner(null);

      console.log("[central-server] GLB loaded OK");
    } catch (err) {
      console.warn("[central-server] Failed to load GLB — no fallback", err);
    }
  }

  /** Call each frame to sit the model on the terrain at world center. */
  syncTerrainY(y: number): void {
    this.root.position.set(0, y, 0);
  }

  /** Tint the model to the owner's team color; null = unowned (neutral, no glow). */
  syncOwner(ownerColor: number | null): void {
    if (!this.model || ownerColor === this.lastOwnerColor) return;
    this.lastOwnerColor = ownerColor;
    this.model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (
          m instanceof THREE.MeshStandardMaterial ||
          m instanceof THREE.MeshPhysicalMaterial
        ) {
          if (ownerColor !== null) {
            m.emissive.setHex(ownerColor);
            m.emissiveIntensity = 0.45;
          } else {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0;
          }
          m.needsUpdate = true;
        }
      }
    });
  }
}

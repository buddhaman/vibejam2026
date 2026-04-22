import * as THREE from "three";
import { publicAssetUrl } from "./asset-url.js";
import { createGLTFLoader } from "./gltf-loader.js";
import { stylizeObjectMaterials } from "./stylized-shading.js";
import {
  applyNeutralTeamColorToObject3D,
  applyTeamColorTexturesToObject3D,
  secondaryTeamHexFromPrimary,
  TEAM_TEX_RECOLOR_APPLIED,
} from "./render-texture-recolor.js";

const GLB_URL = publicAssetUrl("models/buildings/central_server.glb");
const TARGET_HEIGHT = 18.0;

/** Saved original textures per material so we can re-apply from scratch on owner change. */
interface OriginalMaterialMaps {
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  map: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
}

export class CentralServerRenderer {
  public readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private lastOwnerColor: number | null | undefined = undefined;
  private originalMaps: OriginalMaterialMaps[] = [];

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

      // Save original texture references before any recoloring so we can
      // re-apply from scratch whenever the owner changes.
      this.originalMaps = [];
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (
            m instanceof THREE.MeshStandardMaterial ||
            m instanceof THREE.MeshPhysicalMaterial
          ) {
            this.originalMaps.push({
              material: m,
              map: m.map,
              emissiveMap: m.emissiveMap,
            });
          }
        }
      });

      this.model = root;
      this.root.add(root);
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

  /**
   * Recolor the model using the same hue-remap system as buildings and units.
   * null = uncontested → faction-red pixels desaturated to near-white.
   * number = owner team color → faction-red pixels shifted to that hue.
   */
  syncOwner(ownerColor: number | null): void {
    if (!this.model || ownerColor === this.lastOwnerColor) return;
    this.lastOwnerColor = ownerColor;

    // Reset all materials back to their original textures so we can re-apply
    // from scratch (the recolor system caches results and won't re-apply otherwise).
    for (const entry of this.originalMaps) {
      entry.material.map = entry.map;
      entry.material.emissiveMap = entry.emissiveMap;
      delete entry.material.userData[TEAM_TEX_RECOLOR_APPLIED];
      entry.material.needsUpdate = true;
    }

    if (ownerColor === null) {
      // Uncontested: desaturate faction-red pixels → near-white/grey neutral look
      applyNeutralTeamColorToObject3D(this.model);
    } else {
      // Owned: shift faction-red pixels to the owner's team hue
      const secondary = secondaryTeamHexFromPrimary(ownerColor);
      applyTeamColorTexturesToObject3D(this.model, ownerColor, secondary, {
        blueChannelUsesSecondary: false,
      });
    }
  }
}

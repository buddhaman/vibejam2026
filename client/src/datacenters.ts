import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getTileCenter } from "../../shared/game-rules.js";
import type { TileView } from "./terrain.js";

const DATACENTER_GLB = "/models/buildings/datacenter.glb";
/** Visual height after scaling — comparable to medium buildings. */
const DATACENTER_TARGET_HEIGHT = 10.5;

let template: THREE.Group | null = null;

function hash01(tx: number, tz: number, salt: number) {
  const x = Math.sin(tx * 9283.11 + tz * 6899.37 + salt * 0.001) * 43758.5453123;
  return x - Math.floor(x);
}

function fitGroundAndCenterXZ(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxY = Math.max(size.y, 1e-3);
  const s = targetHeight / maxY;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  const center = box3.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
}

export async function ensureDatacenterModelLoaded(): Promise<void> {
  if (template) return;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(DATACENTER_GLB);
    const root = gltf.scene as THREE.Group;
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    fitGroundAndCenterXZ(root, DATACENTER_TARGET_HEIGHT);
    template = root;
    console.log(`[datacenter] GLB loaded OK: ${DATACENTER_GLB} (template meshes after fit)`);
  } catch (err) {
    console.warn(`[datacenter] GLB load FAILED: ${DATACENTER_GLB}`, err);
    template = null;
  }
}

export class DatacenterRenderer {
  public root = new THREE.Group();
  private lastSignature = "";
  private static diagLogged = false;

  public sync(tiles: TileView[]) {
    const signature = tiles.map((t) => `${t.key}:${t.compute}:${t.maxCompute ?? "?"}`).join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    while (this.root.children.length > 0) this.root.remove(this.root.children[0]);
    if (!template) {
      if (!DatacenterRenderer.diagLogged) {
        DatacenterRenderer.diagLogged = true;
        const withMax = tiles.filter((t) => (t.maxCompute ?? 0) > 0).length;
        console.warn(
          `[datacenter] sync skipped: no model template (${DATACENTER_GLB}). Tiles with maxCompute>0: ${withMax}`
        );
      }
      return;
    }

    for (const tile of tiles) {
      const maxC = tile.maxCompute ?? 0;
      const c = tile.compute ?? 0;
      if (tile.isMountain || maxC <= 0 || c <= 0) continue;
      const center = getTileCenter(tile.tx, tile.tz);
      const inst = template.clone(true);
      inst.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      inst.position.set(center.x, tile.height + 0.04, center.z);
      inst.rotation.y = hash01(tile.tx, tile.tz, 6021) * Math.PI * 2;
      const s = 0.92 + hash01(tile.tx, tile.tz, 8811) * 0.14;
      inst.scale.multiplyScalar(s);
      this.root.add(inst);
    }

    if (!DatacenterRenderer.diagLogged) {
      DatacenterRenderer.diagLogged = true;
      const eligible = tiles.filter(
        (t) => !t.isMountain && (t.maxCompute ?? 0) > 0 && (t.compute ?? 0) > 0
      ).length;
      console.log(
        `[datacenter] first sync: glbLoaded=true instances=${this.root.children.length} eligibleTiles=${eligible} (of ${tiles.length} total)`
      );
    }
  }
}

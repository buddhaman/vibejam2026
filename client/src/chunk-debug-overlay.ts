import * as THREE from "three";
import {
  GAME_RULES,
  getAllChunkKeys,
  getWorldChunkCount,
} from "../../shared/game-rules.js";

const LOADED = new THREE.Color(0x00ff9a);
const UNLOADED = new THREE.Color(0xffc247);

function pushLine(
  positions: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  color: THREE.Color
): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

export class ChunkDebugOverlay {
  public readonly root = new THREE.Group();
  private mesh: THREE.LineSegments | null = null;
  private floorMesh: THREE.Mesh | null = null;
  private lastSignature = "";

  public refresh(loadedKeys: ReadonlySet<string>): void {
    const signature = `${loadedKeys.size}:${Array.from(loadedKeys).sort().join("|")}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (this.floorMesh) {
      this.root.remove(this.floorMesh);
      this.floorMesh.geometry.dispose();
      (this.floorMesh.material as THREE.Material).dispose();
      this.floorMesh = null;
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const floorPositions: number[] = [];
    const floorColors: number[] = [];
    const chunkCount = getWorldChunkCount();
    const chunkWorldSize = GAME_RULES.WORLD_CHUNK_TILE_SIZE * GAME_RULES.TILE_SIZE;
    const min = GAME_RULES.WORLD_MIN;
    const y0 = 4.0;
    const y1 = 88.0;

    for (const key of getAllChunkKeys()) {
      const [cx, cz] = key.split(",").map(Number) as [number, number];
      if (cx < 0 || cz < 0 || cx >= chunkCount || cz >= chunkCount) continue;
      const color = loadedKeys.has(key) ? LOADED : UNLOADED;
      const x0 = min + cx * chunkWorldSize;
      const z0 = min + cz * chunkWorldSize;
      const x1 = Math.min(GAME_RULES.WORLD_MAX, x0 + chunkWorldSize);
      const z1 = Math.min(GAME_RULES.WORLD_MAX, z0 + chunkWorldSize);
      const a0 = new THREE.Vector3(x0, y0, z0);
      const b0 = new THREE.Vector3(x1, y0, z0);
      const c0 = new THREE.Vector3(x1, y0, z1);
      const d0 = new THREE.Vector3(x0, y0, z1);
      const a1 = new THREE.Vector3(x0, y1, z0);
      const b1 = new THREE.Vector3(x1, y1, z0);
      const c1 = new THREE.Vector3(x1, y1, z1);
      const d1 = new THREE.Vector3(x0, y1, z1);
      const floorY = y0 + 0.2;
      floorPositions.push(
        x0, floorY, z0,
        x0, floorY, z1,
        x1, floorY, z1,
        x0, floorY, z0,
        x1, floorY, z1,
        x1, floorY, z0
      );
      const fill = loadedKeys.has(key) ? new THREE.Color(0x00e68a) : new THREE.Color(0xffb020);
      for (let i = 0; i < 6; i++) floorColors.push(fill.r, fill.g, fill.b);
      pushLine(positions, colors, a0, b0, color);
      pushLine(positions, colors, b0, c0, color);
      pushLine(positions, colors, c0, d0, color);
      pushLine(positions, colors, d0, a0, color);
      pushLine(positions, colors, a1, b1, color);
      pushLine(positions, colors, b1, c1, color);
      pushLine(positions, colors, c1, d1, color);
      pushLine(positions, colors, d1, a1, color);
      pushLine(positions, colors, a0, a1, color);
      pushLine(positions, colors, b0, b1, color);
      pushLine(positions, colors, c0, c1, color);
      pushLine(positions, colors, d0, d1, color);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    const floorGeometry = new THREE.BufferGeometry();
    floorGeometry.setAttribute("position", new THREE.Float32BufferAttribute(floorPositions, 3));
    floorGeometry.setAttribute("color", new THREE.Float32BufferAttribute(floorColors, 3));
    const floorMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    this.floorMesh.frustumCulled = false;
    this.root.add(this.floorMesh);
  }
}

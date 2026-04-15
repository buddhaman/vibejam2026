import * as THREE from "three";
import { getBuildingRules, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import type { TileView } from "./terrain.js";
import { getTerrainHeightAt } from "./terrain.js";
import { applyStylizedShading } from "./stylized-shading.js";

const GRAVITY = 19;
const DAMPING = 0.992;
const FLOOR_FRICTION = 0.86;
const ANGULAR_DAMPING = 0.982;

type BuildingShard = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  age: number;
  ttl: number;
  settled: boolean;
};

export class BuildingDestructionFxSystem {
  public readonly root = new THREE.Group();
  private shards: BuildingShard[] = [];
  private readonly shardMaterials = [
    applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xe2d3bf, roughness: 0.94, metalness: 0.02 })),
    applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xb39b7a, roughness: 0.92, metalness: 0.04 })),
    applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xcbb9a1, roughness: 0.9, metalness: 0.06 })),
  ];

  public spawn(params: {
    x: number;
    z: number;
    buildingType: BuildingTypeValue;
    teamColor: number;
    tiles: Map<string, TileView>;
  }): void {
    const rules = getBuildingRules(params.buildingType);
    const baseY = getTerrainHeightAt(params.x, params.z, params.tiles);
    const shardCount = Math.max(22, Math.round((rules.selectionWidth + rules.selectionDepth) * 3.4));
    const radiusX = rules.selectionWidth * 0.56;
    const radiusZ = rules.selectionDepth * 0.56;
    const height = Math.max(2.2, rules.height);

    for (let i = 0; i < shardCount; i++) {
      const t = i / Math.max(1, shardCount - 1);
      const angle = t * Math.PI * 2 + Math.random() * 0.5;
      const radial = Math.sqrt(Math.random());
      const px = params.x + Math.cos(angle) * radiusX * radial * 0.72;
      const pz = params.z + Math.sin(angle) * radiusZ * radial * 0.72;
      const py = baseY + Math.random() * height * 0.9 + 0.5;

      const sx = 0.4 + Math.random() * 1.1;
      const sy = 0.35 + Math.random() * 1.25;
      const sz = 0.35 + Math.random() * 1.1;
      const geom = new THREE.BoxGeometry(sx, sy, sz);
      const mat =
        Math.random() < 0.22
          ? applyStylizedShading(new THREE.MeshStandardMaterial({
              color: params.teamColor,
              roughness: 0.84,
              metalness: 0.08,
            }))
          : this.shardMaterials[i % this.shardMaterials.length]!;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(px, py, pz);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.root.add(mesh);

      const outwardX = px - params.x;
      const outwardZ = pz - params.z;
      const outwardLen = Math.hypot(outwardX, outwardZ) || 1;
      const vx = (outwardX / outwardLen) * (3.8 + Math.random() * 5.2) + (Math.random() - 0.5) * 2.4;
      const vy = 7.5 + Math.random() * 7.8;
      const vz = (outwardZ / outwardLen) * (3.8 + Math.random() * 5.2) + (Math.random() - 0.5) * 2.4;

      this.shards.push({
        mesh,
        velocity: new THREE.Vector3(vx, vy, vz),
        angularVelocity: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8
        ),
        age: 0,
        ttl: 12 + Math.random() * 7,
        settled: false,
      });
    }
  }

  public update(dt: number, tiles: Map<string, TileView>): void {
    this.shards = this.shards.filter((shard) => {
      shard.age += dt;
      if (!shard.settled) {
        shard.velocity.y -= GRAVITY * dt;
        shard.velocity.multiplyScalar(DAMPING);
        shard.mesh.position.addScaledVector(shard.velocity, dt);
        shard.mesh.rotation.x += shard.angularVelocity.x * dt;
        shard.mesh.rotation.y += shard.angularVelocity.y * dt;
        shard.mesh.rotation.z += shard.angularVelocity.z * dt;
        shard.angularVelocity.multiplyScalar(ANGULAR_DAMPING);

        const floorY = getTerrainHeightAt(shard.mesh.position.x, shard.mesh.position.z, tiles);
        if (shard.mesh.position.y <= floorY) {
          shard.mesh.position.y = floorY;
          shard.velocity.y = 0;
          shard.velocity.x *= FLOOR_FRICTION;
          shard.velocity.z *= FLOOR_FRICTION;
          shard.angularVelocity.multiplyScalar(0.78);
          if (Math.hypot(shard.velocity.x, shard.velocity.z) < 0.16) {
            shard.settled = true;
          }
        }
      }

      if (shard.age < shard.ttl) return true;
      this.root.remove(shard.mesh);
      shard.mesh.geometry.dispose();
      if (!this.shardMaterials.includes(shard.mesh.material as THREE.MeshStandardMaterial)) {
        (shard.mesh.material as THREE.Material).dispose();
      }
      return false;
    });
  }
}

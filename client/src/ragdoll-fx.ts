import * as THREE from "three";
import { GAME_RULES, UnitType, type UnitType as UnitTypeValue } from "../../shared/game-rules.js";
import { createUnitBodyGeometry } from "./render-geom.js";
import { createPhalanxInstancedMeshes } from "./phalanx-unit-model.js";
import type { TileView } from "./terrain.js";
import { getTerrainHeightAt } from "./terrain.js";

const GRAVITY = 18;
const PARTICLE_DAMPING = 0.992;
const PARTICLE_SUBSTEPS = 2;
const PARTICLE_FLOOR_FRICTION = 0.82;
const DEBRIS_FLOOR_FRICTION = 0.84;
const TORSO_SETTLE_TIME = 13;
const DEBRIS_SETTLE_TIME = 15;
const DEBRIS_ANGULAR_DAMPING = 0.985;
const TORSO_GEOM = createUnitBodyGeometry();
const LEG_GEOM = new THREE.CylinderGeometry(
  GAME_RULES.UNIT_RADIUS * 0.12,
  GAME_RULES.UNIT_RADIUS * 0.16,
  GAME_RULES.UNIT_HEIGHT * 0.62,
  8
);
const SWORD_GEOM = new THREE.BoxGeometry(
  GAME_RULES.UNIT_RADIUS * 0.12,
  GAME_RULES.UNIT_HEIGHT * 0.95,
  GAME_RULES.UNIT_RADIUS * 0.12
);
SWORD_GEOM.translate(0, GAME_RULES.UNIT_HEIGHT * 0.475, 0);
const SHIELD_GEOM = new THREE.CylinderGeometry(
  GAME_RULES.UNIT_RADIUS * 0.42,
  GAME_RULES.UNIT_RADIUS * 0.42,
  GAME_RULES.UNIT_RADIUS * 0.14,
  18
);

type VerletParticle = {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
};

type Stick = {
  a: number;
  b: number;
  length: number;
};

type RagdollFx = {
  root: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  particles: VerletParticle[];
  sticks: Stick[];
  age: number;
  ttl: number;
  torsoScale: number;
};

type DebrisFx = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  age: number;
  ttl: number;
  stuck: boolean;
};

export class RagdollFxSystem {
  public readonly root = new THREE.Group();
  private ragdolls: RagdollFx[] = [];
  private debris: DebrisFx[] = [];
  private readonly torsoMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7a079,
    roughness: 0.85,
    metalness: 0.05,
  });
  private readonly torsoParts: THREE.InstancedMesh[];
  private readonly legMaterial = new THREE.MeshStandardMaterial({
    color: 0x181818,
    roughness: 0.95,
    metalness: 0.02,
  });
  private readonly swordMaterial = new THREE.MeshStandardMaterial({
    color: 0xd0d4dc,
    roughness: 0.5,
    metalness: 0.45,
  });

  public constructor() {
    const loadedParts = createPhalanxInstancedMeshes(512);
    this.torsoParts =
      loadedParts.length > 0
        ? loadedParts
        : [new THREE.InstancedMesh(TORSO_GEOM, this.torsoMaterial.clone(), 512)];
    for (const mesh of this.torsoParts) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.root.add(mesh);
    }
  }

  public spawnDeathFx(params: {
    x: number;
    z: number;
    dirX: number;
    dirZ: number;
    teamColor: number;
    unitType: UnitTypeValue;
    tiles: Map<string, TileView>;
  }): void {
    const baseY = getTerrainHeightAt(params.x, params.z, params.tiles);
    const dirLen = Math.hypot(params.dirX, params.dirZ) || 1;
    const dirX = params.dirX / dirLen;
    const dirZ = params.dirZ / dirLen;
    const sideX = -dirZ;
    const sideZ = dirX;
    const impulse = 4.8 + Math.random() * 2.6;
    const upward = 6.8 + Math.random() * 2.5;

    const particles: VerletParticle[] = [
      this.makeParticle(params.x, baseY + GAME_RULES.UNIT_HEIGHT * 0.72, params.z, dirX * impulse, upward, dirZ * impulse),
      this.makeParticle(
        params.x + sideX * GAME_RULES.UNIT_RADIUS * 0.22,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.42,
        params.z + sideZ * GAME_RULES.UNIT_RADIUS * 0.22,
        dirX * impulse * 0.9,
        upward * 0.6,
        dirZ * impulse * 0.9
      ),
      this.makeParticle(
        params.x - sideX * GAME_RULES.UNIT_RADIUS * 0.22,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.42,
        params.z - sideZ * GAME_RULES.UNIT_RADIUS * 0.22,
        dirX * impulse * 0.85,
        upward * 0.55,
        dirZ * impulse * 0.85
      ),
      this.makeParticle(
        params.x + sideX * GAME_RULES.UNIT_RADIUS * 0.18,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.1,
        params.z + sideZ * GAME_RULES.UNIT_RADIUS * 0.18,
        dirX * impulse * 1.05,
        upward * 0.25,
        dirZ * impulse * 1.05
      ),
      this.makeParticle(
        params.x - sideX * GAME_RULES.UNIT_RADIUS * 0.18,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.1,
        params.z - sideZ * GAME_RULES.UNIT_RADIUS * 0.18,
        dirX * impulse,
        upward * 0.2,
        dirZ * impulse
      ),
    ];

    const root = new THREE.Group();
    const leftLeg = new THREE.Mesh(LEG_GEOM, this.legMaterial);
    const rightLeg = new THREE.Mesh(LEG_GEOM, this.legMaterial);
    leftLeg.castShadow = rightLeg.castShadow = true;
    root.add(leftLeg, rightLeg);
    this.root.add(root);

    this.ragdolls.push({
      root,
      leftLeg,
      rightLeg,
      particles,
      sticks: [
        this.makeStick(particles, 0, 1),
        this.makeStick(particles, 0, 2),
        this.makeStick(particles, 1, 2),
        this.makeStick(particles, 1, 3),
        this.makeStick(particles, 2, 4),
      ],
      age: 0,
      ttl: TORSO_SETTLE_TIME + Math.random() * 2,
      torsoScale: params.unitType === UnitType.VILLAGER ? 0.82 : 1,
    });

    if (params.unitType !== UnitType.VILLAGER) {
      this.spawnDebris(
        params.x,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.85,
        params.z,
        dirX,
        dirZ,
        params.teamColor,
        "shield"
      );
      this.spawnDebris(
        params.x,
        baseY + GAME_RULES.UNIT_HEIGHT * 0.9,
        params.z,
        dirX,
        dirZ,
        params.teamColor,
        "sword"
      );
    }
  }

  public update(dt: number, tiles: Map<string, TileView>): void {
    const stepDt = dt / PARTICLE_SUBSTEPS;
    for (const ragdoll of this.ragdolls) {
      ragdoll.age += dt;
      for (let i = 0; i < PARTICLE_SUBSTEPS; i++) {
        this.integrateRagdoll(ragdoll, stepDt, tiles);
      }
      ragdoll.root.visible = ragdoll.age < ragdoll.ttl;
    }
    this.ragdolls = this.ragdolls.filter((ragdoll) => {
      if (ragdoll.age < ragdoll.ttl) return true;
      this.root.remove(ragdoll.root);
      return false;
    });
    for (const mesh of this.torsoParts) mesh.count = this.ragdolls.length;
    for (let i = 0; i < this.ragdolls.length; i++) {
      this.renderRagdoll(this.ragdolls[i]!, i);
    }
    for (const mesh of this.torsoParts) {
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (const debris of this.debris) {
      debris.age += dt;
      if (!debris.stuck) {
        debris.velocity.y -= GRAVITY * dt;
        debris.mesh.position.addScaledVector(debris.velocity, dt);
        debris.mesh.rotation.x += debris.angularVelocity.x * dt;
        debris.mesh.rotation.y += debris.angularVelocity.y * dt;
        debris.mesh.rotation.z += debris.angularVelocity.z * dt;
        debris.angularVelocity.multiplyScalar(Math.pow(DEBRIS_ANGULAR_DAMPING, dt * 60));

        const floorY = getTerrainHeightAt(debris.mesh.position.x, debris.mesh.position.z, tiles);
        if (debris.mesh.position.y <= floorY + 0.03) {
          debris.mesh.position.y = floorY + 0.03;
          debris.velocity.x *= DEBRIS_FLOOR_FRICTION;
          debris.velocity.z *= DEBRIS_FLOOR_FRICTION;
          debris.velocity.y *= -0.08;
          if (debris.velocity.lengthSq() < 1.2) {
            debris.stuck = true;
          } else {
            debris.velocity.y = Math.abs(debris.velocity.y) * 0.12;
          }
        }
      }
    }
    this.debris = this.debris.filter((debris) => {
      if (debris.age < debris.ttl) return true;
      this.root.remove(debris.mesh);
      return false;
    });
  }

  private makeParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number): VerletParticle {
    const pos = new THREE.Vector3(x, y, z);
    return {
      pos,
      prev: pos.clone().sub(new THREE.Vector3(vx, vy, vz).multiplyScalar(1 / 60)),
    };
  }

  private makeStick(particles: VerletParticle[], a: number, b: number): Stick {
    return {
      a,
      b,
      length: particles[a]!.pos.distanceTo(particles[b]!.pos),
    };
  }

  private integrateRagdoll(ragdoll: RagdollFx, dt: number, tiles: Map<string, TileView>): void {
    for (const particle of ragdoll.particles) {
      const nextX = particle.pos.x + (particle.pos.x - particle.prev.x) * PARTICLE_DAMPING;
      const nextY = particle.pos.y + (particle.pos.y - particle.prev.y) * PARTICLE_DAMPING - GRAVITY * dt * dt;
      const nextZ = particle.pos.z + (particle.pos.z - particle.prev.z) * PARTICLE_DAMPING;
      particle.prev.copy(particle.pos);
      particle.pos.set(nextX, nextY, nextZ);
    }

    for (let iter = 0; iter < 2; iter++) {
      for (const stick of ragdoll.sticks) {
        const a = ragdoll.particles[stick.a]!;
        const b = ragdoll.particles[stick.b]!;
        const delta = TEMP_DELTA.subVectors(b.pos, a.pos);
        let dist = delta.length();
        if (dist < 1e-5) dist = 1e-5;
        const diff = (dist - stick.length) / dist * 0.5;
        a.pos.addScaledVector(delta, diff);
        b.pos.addScaledVector(delta, -diff);
      }

      for (const particle of ragdoll.particles) {
        const floorY = getTerrainHeightAt(particle.pos.x, particle.pos.z, tiles);
        if (particle.pos.y < floorY) {
          particle.pos.y = floorY;
          particle.prev.x = particle.pos.x - (particle.pos.x - particle.prev.x) * PARTICLE_FLOOR_FRICTION;
          particle.prev.z = particle.pos.z - (particle.pos.z - particle.prev.z) * PARTICLE_FLOOR_FRICTION;
          particle.prev.y = particle.pos.y;
        }
      }
    }
  }

  private renderRagdoll(ragdoll: RagdollFx, index: number): void {
    const body = ragdoll.particles[0]!;
    const hipL = ragdoll.particles[1]!;
    const hipR = ragdoll.particles[2]!;
    const footL = ragdoll.particles[3]!;
    const footR = ragdoll.particles[4]!;
    const hipMid = TEMP_HIP.copy(hipL.pos).add(hipR.pos).multiplyScalar(0.5);
    const down = TEMP_DOWN.subVectors(hipMid, body.pos).normalize();
    const forward = TEMP_FORWARD.subVectors(body.pos, body.prev).setY(0);
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, 1);
    forward.normalize();
    const side = TEMP_SIDE.crossVectors(forward, down).normalize();
    forward.crossVectors(down, side).normalize();
    const basis = TEMP_MATRIX.makeBasis(side, down.clone().negate(), forward);
    TEMP_OBJECT.position.copy(body.pos);
    TEMP_OBJECT.setRotationFromMatrix(basis);
    TEMP_OBJECT.scale.setScalar(ragdoll.torsoScale);
    TEMP_OBJECT.updateMatrix();
    for (const mesh of this.torsoParts) {
      mesh.setMatrixAt(index, TEMP_OBJECT.matrix);
    }

    this.placeLeg(ragdoll.leftLeg, hipL.pos, footL.pos);
    this.placeLeg(ragdoll.rightLeg, hipR.pos, footR.pos);
  }

  private placeLeg(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const mid = TEMP_MID.copy(a).add(b).multiplyScalar(0.5);
    const dir = TEMP_DIR.subVectors(b, a);
    const length = Math.max(0.01, dir.length());
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(UP_AXIS, dir.normalize());
    mesh.scale.set(1, length / (GAME_RULES.UNIT_HEIGHT * 0.62), 1);
  }

  private spawnDebris(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    teamColor: number,
    type: "sword" | "shield"
  ): void {
    const mesh = new THREE.Mesh(
      type === "shield" ? SHIELD_GEOM : SWORD_GEOM,
      type === "shield"
        ? new THREE.MeshStandardMaterial({
            color: teamColor,
            roughness: 0.62,
            metalness: 0.18,
          })
        : this.swordMaterial
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    this.debris.push({
      mesh,
      velocity: new THREE.Vector3(
        dirX * (3.5 + Math.random() * 2.8) + (Math.random() - 0.5) * 2,
        4.5 + Math.random() * 3,
        dirZ * (3.5 + Math.random() * 2.8) + (Math.random() - 0.5) * 2
      ),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      ),
      age: 0,
      ttl: DEBRIS_SETTLE_TIME + Math.random() * 3,
      stuck: false,
    });
  }
}

const TEMP_DELTA = new THREE.Vector3();
const TEMP_HIP = new THREE.Vector3();
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_SIDE = new THREE.Vector3();
const TEMP_DOWN = new THREE.Vector3();
const TEMP_MID = new THREE.Vector3();
const TEMP_DIR = new THREE.Vector3();
const TEMP_MATRIX = new THREE.Matrix4();
const TEMP_OBJECT = new THREE.Object3D();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

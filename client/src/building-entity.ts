import * as THREE from "three";
import {
  BuildingType,
  GAME_RULES,
  canAfford,
  getBuildingRules,
  getUnitRules,
  getUnitTrainCost,
  getUnitTrainTimeMs,
  type BuildingType as BuildingTypeValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { getTerrainHeightAt } from "./terrain.js";
import { getBuildingModelAssetVersion, instantiateBuildingVariant } from "./building-model-registry.js";
import type { BuildingVariant } from "./building-visuals.js";
import {
  applyTeamColorTexturesToObject3D,
  secondaryTeamHexFromPrimary,
} from "./render-texture-recolor.js";
import {
  createSelectionOutlineClone,
  getBrightTeamSelectionColor,
  setSelectionOutlineColor,
} from "./selection-outline.js";
import {
  applySelectionRingScreenThickness,
  createSelectionFillMaterial,
  createSelectionRingMaterial,
} from "./selection-ring.js";

const ORB_RADIUS = 0.525;
const ORB_Y_ABOVE_ROOF = 1.55;
const TOWER_LIGHTNING_Y = 17.4;
const TOWER_LIGHTNING_CORE_WIDTH = 0.18;
const TOWER_LIGHTNING_GLOW_WIDTH = 0.52;
const TOWER_LIGHTNING_SEGMENT_LENGTH = 5.5;
const TOWER_LIGHTNING_JITTER = 2.8;
const DUMMY = new THREE.Object3D();
const FARM_UP = new THREE.Vector3(0, 1, 0);
const FARM_BASE = new THREE.Vector3();
const FARM_TOP = new THREE.Vector3();
const FARM_START = new THREE.Vector3();
const FARM_END = new THREE.Vector3();
const FARM_DIR = new THREE.Vector3();
const FARM_QUAT = new THREE.Quaternion();
const FARM_RADIAL = new THREE.Vector3();
const FARM_SIDE = new THREE.Vector3();
const TOWER_BEAM_START = new THREE.Vector3();
const TOWER_BEAM_END = new THREE.Vector3();
const TOWER_PATH_POINT = new THREE.Vector3();
const TOWER_PREV_POINT = new THREE.Vector3();
const TOWER_NEXT_POINT = new THREE.Vector3();
const TOWER_DIR = new THREE.Vector3();
const TOWER_PERP_A = new THREE.Vector3();
const TOWER_PERP_B = new THREE.Vector3();
const TOWER_CORE_COLOR = new THREE.Color();
const TOWER_GLOW_COLOR = new THREE.Color();
const TOWER_ELECTRIC_BASE = new THREE.Color(0xb8f3ff);
const TOWER_WHITE = new THREE.Color(0xffffff);
const TOWER_ELECTRIC_GLOW = new THREE.Color(0x49a6ff);
const TOWER_ALT_AXIS = new THREE.Vector3(1, 0, 0);
const UNIT_TRAIN_TIME_MULTIPLIER = import.meta.env.DEV ? 0.1 : GAME_RULES.UNIT_TRAIN_TIME_MULTIPLIER;
const BUILDING_SELECTION_OUTLINE_SCALE = 1.1;
const BUILDING_SELECTION_OUTLINE_COLOR = new THREE.Color();
const BUILDING_SELECTION_RING_GEOM = new THREE.RingGeometry(0.92, 1, 72);
const BUILDING_SELECTION_FILL_GEOM = new THREE.CircleGeometry(1, 56);
const BUILDING_SELECTION_RING_THICKNESS_PX = 4;
const BUILDING_SELECTION_RING_MIN_THICKNESS_WORLD = 0.025;
const SPAWN_POINT_MARKER_RADIUS = 0.5;
const SPAWN_POINT_MIN_THICKNESS_WORLD = 0.025;
const SPAWN_POINT_OFFSET_Y = 0.25;
const SPAWN_POINT_MIN_DISTANCE = 0.6;
const SPAWN_POINT_DASH_WORLD = 1.4;
const SPAWN_POINT_GAP_WORLD = 1.1;
const BUILDING_CENTER = new THREE.Vector3();
const SPAWN_POINT_WORLD = new THREE.Vector3();
const SPAWN_LINE_START = new THREE.Vector3();
const SPAWN_LINE_END = new THREE.Vector3();
const SPAWN_SEGMENT_START = new THREE.Vector3();
const SPAWN_SEGMENT_END = new THREE.Vector3();

function getEffectiveUnitTrainTimeMs(unitType: UnitTypeValue): number {
  return Math.max(1, Math.ceil(getUnitTrainTimeMs(unitType) * UNIT_TRAIN_TIME_MULTIPLIER));
}

export class BuildingEntity extends Entity {
  /** Cloned only for the one building type this entity actually uses. Set after first sync(). */
  private variant: BuildingVariant | null = null;
  private variantType: BuildingTypeValue | null = null;
  private variantAssetVersion = -1;
  /** Owner palette currently baked into the cloned variant materials. */
  private tintedOwnerId: string | null = null;
  /** Single unlit sphere — full-brightness player palette color. */
  private ownerOrb!: THREE.Mesh;
  private ownerOrbMaterial!: THREE.MeshBasicMaterial;
  private selectionOutline: THREE.Object3D | null = null;
  private selectionRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private selectionFill!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private spawnPointMarker!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private localAge = 0;

  private building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
    productionQueue: UnitTypeValue[];
    productionProgressMs: number;
    farmGrowth: number;
    attackTargetBlobId: string;
    rallySet: number;
    rallyX: number;
    rallyY: number;
  } | null = null;

  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected createMesh(): THREE.Group {
    const root = new THREE.Group();
    // Variant is NOT cloned here — we don’t know the building type yet.
    // It is cloned lazily in sync() via setTimeout so it doesn’t block the Colyseus callback frame.
    this.ownerOrbMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ownerOrb = new THREE.Mesh(new THREE.SphereGeometry(ORB_RADIUS, 32, 26), this.ownerOrbMaterial);
    this.ownerOrb.castShadow = true;
    this.selectionFill = new THREE.Mesh(
      BUILDING_SELECTION_FILL_GEOM,
      createSelectionFillMaterial()
    );
    this.selectionFill.rotation.x = -Math.PI / 2;
    this.selectionFill.position.y = 0.14;
    this.selectionFill.renderOrder = 1002;
    this.selectionRing = new THREE.Mesh(
      BUILDING_SELECTION_RING_GEOM,
      createSelectionRingMaterial()
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.18;
    this.selectionRing.renderOrder = 1003;
    this.spawnPointMarker = new THREE.Mesh(
      new THREE.SphereGeometry(SPAWN_POINT_MARKER_RADIUS, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    this.spawnPointMarker.visible = false;
    this.spawnPointMarker.renderOrder = 1004;
    root.add(this.ownerOrb);
    root.add(this.selectionFill);
    root.add(this.selectionRing);
    root.add(this.spawnPointMarker);
    return root;
  }

  public sync(building: {
    x: number;
    y: number;
    buildingType: BuildingTypeValue;
    health: number;
    ownerId: string;
    productionQueue: ArrayLike<UnitTypeValue>;
    productionProgressMs: number;
    farmGrowth: number;
    attackTargetBlobId: string;
    rallySet?: number;
    rallyX?: number;
    rallyY?: number;
  }): void {
    const firstSync = this.building === null;
    const previousOwnerId = this.building?.ownerId ?? null;
    this.building = {
      ...building,
      productionQueue: Array.from(building.productionQueue ?? []),
      rallySet: building.rallySet ?? 0,
      rallyX: building.rallyX ?? 0,
      rallyY: building.rallyY ?? 0,
    };
    const ownerChanged = previousOwnerId !== null && previousOwnerId !== this.building.ownerId;
    if (this.tintedOwnerId !== this.building.ownerId) {
      this.tintedOwnerId = null;
    }

    // Defer the clone to the next event-loop turn so it doesn’t stall the Colyseus schema callback.
    if (firstSync) {
      const type = building.buildingType;
      setTimeout(() => {
        if (this.isStale()) return; // building already destroyed before clone finished
        this.replaceVariant(type);
      }, 0);
    } else if (ownerChanged && this.variant) {
      this.replaceVariant(this.building.buildingType);
    } else if (this.variant && this.variantType === this.building.buildingType) {
      this.applyVariantTeamTintIfNeeded();
    }
  }

  private applyVariantTeamTintIfNeeded(): void {
    if (!this.variant || !this.building) return;
    const ownerId = this.building.ownerId;
    if (!ownerId || this.tintedOwnerId === ownerId) return;
    const playerHex = this.game.getPlayerColor(ownerId);
    const secondary = secondaryTeamHexFromPrimary(playerHex);
    applyTeamColorTexturesToObject3D(this.variant.root, playerHex, secondary, {
      blueChannelUsesSecondary: false,
    });
    this.tintedOwnerId = ownerId;
  }

  public getBuildingType(): BuildingTypeValue | null {
    return this.building?.buildingType ?? null;
  }

  public override getSelectionOutlineObjects(): THREE.Object3D[] {
    return this.variant ? [this.variant.root] : [this.mesh];
  }

  public render(_dt: number): void {
    if (!this.building) return;
    const visibleToMe =
      this.building.ownerId === this.game.room.sessionId ||
      this.game.isWorldVisibleToMe(this.building.x, this.building.y);
    this.mesh.visible = visibleToMe;
    if (!visibleToMe) return;
    if (
      !this.variant ||
      this.variantType !== this.building.buildingType ||
      this.variantAssetVersion !== getBuildingModelAssetVersion()
    ) {
      this.replaceVariant(this.building.buildingType);
    }
    if (!this.variant) return;
    this.localAge += _dt;

    const terrainY = getTerrainHeightAt(
      this.building.x,
      this.building.y,
      this.game.getTiles()
    );

    const rules = getBuildingRules(this.building.buildingType);
    const playerHex = this.game.getPlayerColor(this.building.ownerId);
    this.ownerOrbMaterial.color.setHex(playerHex);
    this.ownerOrb.position.set(0, rules.height + ORB_Y_ABOVE_ROOF, 0);
    const selected = this.game.selectedEntityId === this.id;
    const selectionColor = getBrightTeamSelectionColor(playerHex);
    const ringScaleX = rules.selectionWidth * 0.64;
    const ringScaleZ = rules.selectionDepth * 0.64;
    this.selectionFill.scale.set(ringScaleX, ringScaleZ, 1);
    applySelectionRingScreenThickness(
      this.selectionRing,
      ringScaleX * BUILDING_SELECTION_OUTLINE_SCALE,
      ringScaleZ * BUILDING_SELECTION_OUTLINE_SCALE,
      this.game.getOrbitWorldUnitsPerScreenPixel(),
      BUILDING_SELECTION_RING_THICKNESS_PX,
      BUILDING_SELECTION_RING_MIN_THICKNESS_WORLD
    );
    this.selectionFill.visible = selected;
    this.selectionRing.visible = selected;
    this.selectionFill.material.color.copy(selectionColor);
    this.selectionRing.material.color.copy(selectionColor);
    this.selectionFill.material.opacity = 0;
    this.selectionRing.material.opacity = selected ? 1 : 0;
    if (this.selectionOutline) {
      BUILDING_SELECTION_OUTLINE_COLOR.copy(selectionColor);
      setSelectionOutlineColor(this.selectionOutline, BUILDING_SELECTION_OUTLINE_COLOR);
      this.selectionOutline.visible = false;
    }

    this.mesh.position.set(this.building.x, terrainY, this.building.y);
    if (this.building.buildingType === BuildingType.FARM) {
      this.updateFarmGrowth();
    } else if (this.building.buildingType === BuildingType.TOWER) {
      this.renderTowerLightning(terrainY);
    }
    this.renderSpawnPointGuide(terrainY, selected, selectionColor);
  }

  private replaceVariant(type: BuildingTypeValue): void {
    if (this.selectionOutline) {
      this.mesh.remove(this.selectionOutline);
      this.selectionOutline = null;
    }
    if (this.variant) {
      this.mesh.remove(this.variant.root);
    }
    this.variant = instantiateBuildingVariant(type);
    this.variant.root.traverse((child) => {
      if (child instanceof THREE.Mesh) child.renderOrder = 2;
    });
    this.variantType = type;
    this.variantAssetVersion = getBuildingModelAssetVersion();
    this.tintedOwnerId = null;
    this.selectionOutline = createSelectionOutlineClone(this.variant.root, BUILDING_SELECTION_OUTLINE_SCALE);
    this.selectionOutline.visible = false;
    this.mesh.add(this.selectionOutline);
    this.mesh.add(this.variant.root);
    this.applyVariantTeamTintIfNeeded();
  }

  private renderTowerLightning(terrainY: number): void {
    if (!this.building?.attackTargetBlobId) return;
    const target = this.game.findBlobEntity(this.building.attackTargetBlobId);
    if (!target) return;
    const targetCenter = target.getPredictedWorldCenter();
    const targetTerrainY = getTerrainHeightAt(targetCenter.x, targetCenter.z, this.game.getTiles());
    const playerHex = this.game.getPlayerColor(this.building.ownerId);
    TOWER_CORE_COLOR.setHex(playerHex).lerp(TOWER_ELECTRIC_BASE, 0.84);
    TOWER_GLOW_COLOR.copy(TOWER_ELECTRIC_GLOW).lerp(TOWER_CORE_COLOR, 0.45);

    TOWER_BEAM_START.set(this.building.x, terrainY + TOWER_LIGHTNING_Y, this.building.y);
    TOWER_BEAM_END.set(targetCenter.x, targetTerrainY + GAME_RULES.UNIT_HEIGHT * 0.65, targetCenter.z);

    const seedBase = this.hashBeamSeed(this.building.attackTargetBlobId);
    const snapFrame = Math.floor(performance.now() / 45);
    this.drawLightningPath(TOWER_BEAM_START, TOWER_BEAM_END, seedBase + snapFrame * 19.7, TOWER_CORE_COLOR, TOWER_GLOW_COLOR, 1);
    this.drawLightningPath(TOWER_BEAM_START, TOWER_BEAM_END, seedBase + 77.3 + snapFrame * 23.1, TOWER_WHITE, TOWER_GLOW_COLOR, 0.62);
  }

  private drawLightningPath(
    from: THREE.Vector3,
    to: THREE.Vector3,
    seed: number,
    coreColor: THREE.Color,
    glowColor: THREE.Color,
    thicknessScale: number
  ): void {
    TOWER_DIR.subVectors(to, from);
    const length = TOWER_DIR.length();
    if (length < 0.01) return;
    TOWER_DIR.multiplyScalar(1 / length);
    TOWER_PERP_A.crossVectors(Math.abs(TOWER_DIR.y) > 0.92 ? TOWER_ALT_AXIS : FARM_UP, TOWER_DIR).normalize();
    TOWER_PERP_B.crossVectors(TOWER_DIR, TOWER_PERP_A).normalize();

    const segments = Math.max(5, Math.min(20, Math.round(length / TOWER_LIGHTNING_SEGMENT_LENGTH)));
    const amplitude = Math.min(length * 0.08, TOWER_LIGHTNING_JITTER * thicknessScale + length * 0.02);
    TOWER_PREV_POINT.copy(from);

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      TOWER_NEXT_POINT.copy(from).lerp(to, t);
      if (i < segments) {
        const envelope = Math.sin(t * Math.PI);
        const jitterA = this.hashNoise(seed + i * 1.37 + t * 13.1) * amplitude * envelope;
        const jitterB = this.hashNoise(seed + i * 2.11 + t * 17.3) * amplitude * 0.55 * envelope;
        TOWER_PATH_POINT.copy(TOWER_PERP_A).multiplyScalar(jitterA).addScaledVector(TOWER_PERP_B, jitterB);
        TOWER_NEXT_POINT.add(TOWER_PATH_POINT);
      }
      const taper = 1 - t * 0.28;
      const glow = TOWER_LIGHTNING_GLOW_WIDTH * thicknessScale * taper;
      const core = TOWER_LIGHTNING_CORE_WIDTH * thicknessScale * taper;
      this.game.drawBrightBeam(TOWER_PREV_POINT, TOWER_NEXT_POINT, glow, glow * 0.82, glowColor);
      this.game.drawBrightBeam(TOWER_PREV_POINT, TOWER_NEXT_POINT, core, core * 0.8, coreColor);
      TOWER_PREV_POINT.copy(TOWER_NEXT_POINT);
    }
  }

  private hashBeamSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 1000;
  }

  private hashNoise(seed: number): number {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return (value - Math.floor(value)) * 2 - 1;
  }

  private updateFarmGrowth(): void {
    if (!this.variant) return;
    const growthT = THREE.MathUtils.clamp(this.building?.farmGrowth ?? 0, 0, 1);
    const eased = 1 - Math.pow(1 - growthT, 2.1);
    const motion = Math.max(0, 1 - growthT);
    const stemMesh = this.variant.root.getObjectByName("farm_stems") as THREE.InstancedMesh | null;
    const leavesA = this.variant.root.getObjectByName("farm_leaves_a") as THREE.InstancedMesh | null;
    const leavesB = this.variant.root.getObjectByName("farm_leaves_b") as THREE.InstancedMesh | null;
    const slots = (stemMesh?.userData.farmSlots as Array<{ x: number; z: number; yaw: number; jitter: number }> | undefined) ?? [];
    if (!stemMesh || !leavesA || !leavesB || slots.length === 0) return;

    const stemHeight = 1.9 + eased * 3.3;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const swayX = Math.sin(this.localAge * 8.2 + slot.jitter * 1.7) * 0.34 * motion;
      const swayZ = Math.cos(this.localAge * 7.8 + slot.jitter * 1.3) * 0.34 * motion;
      FARM_BASE.set(slot.x, 0.06, slot.z);
      FARM_TOP.set(slot.x + swayX, 0.06 + stemHeight * eased, slot.z + swayZ);
      this.setFarmBeamMatrix(FARM_BASE, FARM_TOP, 0.92 + eased * 0.16, stemMesh, i);

      FARM_DIR.subVectors(FARM_TOP, FARM_BASE).normalize();
      FARM_RADIAL.set(Math.cos(slot.yaw), 0, Math.sin(slot.yaw));
      FARM_SIDE.set(-Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
      const leafJitter = Math.sin(this.localAge * 5.8 + slot.jitter * 1.2) * 0.08 * motion;
      const leafLength = eased * 1.95;
      const leafThickness = Math.max(0.02, eased * 0.4);

      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.36, leafLength, leafThickness, 0.18, leafJitter, leavesA, i * 2);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.48, leafLength * 0.92, leafThickness * 0.94, -0.34, -leafJitter * 0.7, leavesA, i * 2 + 1);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.62, leafLength * 0.98, leafThickness, Math.PI + 0.22, leafJitter * 0.85, leavesB, i * 2);
      this.setFarmLeafSegment(FARM_BASE, FARM_TOP, FARM_RADIAL, FARM_SIDE, 0.74, leafLength * 0.88, leafThickness * 0.9, Math.PI - 0.4, -leafJitter * 0.5, leavesB, i * 2 + 1);
    }

    stemMesh.count = slots.length;
    leavesA.count = slots.length * 2;
    leavesB.count = slots.length * 2;
    stemMesh.instanceMatrix.needsUpdate = true;
    leavesA.instanceMatrix.needsUpdate = true;
    leavesB.instanceMatrix.needsUpdate = true;
  }

  private renderSpawnPointGuide(terrainY: number, selected: boolean, selectionColor: THREE.Color): void {
    if (!this.building) return;
    const rules = getBuildingRules(this.building.buildingType);
    if (rules.producibleUnits.length === 0 || !this.isOwnedByMe() || !selected) {
      this.spawnPointMarker.visible = false;
      return;
    }
    const spawnX = this.building.rallyX;
    const spawnZ = this.building.rallyY;
    const spawnY = getTerrainHeightAt(spawnX, spawnZ, this.game.getTiles()) + SPAWN_POINT_OFFSET_Y;

    this.spawnPointMarker.visible = true;
    this.spawnPointMarker.material.color.copy(selectionColor);
    this.spawnPointMarker.position.set(
      spawnX - this.building.x,
      spawnY - terrainY,
      spawnZ - this.building.y
    );

    BUILDING_CENTER.set(this.building.x, terrainY + SPAWN_POINT_OFFSET_Y, this.building.y);
    SPAWN_POINT_WORLD.set(spawnX, spawnY, spawnZ);
    if (BUILDING_CENTER.distanceToSquared(SPAWN_POINT_WORLD) < SPAWN_POINT_MIN_DISTANCE * SPAWN_POINT_MIN_DISTANCE) {
      return;
    }
    const lineThickness = Math.max(
      SPAWN_POINT_MIN_THICKNESS_WORLD,
      this.game.getOrbitWorldUnitsPerScreenPixel() * BUILDING_SELECTION_RING_THICKNESS_PX
    );
    const totalDistance = Math.sqrt(BUILDING_CENTER.distanceToSquared(SPAWN_POINT_WORLD));
    const cycle = SPAWN_POINT_DASH_WORLD + SPAWN_POINT_GAP_WORLD;
    const dashCount = Math.max(1, Math.ceil(totalDistance / cycle));
    for (let i = 0; i < dashCount; i++) {
      const dashStartDist = i * cycle;
      const dashEndDist = Math.min(totalDistance, dashStartDist + SPAWN_POINT_DASH_WORLD);
      if (dashEndDist <= dashStartDist) continue;
      const t0 = dashStartDist / totalDistance;
      const t1 = dashEndDist / totalDistance;
      SPAWN_SEGMENT_START.lerpVectors(BUILDING_CENTER, SPAWN_POINT_WORLD, t0);
      SPAWN_SEGMENT_END.lerpVectors(BUILDING_CENTER, SPAWN_POINT_WORLD, t1);
      this.game.drawBrightBeam(
        SPAWN_SEGMENT_START,
        SPAWN_SEGMENT_END,
        lineThickness,
        lineThickness * 0.8,
        selectionColor
      );
    }
  }

  private setFarmBeamMatrix(
    start: THREE.Vector3,
    end: THREE.Vector3,
    thickness: number,
    mesh: THREE.InstancedMesh,
    index: number
  ): void {
    FARM_DIR.subVectors(end, start);
    const length = Math.max(0.001, FARM_DIR.length());
    FARM_DIR.divideScalar(length);
    FARM_QUAT.setFromUnitVectors(FARM_UP, FARM_DIR);
    DUMMY.position.copy(start);
    DUMMY.quaternion.copy(FARM_QUAT);
    DUMMY.scale.set(thickness, length, thickness * 0.78);
    DUMMY.updateMatrix();
    mesh.setMatrixAt(index, DUMMY.matrix);
  }

  private setFarmLeafSegment(
    stemBase: THREE.Vector3,
    stemTop: THREE.Vector3,
    radial: THREE.Vector3,
    side: THREE.Vector3,
    alongT: number,
    length: number,
    thickness: number,
    angle: number,
    jitter: number,
    mesh: THREE.InstancedMesh,
    index: number
  ): void {
    if (length <= 0.001 || thickness <= 0.001) {
      DUMMY.scale.set(0.0001, 0.0001, 0.0001);
      DUMMY.position.copy(stemBase);
      DUMMY.rotation.set(0, 0, 0);
      DUMMY.updateMatrix();
      mesh.setMatrixAt(index, DUMMY.matrix);
      return;
    }
    FARM_START.copy(stemBase).lerp(stemTop, alongT);
    const outwardX = radial.x * Math.cos(angle) + side.x * Math.sin(angle);
    const outwardZ = radial.z * Math.cos(angle) + side.z * Math.sin(angle);
    FARM_END.set(
      FARM_START.x + outwardX * length + jitter,
      FARM_START.y + 0.1 + length * 0.12,
      FARM_START.z + outwardZ * length
    );
    this.setFarmBeamMatrix(FARM_START, FARM_END, thickness, mesh, index);
  }

  public isStale(): boolean {
    return !this.game.room.state.buildings.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.building !== null && this.game.isMyBlob(this.building.ownerId);
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.building) return false;
    const rules = getBuildingRules(this.building.buildingType);
    const halfW = rules.selectionWidth * 0.5;
    const halfD = rules.selectionDepth * 0.5;
    return Math.abs(x - this.building.x) <= halfW && Math.abs(z - this.building.y) <= halfD;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.building) return Infinity;
    return Math.hypot(x - this.building.x, z - this.building.y);
  }

  public getWorldCenter(): { x: number; z: number } {
    if (!this.building) return { x: 0, z: 0 };
    return { x: this.building.x, z: this.building.y };
  }

  public getAttackRadius(): number {
    if (!this.building) return 0;
    const rules = getBuildingRules(this.building.buildingType);
    return Math.hypot(rules.selectionWidth * 0.5, rules.selectionDepth * 0.5);
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.building) return null;
    const rules = getBuildingRules(this.building.buildingType);
    const mine = this.isOwnedByMe();
    const resources = this.game.getMyResources();
    const currentUnitType = this.building.productionQueue[0] ?? null;
    const queueCount = this.building.productionQueue.length;
    const currentUnitRules = currentUnitType ? getUnitRules(currentUnitType) : null;
    const baseDetail = rules.detail;
    return {
      title: rules.label,
      detail: mine ? baseDetail : `Enemy · ${baseDetail.toLowerCase()}`,
      health: this.building.health,
      maxHealth: rules.health,
      color: this.game.getPlayerColor(this.building.ownerId),
      actions: mine
        ? [
            ...rules.producibleUnits.map((unitType) => {
            const unitRules = getUnitRules(unitType);
            const trainCost = getUnitTrainCost(unitType);
            const trainTimeMs = getEffectiveUnitTrainTimeMs(unitType);
            const count = this.building!.productionQueue.filter((queuedType) => queuedType === unitType).length;
            return {
              id: `train:${unitType}`,
              label: unitRules.label,
              disabled: !canAfford(resources, trainCost),
              cost: trainCost,
              timeMs: trainTimeMs,
              queueCount: count,
            };
          }),
          ...(rules.producibleUnits.length > 0
            ? [{
                id: "set_rally",
                label: "Spawn Point",
                active: this.building.rallySet > 0,
              }]
            : []),
        ]
        : [],
      production:
        mine && currentUnitRules
          ? {
              label: currentUnitRules.label,
              queueCount,
              remainingMs: Math.max(0, getEffectiveUnitTrainTimeMs(currentUnitType) - this.building.productionProgressMs),
              progress: Math.max(0, Math.min(1, this.building.productionProgressMs / getEffectiveUnitTrainTimeMs(currentUnitType))),
            }
          : null,
    };
  }
}

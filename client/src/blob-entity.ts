import * as THREE from "three";
import {
  BuildingType,
  GAME_RULES,
  SquadSpread,
  UnitType,
  getBlobMaxHealth,
  getSquadAxes,
  getUnitRules,
  type SquadSpread as SquadSpreadValue,
  type UnitType as UnitTypeValue,
} from "../../shared/game-rules.js";
import {
  AttackTargetType,
  BlobActionState,
  BlobAggroMode,
  BlobGatherPhase,
  CarriedResourceType,
  type BlobActionState as BlobActionStateValue,
} from "../../shared/protocol.js";
import type { Game } from "./game.js";
import { Entity, type SelectionInfo } from "./entity.js";
import { BuildingEntity } from "./building-entity.js";
import { createUnitBodyGeometry } from "./render-geom.js";
import { getTerrainHeightAt } from "./terrain.js";
import {
  createVillagerInstancedMeshes,
  createWarbandInstancedMeshes,
  createUnitInstancedMeshes,
  getUnitModelAssetVersion,
  hasUnitInstancedGlb,
} from "./unit-instanced-models.js";
import { applyTeamColorTexturesToMarkedMeshes, secondaryTeamHexFromPrimary } from "./render-texture-recolor.js";
import { applyStylizedShading } from "./stylized-shading.js";
import { getUnitVisualSpec } from "./unit-visual-config.js";
import {
  applyFamilyBodyMatrices,
  createSynthaurFallbackMesh,
  drawFamilyEquipment,
  drawFamilyLegs,
} from "./unit-family-renderers.js";
import {
  CarriedResourceRenderer,
  createDraggedComputeInstance,
  createDraggedPlantsInstance,
  createDraggedTreeInstance,
  type CarriedResourceInstance,
} from "./carried-resource-renderer.js";
import { ensureComputeSlots, ensureTreeSlots } from "./tile-visuals.js";
import {
  createInstancedSelectionOutline,
  getBrightTeamSelectionColor,
} from "./selection-outline.js";
import { BeamDrawer } from "./beam-drawer.js";
import { BrightBeamDrawer } from "./bright-beam-drawer.js";
import {
  applySelectionRingScreenThickness,
  createSelectionFillMaterial,
  createSelectionRingMaterial,
} from "./selection-ring.js";

const UNIT_GEOM = createUnitBodyGeometry();
const UNIT_MAT = applyStylizedShading(new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.82,
  metalness: 0.02,
}));
const OVAL_FILL_GEOM = new THREE.CircleGeometry(1, 48);
const OVAL_FILL_MAT = createSelectionFillMaterial();
const OVAL_RING_MAT = createSelectionRingMaterial();
const OVAL_RING_BASE_GEOM = new THREE.RingGeometry(0.93, 1, 64);
const RANGE_RING_GEOM = new THREE.RingGeometry(0.985, 1, 72);
const RANGE_RING_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.18,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: false,
  fog: false,
  toneMapped: false,
});
/** Keep ≥ starter Hoplite squad size — dev server uses a larger START_WARBAND_UNIT_COUNT (see server config). */
const INSTANCE_CAP = import.meta.env.DEV
  ? 8192
  : Math.max(512, GAME_RULES.START_WARBAND_UNIT_COUNT);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const VISUAL_STEP = 1 / 120;
const VISUAL_CATCHUP = 12;
const SELECTED_RING_THICKNESS_PX = 4;
const UNSELECTED_RING_THICKNESS_PX = 6;
const SELECTED_RING_MIN_THICKNESS_WORLD = 0.025;
const SELECTED_RING_OUTER_SCALE = 1.1;
const UNSELECTED_RING_OUTER_SCALE = 1.04;
const DIRECTION_SMOOTHING = 3.2;
const MIN_DIRECTION_SPEED = 0.2;
const UNIT_SPRING = 20;
const UNIT_DAMPING = 0.24;
const UNIT_WALK_SPEED = 4.4;
const UNIT_BODY_MAX_SPEED = 10.2;
const UNIT_BODY_CATCHUP_GAIN = 2.8;
const UNIT_BODY_COMBAT_MAX_SPEED = 4.8;
const UNIT_BODY_COMBAT_CATCHUP_GAIN = 0;
const UNIT_MAX_TURN_RATE = Math.PI * 5.2;
const UNIT_COMBAT_TURN_RATE = Math.PI * 7.2;
const UNIT_COLLISION_RADIUS_SCALE = 0.82;
const FORMATION_SLOT_SCALE = 0.82;
const FOOT_IDLE_SPEED = 0.01;
const FOOT_STRIDE = GAME_RULES.UNIT_RADIUS * 1.05;
const COMBAT_TARGET_STANDOFF = GAME_RULES.UNIT_RADIUS * 1.9;
const COMBAT_ATTACK_ENTER_DISTANCE = GAME_RULES.UNIT_RADIUS * 1.85;
const COMBAT_ZONE_PADDING = GAME_RULES.UNIT_RADIUS * 2.45;
const COMBAT_TARGET_SEARCH_RADIUS = 6;
const COMBAT_TARGET_SIDE_SPACING = GAME_RULES.UNIT_RADIUS * 0.72;
const COMBAT_JITTER_RADIUS = GAME_RULES.UNIT_RADIUS * 0.68;
const COMBAT_JITTER_ACCEL = GAME_RULES.UNIT_RADIUS * 7.2;
const COMBAT_JITTER_DAMPING = 7.6;
const COMBAT_JITTER_RETURN = 5.6;
const COMBAT_CENTER_PULL = 2.2;
const HIP_WIDTH = GAME_RULES.UNIT_RADIUS * 0.32;
const BODY_FLOAT = GAME_RULES.UNIT_HEIGHT * 0.6;
const ARCHER_RELEASE_INTERVAL = 0.72;
const VILLAGER_CARRY_DISPLAY_CHUNK = 12;
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_PATH_COLOR = new THREE.Color();
/** Ground/st ray pick: villagers use a small procedural mesh — pad ellipse + invisible column for rays. */
const VILLAGER_PICK_CYLINDER_R = 1.35;
const VILLAGER_PICK_CYLINDER_H = 3.8;

/** Legs & move markers stay neutral; squad ovals use owner team color (see `render`). */
const COLOR_MOVE_MARKER = new THREE.Color(0xfff8ef);
const TEMP_OVAL_RING  = new THREE.Color();
const TEMP_OVAL_FILL  = new THREE.Color();
const _ovalHsl = { h: 0, s: 0, l: 0 };

const SHIELD_RADIUS    = 0.44;
const SHIELD_THICKNESS = 0.055;
const UNIT_SELECTION_OUTLINE_COLOR = new THREE.Color();

type UnitCombatMode = "formation" | "chase" | "attack";

type UnitState = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  bodyX: number;
  bodyZ: number;
  lastBodyWorldX: number;
  lastBodyWorldZ: number;
  leftFootX: number;
  leftFootZ: number;
  rightFootX: number;
  rightFootZ: number;
  leftPlanted: boolean;
  distanceWalked: number;
  bodyReady: boolean;
  feetReady: boolean;
  combatMode: UnitCombatMode;
  combatTargetIndex: number;
  faceX: number;
  faceZ: number;
  combatJitterX: number;
  combatJitterZ: number;
  combatJitterVx: number;
  combatJitterVz: number;
  attackCooldown: number;
};

export type UnitContinuitySeed = Pick<
  UnitState,
  | "bodyX"
  | "bodyZ"
  | "lastBodyWorldX"
  | "lastBodyWorldZ"
  | "leftFootX"
  | "leftFootZ"
  | "rightFootX"
  | "rightFootZ"
  | "leftPlanted"
  | "distanceWalked"
  | "feetReady"
  | "faceX"
  | "faceZ"
  | "attackCooldown"
>;

type BlobRenderView = {
  actionState: BlobActionStateValue;
  aggroMode: number;
  combatGroupId: string;
  combatCenterX: number;
  combatCenterY: number;
  attackTargetType: number;
  attackTargetId: string;
  engagedTargetType: number;
  engagedTargetId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  ownerId: string;
  unitCount: number;
  health: number;
  spread: SquadSpreadValue;
  unitType: UnitTypeValue;
  gatherTargetKey: string;
  gatherTargetBuildingId: string;
  gatherPhase: number;
  gatherTimerMs: number;
  carriedResourceType: number;
  carriedAmount: number;
};

export class BlobEntity extends Entity {
  public mesh: THREE.Group;
  private ovalRoot!: THREE.Group;
  /** Cylinder fallback or instanced parts from `models/units/agent.glb`. */
  private unitsAgent: THREE.InstancedMesh[] = [];
  private tintedOwnerId: string | null = null;
  /** Invisible geometry so `Raycaster` can select villagers without pixel-hunting. */
  private villagerPickProxy!: THREE.Mesh;
  /** One mesh (cylinder fallback) or multiple parts from `models/units/hoplite.glb`. */
  private unitsWarband: THREE.InstancedMesh[] = [];
  private unitsSynthaur: THREE.InstancedMesh[] = [];
  /** Instanced parts from `models/units/archer.glb`. */
  private unitsArcher: THREE.InstancedMesh[] = [];
  private unitModelAssetVersion = -1;
  private unitsCentaur!: THREE.InstancedMesh;
  /** Flat disc in the left hand of each warband soldier. */
  private unitShield!: THREE.InstancedMesh;
  private carriedResources!: CarriedResourceRenderer;
  private ovalFill!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private ovalRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private attackRangeRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private selectionOutlineRoot!: THREE.Group;
  private unitsAgentOutline: THREE.InstancedMesh[] = [];
  private unitsWarbandOutline: THREE.InstancedMesh[] = [];
  private unitsSynthaurOutline: THREE.InstancedMesh[] = [];
  private unitsArcherOutline: THREE.InstancedMesh[] = [];
  private unitsCentaurOutline!: THREE.InstancedMesh;
  private unitShieldOutline!: THREE.InstancedMesh;
  private selectionBeamDrawer!: BeamDrawer;
  private selectionBrightBeamDrawer!: BrightBeamDrawer;
  private blobSnapshot: BlobRenderView | null = null;
  private blob: BlobRenderView | null = null;
  private heading = 0;
  private visualX: number | null = null;
  private visualY: number | null = null;
  private visualVx = 0;
  private visualVy = 0;
  private visualTime = 0;
  private gatherVisualPhase: number = BlobGatherPhase.NONE;
  private gatherVisualTimerMs = 0;
  private forwardX = 0;
  private forwardY = 1;
  private formationForwardX = 0;
  private formationForwardY = 1;
  private unitStates: UnitState[] = [];
  private pendingUnitSeeds: UnitContinuitySeed[] = [];
  private needsUnitReassignment = false;

  // Target destination indicator
  private targetGroup!: THREE.Group;
  private targetPinRing!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetPingMesh!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private targetDisc!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private targetConnector!: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private pingPhase = Math.random(); // stagger so multiple blobs don't pulse in sync
  private targetAnimT = 0;
  private combatAnimT = Math.random() * Math.PI * 2;


  public constructor(game: Game, id: string) {
    super(game, id);
    this.init();
  }

  protected override init(): void {
    super.init();
    this.selectionBeamDrawer = new BeamDrawer(1024);
    this.selectionBrightBeamDrawer = new BrightBeamDrawer(1024);
    this.selectionBeamDrawer.root.visible = false;
    this.selectionBrightBeamDrawer.root.visible = false;
    this.buildTargetIndicator();
    this.game.scene.add(this.selectionBeamDrawer.root);
    this.game.scene.add(this.selectionBrightBeamDrawer.root);
    this.game.scene.add(this.targetGroup);
    this.game.scene.add(this.targetConnector);
    this.game.scene.add(this.carriedResources.root);
  }

  public override destroy(): void {
    this.game.scene.remove(this.selectionBeamDrawer.root);
    this.game.scene.remove(this.selectionBrightBeamDrawer.root);
    this.game.scene.remove(this.targetGroup);
    this.game.scene.remove(this.targetConnector);
    this.game.scene.remove(this.carriedResources.root);
    super.destroy();
  }

  protected createMesh(): THREE.Group {
    this.unitsAgent = createVillagerInstancedMeshes(INSTANCE_CAP);
    if (this.unitsAgent.length === 0) {
      this.unitsAgent = [this.createFallbackUnitMesh()];
    }

    this.unitsWarband = createWarbandInstancedMeshes(INSTANCE_CAP);
    if (this.unitsWarband.length === 0) {
      this.unitsWarband = [this.createFallbackUnitMesh()];
    }

    this.unitsSynthaur = createUnitInstancedMeshes("synthaur", INSTANCE_CAP);

    this.unitsArcher = createUnitInstancedMeshes("archer", INSTANCE_CAP);
    if (this.unitsArcher.length === 0) {
      this.unitsArcher = [this.createFallbackUnitMesh()];
    }
    this.unitModelAssetVersion = getUnitModelAssetVersion();
    this.setBaseRenderOrder(this.unitsAgent);
    this.setBaseRenderOrder(this.unitsWarband);
    this.setBaseRenderOrder(this.unitsSynthaur);
    this.setBaseRenderOrder(this.unitsArcher);

    this.ovalRoot = new THREE.Group();

    this.ovalFill = new THREE.Mesh(OVAL_FILL_GEOM, OVAL_FILL_MAT.clone());
    this.ovalFill.rotation.x = -Math.PI / 2;
    this.ovalFill.position.y = 0.14;
    this.ovalFill.renderOrder = 1002;

    this.ovalRing = new THREE.Mesh(OVAL_RING_BASE_GEOM, OVAL_RING_MAT.clone());
    this.ovalRing.rotation.x = -Math.PI / 2;
    this.ovalRing.position.y = 0.18;
    this.ovalRing.renderOrder = 1003;

    this.attackRangeRing = new THREE.Mesh(RANGE_RING_GEOM, RANGE_RING_MAT.clone());
    this.attackRangeRing.rotation.x = -Math.PI / 2;
    this.attackRangeRing.position.y = 0.05;
    this.attackRangeRing.renderOrder = 1004;
    this.attackRangeRing.visible = false;

    this.ovalRoot.add(this.ovalFill);
    this.ovalRoot.add(this.ovalRing);
    this.ovalRoot.add(this.attackRangeRing);

    this.villagerPickProxy = new THREE.Mesh(
      new THREE.CylinderGeometry(VILLAGER_PICK_CYLINDER_R, VILLAGER_PICK_CYLINDER_R, VILLAGER_PICK_CYLINDER_H, 16),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.villagerPickProxy.position.y = VILLAGER_PICK_CYLINDER_H * 0.5;
    this.villagerPickProxy.visible = false;
    this.villagerPickProxy.frustumCulled = false;

    // Shield disc — flat cylinder in the left hand, one per warband unit
    const shieldGeom = new THREE.CylinderGeometry(SHIELD_RADIUS, SHIELD_RADIUS, SHIELD_THICKNESS, 18);
    const shieldMat  = applyStylizedShading(new THREE.MeshStandardMaterial({ color: 0xa8b4c0, roughness: 0.55, metalness: 0.38 }));
    this.unitShield  = new THREE.InstancedMesh(shieldGeom, shieldMat, INSTANCE_CAP);
    this.unitShield.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.unitShield.castShadow    = true;
    this.unitShield.receiveShadow = true;
    this.unitShield.frustumCulled = false;
    this.unitShield.count = 0;
    this.unitShield.renderOrder = 2;

    this.unitsCentaur = createSynthaurFallbackMesh(INSTANCE_CAP);
    this.unitsCentaur.renderOrder = 2;
    this.carriedResources = new CarriedResourceRenderer(INSTANCE_CAP);
    this.selectionOutlineRoot = new THREE.Group();
    this.selectionOutlineRoot.visible = false;
    this.rebuildSelectionOutlineMeshes();

    const group = new THREE.Group();
    group.add(this.selectionOutlineRoot);
    group.add(this.ovalRoot);
    for (const m of this.unitsAgent) group.add(m);
    group.add(this.villagerPickProxy);
    for (const m of this.unitsArcher) group.add(m);
    for (const m of this.unitsWarband) group.add(m);
    for (const m of this.unitsSynthaur) group.add(m);
    group.add(this.unitsCentaur);
    group.add(this.unitShield);
    return group;
  }

  private createFallbackUnitMesh(): THREE.InstancedMesh {
    const fallback = new THREE.InstancedMesh(UNIT_GEOM, UNIT_MAT.clone(), INSTANCE_CAP);
    fallback.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fallback.castShadow = true;
    fallback.receiveShadow = true;
    fallback.frustumCulled = false;
    fallback.renderOrder = 2;
    return fallback;
  }

  private setBaseRenderOrder(meshes: THREE.InstancedMesh[]): void {
    for (const mesh of meshes) mesh.renderOrder = 2;
  }

  private rebuildUnitModelMeshes(nextVersion = getUnitModelAssetVersion()): void {
    for (const mesh of this.unitsAgent) this.mesh.remove(mesh);
    for (const mesh of this.unitsArcher) this.mesh.remove(mesh);
    for (const mesh of this.unitsWarband) this.mesh.remove(mesh);
    for (const mesh of this.unitsSynthaur) this.mesh.remove(mesh);

    this.unitsAgent = createVillagerInstancedMeshes(INSTANCE_CAP);
    if (this.unitsAgent.length === 0) this.unitsAgent = [this.createFallbackUnitMesh()];
    this.unitsWarband = createWarbandInstancedMeshes(INSTANCE_CAP);
    if (this.unitsWarband.length === 0) this.unitsWarband = [this.createFallbackUnitMesh()];
    this.unitsArcher = createUnitInstancedMeshes("archer", INSTANCE_CAP);
    if (this.unitsArcher.length === 0) this.unitsArcher = [this.createFallbackUnitMesh()];
    this.unitsSynthaur = createUnitInstancedMeshes("synthaur", INSTANCE_CAP);
    this.setBaseRenderOrder(this.unitsAgent);
    this.setBaseRenderOrder(this.unitsWarband);
    this.setBaseRenderOrder(this.unitsArcher);
    this.setBaseRenderOrder(this.unitsSynthaur);

    for (const mesh of this.unitsAgent) this.mesh.add(mesh);
    for (const mesh of this.unitsArcher) this.mesh.add(mesh);
    for (const mesh of this.unitsWarband) this.mesh.add(mesh);
    for (const mesh of this.unitsSynthaur) this.mesh.add(mesh);

    this.tintedOwnerId = null;
    this.unitModelAssetVersion = nextVersion;
    this.rebuildSelectionOutlineMeshes();
    this.applyOwnerTintToUnitMeshes();
  }

  private refreshUnitModelMeshesIfNeeded(): void {
    const nextVersion = getUnitModelAssetVersion();
    if (this.unitModelAssetVersion === nextVersion) return;
    this.rebuildUnitModelMeshes(nextVersion);
  }

  private applyOwnerTintToUnitMeshes(): void {
    const ownerId = this.blob?.ownerId ?? null;
    if (!ownerId || this.tintedOwnerId === ownerId) return;
    const primary = this.game.getPlayerColor(ownerId);
    const secondary = secondaryTeamHexFromPrimary(primary);
    if (this.unitsAgent.length > 0 && hasUnitInstancedGlb("agent")) {
      applyTeamColorTexturesToMarkedMeshes(this.unitsAgent, primary, secondary);
    }
    if (this.unitsWarband.length > 0 && hasUnitInstancedGlb("hoplite")) {
      applyTeamColorTexturesToMarkedMeshes(this.unitsWarband, primary, secondary);
    }
    if (this.unitsArcher.length > 0 && hasUnitInstancedGlb("archer")) {
      applyTeamColorTexturesToMarkedMeshes(this.unitsArcher, primary, secondary);
    }
    if (this.unitsSynthaur.length > 0 && hasUnitInstancedGlb("synthaur")) {
      applyTeamColorTexturesToMarkedMeshes(this.unitsSynthaur, primary, secondary);
    }
    this.tintedOwnerId = ownerId;
  }

  private rebuildSelectionOutlineMeshes(): void {
    for (const mesh of this.unitsAgentOutline) this.selectionOutlineRoot.remove(mesh);
    for (const mesh of this.unitsArcherOutline) this.selectionOutlineRoot.remove(mesh);
    for (const mesh of this.unitsWarbandOutline) this.selectionOutlineRoot.remove(mesh);
    for (const mesh of this.unitsSynthaurOutline) this.selectionOutlineRoot.remove(mesh);
    if (this.unitsCentaurOutline) this.selectionOutlineRoot.remove(this.unitsCentaurOutline);
    if (this.unitShieldOutline) this.selectionOutlineRoot.remove(this.unitShieldOutline);

    this.unitsAgentOutline = this.unitsAgent.map((mesh) => createInstancedSelectionOutline(mesh));
    this.unitsArcherOutline = this.unitsArcher.map((mesh) => createInstancedSelectionOutline(mesh));
    this.unitsWarbandOutline = this.unitsWarband.map((mesh) => createInstancedSelectionOutline(mesh));
    this.unitsSynthaurOutline = this.unitsSynthaur.map((mesh) => createInstancedSelectionOutline(mesh));
    this.unitsCentaurOutline = createInstancedSelectionOutline(this.unitsCentaur);
    this.unitShieldOutline = createInstancedSelectionOutline(this.unitShield);

    for (const mesh of this.unitsAgentOutline) this.selectionOutlineRoot.add(mesh);
    for (const mesh of this.unitsArcherOutline) this.selectionOutlineRoot.add(mesh);
    for (const mesh of this.unitsWarbandOutline) this.selectionOutlineRoot.add(mesh);
    for (const mesh of this.unitsSynthaurOutline) this.selectionOutlineRoot.add(mesh);
    this.selectionOutlineRoot.add(this.unitsCentaurOutline);
    this.selectionOutlineRoot.add(this.unitShieldOutline);
  }

  private syncSelectionOutlineMeshes(color: THREE.Color): void {
    this.selectionOutlineRoot.visible = false;
    return;

  }

  public override getSelectionOutlineObjects(): THREE.Object3D[] {
    return this.isSelected()
      ? [
      ...this.unitsAgent,
      ...this.unitsArcher,
      ...this.unitsWarband,
      ...this.unitsSynthaur,
      this.unitsCentaur,
      this.unitShield,
      this.selectionBeamDrawer.root,
      this.selectionBrightBeamDrawer.root,
    ]
      : [
      ...this.unitsAgent,
      ...this.unitsArcher,
      ...this.unitsWarband,
      ...this.unitsSynthaur,
      this.unitsCentaur,
      this.unitShield,
    ];
  }

  public sync(blob: BlobRenderView): void {
    const previousSnapshot = this.blobSnapshot;
    const previousLayout = this.blob ? this.getLayout() : null;
    const previousCount = previousSnapshot?.unitCount ?? 0;
    const previousUnitType = previousSnapshot?.unitType ?? blob.unitType;
    const previousOwnerId = previousSnapshot?.ownerId ?? blob.ownerId;
    const previousBlob = previousSnapshot;
    const previousTargetX = previousSnapshot?.targetX ?? blob.targetX;
    const previousTargetY = previousSnapshot?.targetY ?? blob.targetY;
    const wasEngaged = (previousSnapshot?.engagedTargetId ?? "").length > 0;
    const isEngaged = blob.engagedTargetId.length > 0;
    this.blob = blob;
    if (previousSnapshot && blob.unitCount > previousCount) {
      this.pendingUnitSeeds.push(
        ...this.game.consumeRebalancedUnitSeeds({
          receiverId: this.id,
          ownerId: blob.ownerId,
          unitType: blob.unitType,
          x: blob.x,
          z: blob.y,
          count: blob.unitCount - previousCount,
        })
      );
    }
    if (previousLayout && previousCount > blob.unitCount) {
      this.spawnDeathFxForLostUnits(previousLayout, previousCount, blob.unitCount, previousUnitType, previousOwnerId);
    }
    if (!wasEngaged && !isEngaged && Math.hypot(blob.targetX - previousTargetX, blob.targetY - previousTargetY) > 0.25) {
      const previousAxis = previousBlob
        ? this.getCanonicalFormationAxis(previousBlob.targetX - previousBlob.x, previousBlob.targetY - previousBlob.y)
        : null;
      const nextAxis = this.getCanonicalFormationAxis(blob.targetX - blob.x, blob.targetY - blob.y);
      this.setFormationForward(blob.targetX - blob.x, blob.targetY - blob.y);
      this.needsUnitReassignment =
        !!previousAxis &&
        !!nextAxis &&
        (previousAxis.x * nextAxis.x + previousAxis.y * nextAxis.y) < 0.985;
    }
    if (this.visualX === null || this.visualY === null) {
      this.visualX = blob.x;
      this.visualY = blob.y;
      this.visualVx = blob.vx;
      this.visualVy = blob.vy;
      const speed = Math.hypot(blob.vx, blob.vy);
      if (speed > MIN_DIRECTION_SPEED) {
        this.forwardX = blob.vx / speed;
        this.forwardY = blob.vy / speed;
        this.formationForwardX = this.forwardX;
        this.formationForwardY = this.forwardY;
      }
    }
    const gatherPhaseChanged =
      this.gatherVisualPhase !== blob.gatherPhase ||
      (this.blobSnapshot?.gatherTargetKey ?? "") !== blob.gatherTargetKey ||
      (this.blobSnapshot?.gatherTargetBuildingId ?? "") !== blob.gatherTargetBuildingId ||
      (this.blobSnapshot?.carriedResourceType ?? CarriedResourceType.NONE) !== blob.carriedResourceType;
    if (gatherPhaseChanged) {
      this.gatherVisualPhase = blob.gatherPhase;
      this.gatherVisualTimerMs = blob.gatherTimerMs;
    } else if (
      blob.gatherPhase === BlobGatherPhase.PICKING_UP ||
      blob.gatherPhase === BlobGatherPhase.DROPPING_OFF
    ) {
      this.gatherVisualTimerMs = Math.max(this.gatherVisualTimerMs, blob.gatherTimerMs);
    } else {
      this.gatherVisualTimerMs = blob.gatherTimerMs;
    }
    this.blobSnapshot = {
      actionState: blob.actionState,
      aggroMode: blob.aggroMode,
      combatGroupId: blob.combatGroupId,
      combatCenterX: blob.combatCenterX,
      combatCenterY: blob.combatCenterY,
      attackTargetType: blob.attackTargetType,
      attackTargetId: blob.attackTargetId,
      engagedTargetType: blob.engagedTargetType,
      engagedTargetId: blob.engagedTargetId,
      x: blob.x,
      y: blob.y,
      targetX: blob.targetX,
      targetY: blob.targetY,
      vx: blob.vx,
      vy: blob.vy,
      ownerId: blob.ownerId,
      unitCount: blob.unitCount,
      health: blob.health,
      spread: blob.spread,
      unitType: blob.unitType,
      gatherTargetKey: blob.gatherTargetKey,
      gatherTargetBuildingId: blob.gatherTargetBuildingId,
      gatherPhase: blob.gatherPhase,
      gatherTimerMs: blob.gatherTimerMs,
      carriedResourceType: blob.carriedResourceType,
      carriedAmount: blob.carriedAmount,
    };
    if (previousOwnerId !== blob.ownerId) {
      this.tintedOwnerId = null;
      this.rebuildUnitModelMeshes();
    }
    this.applyOwnerTintToUnitMeshes();
  }

  private getGatherPhaseProgress(dt: number, phase: number): number {
    if (this.blob?.gatherPhase !== phase || this.gatherVisualPhase !== phase) return phase === BlobGatherPhase.PICKING_UP ? 1 : 0;
    this.gatherVisualTimerMs = Math.min(1000, this.gatherVisualTimerMs + dt * 1000);
    return Math.max(0, Math.min(1, this.gatherVisualTimerMs / 1000));
  }

  private getUnitWorldPositionFromLayout(
    _layout: { x: number; y: number; major: number; minor: number; heading: number },
    state: UnitState
  ): { x: number; z: number } {
    if (state.bodyReady) {
      return { x: state.bodyX, z: state.bodyZ };
    }
    return {
      x: state.x,
      z: state.z,
    };
  }

  private spawnDeathFxForLostUnits(
    layout: { x: number; y: number; major: number; minor: number; heading: number },
    previousCount: number,
    nextCount: number,
    unitType: UnitTypeValue,
    ownerId: string
  ): void {
    const lostStart = Math.max(0, nextCount);
    const lostEnd = Math.min(previousCount, this.unitStates.length);
    for (let i = lostStart; i < lostEnd; i++) {
      const state = this.unitStates[i];
      if (!state) continue;
      const world = this.getUnitWorldPositionFromLayout(layout, state);
      let dirX = 0;
      let dirZ = 1;
      if (state.combatMode !== "formation" && this.blob?.combatGroupId) {
        const combatContext = this.getCombatContext();
        const targetCenter = combatContext?.center ?? null;
        if (targetCenter) {
          dirX = world.x - targetCenter.x;
          dirZ = world.z - targetCenter.z;
        }
      }
      const dirLen = Math.hypot(dirX, dirZ);
      if (dirLen <= 1e-4) {
        dirX = this.forwardX + (Math.random() - 0.5) * 0.6;
        dirZ = this.forwardY + (Math.random() - 0.5) * 0.6;
      }
      this.game.spawnUnitDeathFx({
        x: world.x,
        z: world.z,
        dirX,
        dirZ,
        teamColor: this.game.getPlayerColor(ownerId),
        unitType,
      });
    }
  }

  private getCombatContext() {
    if (!this.blob?.combatGroupId) return null;
    return this.game.getBlobCombatContext(this.id);
  }

  private getAttackTarget(): BlobEntity | BuildingEntity | null {
    if (!this.blob?.attackTargetId) return null;
    if (this.blob.attackTargetType === AttackTargetType.BLOB) {
      return this.game.findBlobEntity(this.blob.attackTargetId);
    }
    if (this.blob.attackTargetType === AttackTargetType.BUILDING) {
      const entity = this.game.findEntity(this.blob.attackTargetId);
      return entity instanceof BuildingEntity ? entity : null;
    }
    return null;
  }

  private getNearestOwnedDropoffCenter(x: number, z: number): { x: number; y: number; z: number } | null {
    if (!this.blob) return null;
    let best: { x: number; y: number; z: number } | null = null;
    let bestDistance = Infinity;
    this.game.room.state.buildings.forEach((building) => {
      const candidate = building as { ownerId?: string; buildingType?: number; x?: number; y?: number };
      if (candidate.ownerId !== this.blob!.ownerId || candidate.buildingType !== BuildingType.TOWN_CENTER) return;
      const cx = candidate.x ?? 0;
      const cz = candidate.y ?? 0;
      const distance = Math.hypot(cx - x, cz - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          x: cx,
          y: getTerrainHeightAt(cx, cz, this.game.getTiles()) + GAME_RULES.UNIT_HEIGHT * 0.28,
          z: cz,
        };
      }
    });
    return best;
  }

  private getGatherTreeSourcePosition(carryIndex: number): { x: number; y: number; z: number } | null {
    if (!this.blob?.gatherTargetKey) return null;
    const tile = this.game.getTiles().get(this.blob.gatherTargetKey);
    if (!tile) return null;
    const slots = ensureTreeSlots(tile, this.game.getTiles());
    if (slots.length === 0) return null;
    const slot = slots[carryIndex % slots.length]!;
    return {
      x: slot.x,
      y: getTerrainHeightAt(slot.x, slot.z, this.game.getTiles()),
      z: slot.z,
    };
  }

  private getGatherComputeSourcePosition(carryIndex: number): { x: number; y: number; z: number } | null {
    if (!this.blob?.gatherTargetKey) return null;
    const tile = this.game.getTiles().get(this.blob.gatherTargetKey);
    if (!tile) return null;
    const slots = ensureComputeSlots(tile);
    if (slots.length === 0) return null;
    const slot = slots[carryIndex % slots.length]!;
    return {
      x: slot.x,
      y: getTerrainHeightAt(slot.x, slot.z, this.game.getTiles()),
      z: slot.z,
    };
  }

  private getGatherFarmSourcePosition(carryIndex: number): { x: number; y: number; z: number } | null {
    if (!this.blob?.gatherTargetBuildingId) return null;
    const entity = this.game.findEntity(this.blob.gatherTargetBuildingId);
    if (!(entity instanceof BuildingEntity)) return null;
    const center = entity.getWorldCenter();
    const angle = (carryIndex / Math.max(1, this.getUnitCount())) * Math.PI * 2;
    const radius = GAME_RULES.TILE_SIZE * 0.18;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: getTerrainHeightAt(center.x, center.z, this.game.getTiles()) + 0.95,
      z: center.z + Math.sin(angle) * radius,
    };
  }

  private isTargetInRangedAttackRange(target: BlobEntity | BuildingEntity | null): boolean {
    if (!this.blob || !target) return false;
    const rules = getUnitRules(this.blob.unitType);
    if (rules.attackStyle !== "ranged") return false;
    const own = this.getPredictedWorldCenter();
    const enemy =
      target instanceof BlobEntity ? target.getPredictedWorldCenter() : target.getWorldCenter();
    const radius =
      target instanceof BlobEntity ? target.getRadius() : target.getAttackRadius();
    return Math.hypot(own.x - enemy.x, own.z - enemy.z) <= rules.attackRange + radius;
  }

  private isServerRangedAttacking(): boolean {
    return this.blob?.actionState === BlobActionState.RANGED_ATTACKING;
  }

  private getCanonicalFormationAxis(dx: number, dy: number): { x: number; y: number } | null {
    const len = Math.hypot(dx, dy);
    if (len <= 1e-4) return null;

    let x = dx / len;
    let y = dy / len;
    if (y < 0 || (Math.abs(y) <= 1e-6 && x < 0)) {
      x = -x;
      y = -y;
    }
    return { x, y };
  }

  private setFormationForward(dx: number, dy: number): void {
    const axis = this.getCanonicalFormationAxis(dx, dy);
    if (!axis) return;
    this.formationForwardX = axis.x;
    this.formationForwardY = axis.y;
  }

  private reassignUnitStates(
    count: number,
    layout: { x: number; y: number; major: number; minor: number; heading: number; stretchX: number; stretchZ: number }
  ): void {
    if (count <= 1) return;

    const slots = Array.from({ length: count }, (_, index) => {
      const slot = this.getSlotWorldOffset(index, count, layout);
      return { index, front: slot.z, side: slot.x };
    }).sort((a, b) => {
      if (Math.abs(b.front - a.front) > 1e-4) return b.front - a.front;
      return a.side - b.side;
    });

    const orderedStates = this.unitStates.slice(0, count).map((state) => {
      const px = state.bodyReady ? state.bodyX - layout.x : state.x - layout.x;
      const pz = state.bodyReady ? state.bodyZ - layout.y : state.z - layout.y;
      return {
        state,
        front: pz,
        side: px,
      };
    }).sort((a, b) => {
      if (Math.abs(b.front - a.front) > 1e-4) return b.front - a.front;
      return a.side - b.side;
    });

    const remapped = this.unitStates.slice();
    for (let rank = 0; rank < count; rank++) {
      remapped[slots[rank]!.index] = orderedStates[rank]!.state;
    }
    this.unitStates = remapped;
  }

  private ensureUnitStateCount(count: number): void {
    const center = this.getPredictedCenter();
    while (this.unitStates.length < count) {
      const seed = this.pendingUnitSeeds.shift();
      const index = this.unitStates.length;
      const unitRadius = this.getUnitCollisionRadius();
      const spawnAngle = index * GOLDEN_ANGLE;
      const spawnDistance = Math.max(unitRadius * 2.4, GAME_RULES.UNIT_SPACING * 0.7);
      const spawn = seed
        ? { x: seed.bodyX, z: seed.bodyZ }
        : this.game.getUnitCollisionSystem().findNearestWalkablePoint(
            center.x + Math.cos(spawnAngle) * spawnDistance,
            center.y + Math.sin(spawnAngle) * spawnDistance,
            unitRadius
          );
      this.unitStates.push({
        x: spawn.x,
        z: spawn.z,
        vx: 0,
        vz: 0,
        bodyX: seed?.bodyX ?? spawn.x,
        bodyZ: seed?.bodyZ ?? spawn.z,
        lastBodyWorldX: seed?.lastBodyWorldX ?? spawn.x,
        lastBodyWorldZ: seed?.lastBodyWorldZ ?? spawn.z,
        leftFootX: seed?.leftFootX ?? spawn.x,
        leftFootZ: seed?.leftFootZ ?? spawn.z,
        rightFootX: seed?.rightFootX ?? spawn.x,
        rightFootZ: seed?.rightFootZ ?? spawn.z,
        leftPlanted: seed?.leftPlanted ?? Math.random() >= 0.5,
        distanceWalked: seed?.distanceWalked ?? Math.random() * FOOT_STRIDE,
        bodyReady: true,
        feetReady: seed?.feetReady ?? true,
        combatMode: "formation",
        combatTargetIndex: -1,
        faceX: seed?.faceX ?? 0,
        faceZ: seed?.faceZ ?? 1,
        combatJitterX: 0,
        combatJitterZ: 0,
        combatJitterVx: 0,
        combatJitterVz: 0,
        attackCooldown: seed?.attackCooldown ?? Math.random() * ARCHER_RELEASE_INTERVAL,
      });
    }
    if (this.unitStates.length > count) {
      this.unitStates.length = count;
    }
  }

  public extractContinuityUnitSeeds(count: number, targetX: number, targetZ: number): UnitContinuitySeed[] {
    const ranked = this.unitStates
      .map((state, index) => ({
        index,
        d2: (state.bodyX - targetX) ** 2 + (state.bodyZ - targetZ) ** 2,
      }))
      .sort((a, b) => a.d2 - b.d2);
    const chosen = ranked.slice(0, Math.max(0, count)).sort((a, b) => b.index - a.index);
    const seeds: UnitContinuitySeed[] = [];
    for (const item of chosen) {
      const [state] = this.unitStates.splice(item.index, 1);
      if (!state) continue;
      seeds.push({
        bodyX: state.bodyX,
        bodyZ: state.bodyZ,
        lastBodyWorldX: state.lastBodyWorldX,
        lastBodyWorldZ: state.lastBodyWorldZ,
        leftFootX: state.leftFootX,
        leftFootZ: state.leftFootZ,
        rightFootX: state.rightFootX,
        rightFootZ: state.rightFootZ,
        leftPlanted: state.leftPlanted,
        distanceWalked: state.distanceWalked,
        feetReady: state.feetReady,
        faceX: state.faceX,
        faceZ: state.faceZ,
        attackCooldown: state.attackCooldown,
      });
    }
    return seeds;
  }

  private getUnitCollisionRadius(): number {
    const unitType = this.blob?.unitType ?? UnitType.WARBAND;
    return Math.max(0.25, GAME_RULES.UNIT_RADIUS * getUnitRules(unitType).visualScale * UNIT_COLLISION_RADIUS_SCALE);
  }

  private getSlotPosition(index: number, count: number) {
    const t = (index + 0.5) / Math.max(1, count);
    const radius = Math.sqrt(t);
    const angle = index * GOLDEN_ANGLE;
    return {
      x: Math.cos(angle) * radius * FORMATION_SLOT_SCALE,
      z: Math.sin(angle) * radius * FORMATION_SLOT_SCALE,
    };
  }

  private getSlotWorldOffset(
    index: number,
    count: number,
    layout: { major: number; minor: number; stretchX: number; stretchZ: number }
  ): { x: number; z: number } {
    const base = this.getSlotPosition(index, count);
    const dirLen = Math.hypot(layout.stretchX, layout.stretchZ);
    const dirX = dirLen > 1e-4 ? layout.stretchX / dirLen : 0;
    const dirZ = dirLen > 1e-4 ? layout.stretchZ / dirLen : 1;
    const sideX = -dirZ;
    const sideZ = dirX;
    const along = base.x * dirX + base.z * dirZ;
    const side = base.x * sideX + base.z * sideZ;
    return {
      x: dirX * along * layout.major + sideX * side * layout.minor,
      z: dirZ * along * layout.major + sideZ * side * layout.minor,
    };
  }

  private stepUnits(_dt: number, layout: { x: number; y: number; major: number; minor: number; heading: number; stretchX: number; stretchZ: number }): void {
    const count = Math.min(this.blob?.unitCount ?? 0, INSTANCE_CAP);
    this.ensureUnitStateCount(count);

    for (let i = 0; i < count; i++) {
      const state = this.unitStates[i];
      const slot = this.getSlotWorldOffset(i, count, layout);
      const slotWorldX = layout.x + slot.x;
      const slotWorldZ = layout.y + slot.z;
      state.x = slotWorldX;
      state.z = slotWorldZ;
      state.vx = 0;
      state.vz = 0;
    }
  }

  private getCombatZone(centerX: number, centerZ: number, totalUnitCount: number): { centerX: number; centerZ: number; radius: number } {
    const total = Math.max(2, totalUnitCount);
    return {
      centerX,
      centerZ,
      radius: Math.max(GAME_RULES.UNIT_RADIUS * 6.2, Math.sqrt(total) * COMBAT_ZONE_PADDING * 1.35),
    };
  }

  private getBuildingAttackPlan(
    unitIndex: number,
    unitCount: number,
    state: UnitState,
    target: BuildingEntity
  ): {
    mode: UnitCombatMode;
    desiredWorldX: number;
    desiredWorldZ: number;
    targetWorldX: number;
    targetWorldZ: number;
  } {
    const center = target.getWorldCenter();
    const ownCenter = this.getPredictedWorldCenter();
    const baseAngle = Math.atan2(ownCenter.z - center.z, ownCenter.x - center.x);
    const arcSpan = Math.min(Math.PI * 1.15, 0.9 + unitCount * 0.085);
    const rankT = unitCount <= 1 ? 0.5 : unitIndex / Math.max(1, unitCount - 1);
    const angle = baseAngle + (rankT - 0.5) * arcSpan;
    const radius = target.getAttackRadius() + COMBAT_TARGET_STANDOFF * 0.82;
    const desiredWorldX = center.x + Math.cos(angle) * radius;
    const desiredWorldZ = center.z + Math.sin(angle) * radius;
    const currentWorldX = state.bodyReady ? state.bodyX : state.x;
    const currentWorldZ = state.bodyReady ? state.bodyZ : state.z;
    const dist = Math.hypot(desiredWorldX - currentWorldX, desiredWorldZ - currentWorldZ);
    return {
      mode: dist <= COMBAT_ATTACK_ENTER_DISTANCE ? "attack" : "chase",
      desiredWorldX,
      desiredWorldZ,
      targetWorldX: center.x,
      targetWorldZ: center.z,
    };
  }

  private isBuildingAttackActive(target: BuildingEntity): boolean {
    if (!this.blob) return false;
    const center = this.getPredictedWorldCenter();
    const distance = Math.hypot(center.x - target.getWorldCenter().x, center.z - target.getWorldCenter().z);
    const enterDistance = this.getRadius() + target.getAttackRadius() + GAME_RULES.UNIT_RADIUS * 0.9;
    const keepDistance = enterDistance + GAME_RULES.UNIT_RADIUS * 1.25;
    const wasActive = this.unitStates.some((state) => state.combatMode !== "formation");
    return distance <= (wasActive ? keepDistance : enterDistance);
  }

  private getRenderedUnitWorldPosition(index: number): { x: number; z: number } {
    const state = this.unitStates[Math.max(0, Math.min(index, this.unitStates.length - 1))];
    if (state) {
      if (state.bodyReady) return { x: state.bodyX, z: state.bodyZ };
      return { x: state.x, z: state.z };
    }
    return this.getPredictedWorldCenter();
  }

  private rotateFacingToward(
    state: UnitState,
    desiredX: number,
    desiredZ: number,
    dt: number,
    maxTurnRate = UNIT_MAX_TURN_RATE
  ): { x: number; z: number } {
    const desiredLen = Math.hypot(desiredX, desiredZ);
    if (desiredLen <= 1e-4) {
      const cachedLen = Math.hypot(state.faceX, state.faceZ);
      if (cachedLen > 1e-4) return { x: state.faceX / cachedLen, z: state.faceZ / cachedLen };
      state.faceX = 0;
      state.faceZ = 1;
      return { x: 0, z: 1 };
    }

    desiredX /= desiredLen;
    desiredZ /= desiredLen;
    const currentLen = Math.hypot(state.faceX, state.faceZ);
    if (currentLen <= 1e-4) {
      state.faceX = desiredX;
      state.faceZ = desiredZ;
      return { x: desiredX, z: desiredZ };
    }

    const currentAngle = Math.atan2(state.faceX / currentLen, state.faceZ / currentLen);
    const desiredAngle = Math.atan2(desiredX, desiredZ);
    let delta = desiredAngle - currentAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = maxTurnRate * dt;
    const nextAngle = currentAngle + Math.max(-maxTurn, Math.min(maxTurn, delta));
    state.faceX = Math.sin(nextAngle);
    state.faceZ = Math.cos(nextAngle);
    return { x: state.faceX, z: state.faceZ };
  }

  private getCombatPlan(
    unitIndex: number,
    unitCount: number,
    state: UnitState,
    enemyPositions: { x: number; z: number }[],
    enemyLoads: number[],
    dt: number,
    zone: { centerX: number; centerZ: number; radius: number }
  ): {
    mode: UnitCombatMode;
    desiredWorldX: number;
    desiredWorldZ: number;
    targetWorldX: number;
    targetWorldZ: number;
  } | null {
    if (enemyPositions.length === 0) return null;

    const currentWorldX = state.bodyReady ? state.bodyX : state.x;
    const currentWorldZ = state.bodyReady ? state.bodyZ : state.z;
    const maxAttackersPerEnemy = Math.max(1, Math.ceil(unitCount / enemyPositions.length));
    const preferredIndex =
      enemyPositions.length <= 1
        ? 0
        : Math.round((unitIndex / Math.max(1, unitCount - 1)) * (enemyPositions.length - 1));

    let bestIndex = -1;
    let bestScore = Infinity;
    const consider = (candidate: number) => {
      if (candidate < 0 || candidate >= enemyPositions.length) return;
      const targetPos = enemyPositions[candidate]!;
      const overload = Math.max(0, enemyLoads[candidate]! - maxAttackersPerEnemy + 1);
      const dx = targetPos.x - currentWorldX;
      const dz = targetPos.z - currentWorldZ;
      const score =
        overload * 1000 +
        Math.abs(candidate - preferredIndex) * 2.5 +
        (dx * dx + dz * dz) * 0.03;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = candidate;
      }
    };

    if (state.combatTargetIndex >= 0 && state.combatTargetIndex < enemyPositions.length) {
      consider(state.combatTargetIndex);
    }
    for (let delta = 0; delta <= COMBAT_TARGET_SEARCH_RADIUS; delta++) {
      consider(preferredIndex - delta);
      if (delta > 0) consider(preferredIndex + delta);
    }
    if (bestIndex < 0) bestIndex = Math.max(0, Math.min(preferredIndex, enemyPositions.length - 1));
    state.combatTargetIndex = bestIndex;
    const assignedRank = enemyLoads[bestIndex] ?? 0;
    enemyLoads[bestIndex] = assignedRank + 1;

    const targetPos = enemyPositions[bestIndex]!;
    let dirX = targetPos.x - currentWorldX;
    let dirZ = targetPos.z - currentWorldZ;
    let dirLen = Math.hypot(dirX, dirZ);
    if (dirLen < 1e-4) {
      dirX = targetPos.x - zone.centerX;
      dirZ = targetPos.z - zone.centerZ;
      dirLen = Math.hypot(dirX, dirZ);
    }
    if (dirLen < 1e-4) {
      dirX = 0;
      dirZ = 1;
      dirLen = 1;
    }
    dirX /= dirLen;
    dirZ /= dirLen;

    const sideX = -dirZ;
    const sideZ = dirX;
    const sideOffset =
      (assignedRank - Math.max(0, maxAttackersPerEnemy - 1) * 0.5) * COMBAT_TARGET_SIDE_SPACING;

    // Per-unit Brownian anchor motion inside the combat zone. This keeps fighters
    // bobbling around instead of orbiting in one obvious direction.
    state.combatJitterVx += (Math.random() - 0.5) * COMBAT_JITTER_ACCEL * dt;
    state.combatJitterVz += (Math.random() - 0.5) * COMBAT_JITTER_ACCEL * dt;
    state.combatJitterVx += -state.combatJitterX * COMBAT_JITTER_RETURN * dt;
    state.combatJitterVz += -state.combatJitterZ * COMBAT_JITTER_RETURN * dt;
    state.combatJitterVx *= Math.exp(-COMBAT_JITTER_DAMPING * dt);
    state.combatJitterVz *= Math.exp(-COMBAT_JITTER_DAMPING * dt);
    state.combatJitterX += state.combatJitterVx * dt;
    state.combatJitterZ += state.combatJitterVz * dt;
    const jitterLen = Math.hypot(state.combatJitterX, state.combatJitterZ);
    if (jitterLen > COMBAT_JITTER_RADIUS) {
      const s = COMBAT_JITTER_RADIUS / Math.max(jitterLen, 1e-4);
      state.combatJitterX *= s;
      state.combatJitterZ *= s;
    }

    let desiredWorldX =
      targetPos.x
      - dirX * COMBAT_TARGET_STANDOFF
      + sideX * sideOffset
      + state.combatJitterX;
    let desiredWorldZ =
      targetPos.z
      - dirZ * COMBAT_TARGET_STANDOFF
      + sideZ * sideOffset
      + state.combatJitterZ;

    const centerDx = zone.centerX - desiredWorldX;
    const centerDz = zone.centerZ - desiredWorldZ;
    desiredWorldX += centerDx * COMBAT_CENTER_PULL * dt;
    desiredWorldZ += centerDz * COMBAT_CENTER_PULL * dt;

    const finalDx = desiredWorldX - zone.centerX;
    const finalDz = desiredWorldZ - zone.centerZ;
    const finalDist = Math.hypot(finalDx, finalDz);
    if (finalDist > zone.radius) {
      const scale = zone.radius / Math.max(finalDist, 1e-4);
      desiredWorldX = zone.centerX + finalDx * scale;
      desiredWorldZ = zone.centerZ + finalDz * scale;
    }

    return {
      mode: dirLen <= COMBAT_ATTACK_ENTER_DISTANCE ? "attack" : "chase",
      desiredWorldX,
      desiredWorldZ,
      targetWorldX: targetPos.x,
      targetWorldZ: targetPos.z,
    };
  }

  private resetFeet(state: UnitState, bodyWorldX: number, bodyWorldZ: number, sideX: number, sideZ: number, hipWidth: number) {
    state.leftFootX = bodyWorldX + sideX * hipWidth;
    state.leftFootZ = bodyWorldZ + sideZ * hipWidth;
    state.rightFootX = bodyWorldX - sideX * hipWidth;
    state.rightFootZ = bodyWorldZ - sideZ * hipWidth;
    state.lastBodyWorldX = bodyWorldX;
    state.lastBodyWorldZ = bodyWorldZ;
    state.feetReady = true;
  }

  private updateFeet(
    state: UnitState,
    bodyWorldX: number,
    bodyWorldZ: number,
    bodyVx: number,
    bodyVz: number,
    dt: number,
    forwardX: number,
    forwardZ: number,
    sideX: number,
    sideZ: number,
    stride: number,
    hipWidth: number
  ) {
    if (!state.feetReady) {
      this.resetFeet(state, bodyWorldX, bodyWorldZ, sideX, sideZ, hipWidth);
    }

    const speed = Math.hypot(bodyVx, bodyVz);
    if (speed < FOOT_IDLE_SPEED) {
      state.leftFootX = bodyWorldX + sideX * hipWidth;
      state.leftFootZ = bodyWorldZ + sideZ * hipWidth;
      state.rightFootX = bodyWorldX - sideX * hipWidth;
      state.rightFootZ = bodyWorldZ - sideZ * hipWidth;
      state.lastBodyWorldX = bodyWorldX;
      state.lastBodyWorldZ = bodyWorldZ;
      return;
    }

    state.distanceWalked += speed * dt;
    if (state.distanceWalked > stride) {
      state.distanceWalked = 0;
      const sideSign = state.leftPlanted ? -1 : 1;
      if (state.leftPlanted) {
        state.rightFootX = bodyWorldX + forwardX * stride + sideX * hipWidth * sideSign;
        state.rightFootZ = bodyWorldZ + forwardZ * stride + sideZ * hipWidth * sideSign;
      } else {
        state.leftFootX = bodyWorldX + forwardX * stride + sideX * hipWidth * sideSign;
        state.leftFootZ = bodyWorldZ + forwardZ * stride + sideZ * hipWidth * sideSign;
      }
      state.leftPlanted = !state.leftPlanted;
    }

    state.lastBodyWorldX = bodyWorldX;
    state.lastBodyWorldZ = bodyWorldZ;
  }

  private getPredictedCenter() {
    if (!this.blob || this.visualX === null || this.visualY === null) return { x: 0, y: 0, vx: 0, vy: 0 };
    return {
      x: this.visualX + this.visualVx * GAME_RULES.CLIENT_PREDICTION_LEAD,
      y: this.visualY + this.visualVy * GAME_RULES.CLIENT_PREDICTION_LEAD,
      vx: this.visualVx,
      vy: this.visualVy,
    };
  }

  private stepVisual(dt: number): void {
    if (!this.blob || this.visualX === null || this.visualY === null) return;

    this.visualX += this.visualVx * dt;
    this.visualY += this.visualVy * dt;

    const targetX = this.blob.x;
    const targetY = this.blob.y;
    const errorX = targetX - this.visualX;
    const errorY = targetY - this.visualY;
    const error = Math.hypot(errorX, errorY);

    if (error > 5) {
      this.visualX = targetX;
      this.visualY = targetY;
    } else {
      const pull = Math.min(1, dt * VISUAL_CATCHUP);
      this.visualX += errorX * pull;
      this.visualY += errorY * pull;
    }

    this.visualVx += (this.blob.vx - this.visualVx) * Math.min(1, dt * 14);
    this.visualVy += (this.blob.vy - this.visualVy) * Math.min(1, dt * 14);

    const desiredDirX = this.visualVx;
    const desiredDirY = this.visualVy;
    const desiredSpeed = Math.hypot(desiredDirX, desiredDirY);
    const fallbackX = this.blob.targetX - this.visualX;
    const fallbackY = this.blob.targetY - this.visualY;
    const fallbackDist = Math.hypot(fallbackX, fallbackY);

    let nextForwardX = this.forwardX;
    let nextForwardY = this.forwardY;
    if (desiredSpeed > MIN_DIRECTION_SPEED) {
      nextForwardX = desiredDirX / desiredSpeed;
      nextForwardY = desiredDirY / desiredSpeed;
    } else if (fallbackDist > 0.5) {
      nextForwardX = fallbackX / fallbackDist;
      nextForwardY = fallbackY / fallbackDist;
    }

    const turn = Math.min(1, dt * DIRECTION_SMOOTHING);
    this.forwardX += (nextForwardX - this.forwardX) * turn;
    this.forwardY += (nextForwardY - this.forwardY) * turn;
    const forwardLen = Math.hypot(this.forwardX, this.forwardY);
    if (forwardLen > 0.0001) {
      this.forwardX /= forwardLen;
      this.forwardY /= forwardLen;
    } else {
      this.forwardX = 0;
      this.forwardY = 1;
    }
  }

  private getLayout() {
    if (!this.blob) {
      return { x: 0, y: 0, major: 1, minor: 1, heading: this.heading, stretchX: 0, stretchZ: 1 };
    }

    const center = this.getPredictedCenter();
    const combatContext = this.getCombatContext();
    const combatCenter = combatContext?.center ?? null;
    const engagedInCombat = !!combatContext && combatContext.enemies.length > 0;

    if (engagedInCombat && combatCenter) {
      this.setFormationForward(combatCenter.x - center.x, combatCenter.z - center.y);
      this.heading = Math.atan2(this.formationForwardX, this.formationForwardY);
      const axes = getSquadAxes(this.blob.unitCount, 0, 0, this.blob.spread);
      return {
        x: center.x,
        y: center.y,
        major: axes.major,
        minor: axes.minor,
        heading: this.heading,
        stretchX: this.formationForwardX,
        stretchZ: this.formationForwardY,
      };
    }

    const tx = this.blob.targetX - center.x;
    const ty = this.blob.targetY - center.y;
    const speed = Math.hypot(center.vx, center.vy);
    const moveDistance = Math.hypot(tx, ty);

    if (speed > MIN_DIRECTION_SPEED) {
      // Actively moving — face the current movement direction (follows path waypoints)
      this.setFormationForward(center.vx, center.vy);
    } else if (moveDistance > 0.5) {
      // Stationary but has a queued target — face it
      this.setFormationForward(tx, ty);
    }

    this.heading = Math.atan2(this.formationForwardX, this.formationForwardY);

    const { major, minor } = getSquadAxes(this.blob.unitCount, moveDistance, speed, this.blob.spread);
    return {
      x: center.x,
      y: center.y,
      major,
      minor,
      heading: this.heading,
      stretchX: this.formationForwardX,
      stretchZ: this.formationForwardY,
    };
  }

  public getRadius(): number {
    return this.blob?.radius ?? 0;
  }

  public getPredictedWorldCenter(): { x: number; z: number } {
    const center = this.getPredictedCenter();
    return { x: center.x, z: center.y };
  }

  public getApproxUnitWorldPosition(rank: number): { x: number; z: number } {
    const layout = this.getLayout();
    const count = Math.max(1, Math.min(this.blob?.unitCount ?? 1, INSTANCE_CAP));
    const slot = this.getSlotWorldOffset(Math.max(0, Math.min(rank, count - 1)), count, layout);
    return { x: layout.x + slot.x, z: layout.y + slot.z };
  }

  public render(dt: number): void {
    if (!this.blob) return;
    this.refreshUnitModelMeshesIfNeeded();
    this.combatAnimT += dt;

    this.visualTime += Math.min(0.05, dt);
    while (this.visualTime >= VISUAL_STEP) {
      this.stepVisual(VISUAL_STEP);
      this.visualTime -= VISUAL_STEP;
    }
    if (this.visualTime > 0) {
      this.stepVisual(this.visualTime);
      this.visualTime = 0;
    }

    const layout = this.getLayout();
    const visibleToMe =
      this.blob.ownerId === this.game.room.sessionId ||
      this.game.isWorldVisibleToMe(layout.x, layout.y);
    this.mesh.visible = visibleToMe;
    if (!visibleToMe) {
      this.selectionBeamDrawer.root.visible = false;
      this.selectionBrightBeamDrawer.root.visible = false;
      return;
    }
    const terrainY = getTerrainHeightAt(layout.x, layout.y, this.game.getTiles());
    const teamTint = new THREE.Color(this.game.getPlayerColor(this.blob.ownerId));
    UNIT_SELECTION_OUTLINE_COLOR.copy(getBrightTeamSelectionColor(teamTint));

    this.mesh.position.set(layout.x, terrainY, layout.y);
    this.mesh.rotation.y = 0;
    this.ovalRoot.rotation.y = layout.heading;

    this.ovalFill.scale.set(layout.minor, layout.major, 1);
    const selectedScale = this.isSelected() ? SELECTED_RING_OUTER_SCALE : UNSELECTED_RING_OUTER_SCALE;
    const ringOuterMinor = layout.minor * selectedScale;
    const ringOuterMajor = layout.major * selectedScale;
    const ringThicknessPx = this.isSelected() ? SELECTED_RING_THICKNESS_PX : UNSELECTED_RING_THICKNESS_PX;
    applySelectionRingScreenThickness(
      this.ovalRing,
      ringOuterMinor,
      ringOuterMajor,
      this.game.getOrbitWorldUnitsPerScreenPixel(),
      ringThicknessPx,
      SELECTED_RING_MIN_THICKNESS_WORLD,
      64
    );

    const zoomT = this.game.getCameraZoomOut01();
    const enemyZoom = !this.isMine() ? zoomT : 0;

    TEMP_OVAL_RING.copy(teamTint);
    TEMP_OVAL_RING.getHSL(_ovalHsl, THREE.SRGBColorSpace);
    if (_ovalHsl.l < 0.42) TEMP_OVAL_RING.offsetHSL(0, 0, 0.07);
    if (this.isSelected()) TEMP_OVAL_RING.copy(UNIT_SELECTION_OUTLINE_COLOR);
    TEMP_OVAL_FILL.copy(TEMP_OVAL_RING);

    this.ovalRing.material.color.copy(TEMP_OVAL_RING);
    this.ovalFill.material.color.copy(TEMP_OVAL_FILL);

    this.ovalFill.material.opacity = 0;
    this.ovalRing.material.opacity = this.isSelected()
      ? 1
      : this.isMine()
        ? 0.24 + zoomT * 0.08
        : 0.1 + enemyZoom * 0.28;

    const visualSpec = getUnitVisualSpec(this.blob.unitType);
    const unitRules = getUnitRules(this.blob.unitType);
    const usesAgentMeshes = visualSpec.modelSlot === "agent";
    const usesArcherMeshes = visualSpec.modelSlot === "archer";
    const usesSynthaurMeshes = visualSpec.modelSlot === "synthaur";
    const usesCentaurBody = visualSpec.animationFamily === "synthaur" && !hasUnitInstancedGlb("synthaur");
    const n = Math.min(this.blob.unitCount, INSTANCE_CAP);
    const directAttackTarget =
      this.blob.engagedTargetId.length === 0 ? this.getAttackTarget() : null;
    const rangedAttackTarget =
      unitRules.attackStyle === "ranged" ? directAttackTarget : null;
    const meleeBuildingTarget =
      unitRules.attackStyle === "melee" && directAttackTarget instanceof BuildingEntity
        ? (this.isBuildingAttackActive(directAttackTarget) ? directAttackTarget : null)
        : null;
    const rangedTargetInRange = this.isTargetInRangedAttackRange(rangedAttackTarget);
    const serverRangedAttacking = this.isServerRangedAttacking();

    this.villagerPickProxy.visible = visualSpec.easyPick;
    this.attackRangeRing.visible = this.isSelected() && unitRules.attackStyle === "ranged";
    if (this.attackRangeRing.visible) {
      this.attackRangeRing.scale.setScalar(unitRules.attackRange);
      this.attackRangeRing.material.color.copy(teamTint).offsetHSL(0, -0.08, 0.16);
      this.attackRangeRing.material.opacity = serverRangedAttacking || rangedTargetInRange ? 0.32 : 0.18;
    }

    const agentGlb = hasUnitInstancedGlb("agent");
    const archerGlb = hasUnitInstancedGlb("archer");
    for (const m of this.unitsAgent) {
      m.count = usesAgentMeshes ? n : 0;
      m.visible = usesAgentMeshes;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.opacity = 1;
      pm.transparent = false;
      if (!agentGlb) pm.color.copy(teamTint).offsetHSL(0, 0.02, 0.02);
    }

    for (const m of this.unitsArcher) {
      m.count = usesArcherMeshes ? n : 0;
      m.visible = usesArcherMeshes;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.opacity = 1;
      pm.transparent = false;
      if (!archerGlb) pm.color.copy(teamTint).offsetHSL(0, 0.02, 0.02);
    }

    for (const m of this.unitsWarband) {
      m.count =
        !usesAgentMeshes && !usesArcherMeshes && !usesSynthaurMeshes ? n : 0;
      m.visible =
        !usesAgentMeshes && !usesArcherMeshes && !usesSynthaurMeshes;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.opacity = 1;
      pm.transparent = false;
    }

    for (const m of this.unitsSynthaur) {
      m.count = usesSynthaurMeshes && !usesCentaurBody ? n : 0;
      m.visible = usesSynthaurMeshes && !usesCentaurBody;
      const pm = m.material as THREE.MeshStandardMaterial;
      pm.opacity = 1;
      pm.transparent = false;
    }

    this.unitsCentaur.count = usesCentaurBody ? n : 0;
    this.unitsCentaur.visible = usesCentaurBody;
    const centaurMat = this.unitsCentaur.material as THREE.MeshStandardMaterial;
    centaurMat.color.copy(teamTint).offsetHSL(0, 0.02, 0.04);
    centaurMat.opacity = 1;
    centaurMat.transparent = false;

    this.unitShield.count = visualSpec.usesShield ? n : 0;
    this.unitShield.visible = visualSpec.usesShield;
    (this.unitShield.material as THREE.MeshStandardMaterial).color
      .copy(teamTint).offsetHSL(0, 0.04, -0.14);

    const stepDt = Math.min(0.05, dt);
    if (this.needsUnitReassignment) {
      this.ensureUnitStateCount(n);
      this.reassignUnitStates(n, layout);
      this.needsUnitReassignment = false;
    }
    this.stepUnits(stepDt, layout);

    const combatContext = this.getCombatContext();
    const rightX = Math.cos(layout.heading);
    const rightZ = -Math.sin(layout.heading);
    const forwardX = Math.sin(layout.heading);
    const forwardZ = Math.cos(layout.heading);
    const tiles = this.game.getTiles();
    const combatEnemies = combatContext?.enemies ?? [];
    const enemyUnitCount = combatEnemies.reduce((sum, enemy) => sum + enemy.getUnitCount(), 0);
    const enemyPositions = combatEnemies.flatMap((enemy) =>
      Array.from({ length: enemy.getUnitCount() }, (_, index) => enemy.getRenderedUnitWorldPosition(index))
    );
    const rangedEnemyPositions =
      rangedAttackTarget instanceof BlobEntity
        ? Array.from(
            { length: rangedAttackTarget.getUnitCount() },
            (_, index) => rangedAttackTarget.getRenderedUnitWorldPosition(index)
          )
        : rangedAttackTarget instanceof BuildingEntity
          ? [rangedAttackTarget.getWorldCenter()]
          : [];
    const enemyLoads = enemyUnitCount > 0 ? new Array(enemyUnitCount).fill(0) : [];
    const combatZone = combatContext
      ? this.getCombatZone(combatContext.center.x, combatContext.center.z, combatContext.totalUnitCount)
      : null;
    this.selectionBeamDrawer.beginFrame();
    this.selectionBrightBeamDrawer.beginFrame();
    const useSelectionBeamDrawers = this.isSelected();
    this.selectionBeamDrawer.root.visible = useSelectionBeamDrawers;
    this.selectionBrightBeamDrawer.root.visible = useSelectionBeamDrawers;
    const drawBeam = useSelectionBeamDrawers
      ? this.selectionBeamDrawer.drawBeam.bind(this.selectionBeamDrawer)
      : this.game.drawBeam.bind(this.game);
    const drawBrightBeam = useSelectionBeamDrawers
      ? this.selectionBrightBeamDrawer.drawBeam.bind(this.selectionBrightBeamDrawer)
      : this.game.drawBrightBeam.bind(this.game);
    const pickupProgress =
      this.blob.gatherPhase === BlobGatherPhase.PICKING_UP
        ? this.getGatherPhaseProgress(stepDt, BlobGatherPhase.PICKING_UP)
        : 1;
    const dropoffProgress =
      this.blob.gatherPhase === BlobGatherPhase.DROPPING_OFF
        ? this.getGatherPhaseProgress(stepDt, BlobGatherPhase.DROPPING_OFF)
        : 0;
    const carriedDisplayCount =
      this.blob.gatherPhase === BlobGatherPhase.PICKING_UP && this.blob.unitType === UnitType.VILLAGER
        ? n
        : this.blob.carriedAmount > 0
          ? Math.min(n, Math.ceil(this.blob.carriedAmount / VILLAGER_CARRY_DISPLAY_CHUNK))
          : 0;
    const carriedResourceInstances: CarriedResourceInstance[] = [];
    for (let i = 0; i < n; i++) {
      const state = this.unitStates[i];
      let desiredWorldX = state.x;
      let desiredWorldZ = state.z;
      let targetWorldX = 0;
      let targetWorldZ = 0;
      const buildingAttackPlan = meleeBuildingTarget
        ? this.getBuildingAttackPlan(i, n, state, meleeBuildingTarget)
        : null;
      const combatPlan =
        enemyPositions.length > 0 && combatZone
          ? this.getCombatPlan(
              i,
              n,
              state,
              enemyPositions,
              enemyLoads,
              stepDt,
              combatZone
            )
          : null;
      if (combatPlan) {
        desiredWorldX = combatPlan.desiredWorldX;
        desiredWorldZ = combatPlan.desiredWorldZ;
        targetWorldX = combatPlan.targetWorldX;
        targetWorldZ = combatPlan.targetWorldZ;
        state.combatMode = combatPlan.mode;
      } else if (buildingAttackPlan) {
        desiredWorldX = buildingAttackPlan.desiredWorldX;
        desiredWorldZ = buildingAttackPlan.desiredWorldZ;
        targetWorldX = buildingAttackPlan.targetWorldX;
        targetWorldZ = buildingAttackPlan.targetWorldZ;
        state.combatMode = buildingAttackPlan.mode;
      } else {
        state.combatMode = "formation";
        state.combatTargetIndex = -1;
        state.combatJitterX = 0;
        state.combatJitterZ = 0;
        state.combatJitterVx = 0;
        state.combatJitterVz = 0;
      }
      if (!state.bodyReady) {
        state.bodyX = desiredWorldX;
        state.bodyZ = desiredWorldZ;
        state.bodyReady = true;
      } else {
        const bodyDx = desiredWorldX - state.bodyX;
        const bodyDz = desiredWorldZ - state.bodyZ;
        const bodyDist = Math.hypot(bodyDx, bodyDz);
        const moveSpeed =
          state.combatMode === "formation" ? UNIT_BODY_MAX_SPEED : UNIT_BODY_COMBAT_MAX_SPEED;
        const catchupGain =
          state.combatMode === "formation" ? UNIT_BODY_CATCHUP_GAIN : UNIT_BODY_COMBAT_CATCHUP_GAIN;
        const maxStep = catchupGain > 0
          ? Math.max(moveSpeed * stepDt, bodyDist * catchupGain * stepDt)
          : moveSpeed * stepDt;
        if (bodyDist <= maxStep || bodyDist < 1e-5) {
          state.bodyX = desiredWorldX;
          state.bodyZ = desiredWorldZ;
        } else {
          const scale = maxStep / bodyDist;
          state.bodyX += bodyDx * scale;
          state.bodyZ += bodyDz * scale;
        }
      }

      const collisionRadius = this.getUnitCollisionRadius();
      const currentTile = this.game.getTileAtWorld(state.bodyX, state.bodyZ);
      if (!currentTile?.canWalk) {
        const unstuck = this.game.getUnitCollisionSystem().findNearestWalkablePoint(
          desiredWorldX,
          desiredWorldZ,
          collisionRadius
        );
        state.bodyX = unstuck.x;
        state.bodyZ = unstuck.z;
        state.lastBodyWorldX = unstuck.x;
        state.lastBodyWorldZ = unstuck.z;
        state.feetReady = false;
      }
      const collisionFallbackX = desiredWorldX - state.bodyX || forwardX;
      const collisionFallbackZ = desiredWorldZ - state.bodyZ || forwardZ;
      const resolvedBody = this.game.getUnitCollisionSystem().resolveAndRegister({
        x: state.bodyX,
        z: state.bodyZ,
        previousX: state.lastBodyWorldX,
        previousZ: state.lastBodyWorldZ,
        fallbackX: collisionFallbackX,
        fallbackZ: collisionFallbackZ,
        radius: collisionRadius,
        moveTo: (x, z) => {
          state.bodyX = x;
          state.bodyZ = z;
        },
      });
      state.bodyX = resolvedBody.x;
      state.bodyZ = resolvedBody.z;

      const worldX = state.bodyX;
      const worldZ = state.bodyZ;
      const px = worldX - layout.x;
      const pz = worldZ - layout.y;
      const unitTerrainY = getTerrainHeightAt(worldX, worldZ, tiles);
      const hoverY = unitTerrainY - terrainY + BODY_FLOAT;
      const bodyVx = state.feetReady ? (worldX - state.lastBodyWorldX) / Math.max(stepDt, 1e-4) : this.visualVx;
      const bodyVz = state.feetReady ? (worldZ - state.lastBodyWorldZ) / Math.max(stepDt, 1e-4) : this.visualVy;
      let stepForwardX = forwardX;
      let stepForwardZ = forwardZ;
      const hasEnemyAssignment = state.combatMode !== "formation";
      const hasRangedAim = !hasEnemyAssignment && !!rangedAttackTarget && serverRangedAttacking;
      if (hasEnemyAssignment && (combatContext || meleeBuildingTarget)) {
        let faceDx = targetWorldX - worldX;
        let faceDz = targetWorldZ - worldZ;
        let faceDist = Math.hypot(faceDx, faceDz);
        if (faceDist < 1e-4 && combatContext) {
          const ec = combatContext.center;
          faceDx = ec.x - worldX;
          faceDz = ec.z - worldZ;
          faceDist = Math.hypot(faceDx, faceDz);
        }
        if (faceDist < 1e-4) {
          faceDx = 0;
          faceDz = 1;
          faceDist = 1;
        }
        stepForwardX = faceDx / faceDist;
        stepForwardZ = faceDz / faceDist;
      } else if (hasRangedAim && rangedEnemyPositions.length > 0) {
        const rangedTarget = rangedEnemyPositions[i % rangedEnemyPositions.length]!;
        const faceDx = rangedTarget.x - worldX;
        const faceDz = rangedTarget.z - worldZ;
        const faceDist = Math.hypot(faceDx, faceDz);
        if (faceDist > 1e-4) {
          stepForwardX = faceDx / faceDist;
          stepForwardZ = faceDz / faceDist;
        }
      }
      const bodySpeed = Math.hypot(bodyVx, bodyVz);
      let desiredFaceX = stepForwardX;
      let desiredFaceZ = stepForwardZ;
      if (bodySpeed > FOOT_IDLE_SPEED) {
        if (!hasEnemyAssignment) {
          desiredFaceX = bodyVx / bodySpeed;
          desiredFaceZ = bodyVz / bodySpeed;
        }
      }
      const facing = this.rotateFacingToward(
        state,
        desiredFaceX,
        desiredFaceZ,
        stepDt,
        hasEnemyAssignment ? UNIT_COMBAT_TURN_RATE : UNIT_MAX_TURN_RATE
      );
      stepForwardX = facing.x;
      stepForwardZ = facing.z;
      const sideX = -stepForwardZ;
      const sideZ = stepForwardX;

      this.updateFeet(
        state,
        worldX,
        worldZ,
        bodyVx,
        bodyVz,
        stepDt,
        stepForwardX,
        stepForwardZ,
        sideX,
        sideZ,
        FOOT_STRIDE * unitRules.visualScale,
        HIP_WIDTH * unitRules.visualScale
      );

      applyFamilyBodyMatrices({
        family: visualSpec.animationFamily,
        usesAgentMeshes,
        usesArcherMeshes,
        usesSynthaurMeshes,
        usesSynthaurFallback: usesCentaurBody,
        index: i,
        localX: px,
        localY: hoverY,
        localZ: pz,
        forwardX: stepForwardX,
        forwardZ: stepForwardZ,
        unitScale: unitRules.visualScale,
        unitsAgent: this.unitsAgent,
        unitsArcher: this.unitsArcher,
        unitsWarband: this.unitsWarband,
        unitsSynthaur: this.unitsSynthaur,
        unitsSynthaurFallback: this.unitsCentaur,
      });

      drawFamilyLegs({
        family: visualSpec.animationFamily,
        worldX,
        worldZ,
        unitTerrainY,
        bodySpeed,
        forwardX: stepForwardX,
        forwardZ: stepForwardZ,
        sideX,
        sideZ,
        unitType: this.blob.unitType,
        state,
        tiles,
        drawBeam,
      });

      state.attackCooldown = Math.max(0, state.attackCooldown - stepDt);
      if (hasRangedAim && rangedEnemyPositions.length > 0 && state.attackCooldown <= 0) {
        const targetPos = rangedEnemyPositions[i % rangedEnemyPositions.length]!;
        const targetY = getTerrainHeightAt(targetPos.x, targetPos.z, tiles) + BODY_FLOAT * 0.78;
        this.game.spawnArrowFx({
          fromX: worldX + stepForwardX * 0.35,
          fromY: unitTerrainY + BODY_FLOAT * 0.9,
          fromZ: worldZ + stepForwardZ * 0.35,
          toX: targetPos.x,
          toY: targetY,
          toZ: targetPos.z,
          speed: Math.max(1, unitRules.projectileSpeed),
        });
        state.attackCooldown = ARCHER_RELEASE_INTERVAL * (0.85 + Math.random() * 0.35);
      }

      drawFamilyEquipment({
        visualSpec,
        worldX,
        worldZ,
        unitTerrainY,
        bodySpeed,
        forwardX: stepForwardX,
        forwardZ: stepForwardZ,
        sideX,
        sideZ,
        unitType: this.blob.unitType,
        state,
        attackAnimT: this.combatAnimT,
        attackPose: state.combatMode === "attack" || hasRangedAim,
        carryTree: false,
        carryCompute: false,
        unitIndex: i,
        layoutX: layout.x,
        layoutZ: layout.y,
        terrainY,
        unitShield: this.unitShield,
        shieldIndex: i,
        drawBeam,
        drawBrightBeam,
      });

      if (this.blob.unitType === UnitType.VILLAGER && i < carriedDisplayCount) {
        if (this.blob.carriedResourceType === CarriedResourceType.MATERIAL) {
          const source = this.getGatherTreeSourcePosition(i);
          const dropoffTarget = this.getNearestOwnedDropoffCenter(worldX, worldZ);
          carriedResourceInstances.push(
            createDraggedTreeInstance({
              localX: worldX,
              localZ: worldZ,
              baseY: unitTerrainY,
              forwardX: stepForwardX,
              forwardZ: stepForwardZ,
              sideX,
              sideZ,
              scale: unitRules.visualScale,
            })
          );
          const inst = carriedResourceInstances[carriedResourceInstances.length - 1]!;
          inst.growT = 1;
          inst.pickupT = pickupProgress;
          inst.throwT = dropoffProgress;
          inst.bobPhase = this.combatAnimT * 15.6 + i * 0.7;
          inst.sourceX = source?.x;
          inst.sourceY = source?.y;
          inst.sourceZ = source?.z;
          inst.targetX = dropoffTarget?.x;
          inst.targetY = dropoffTarget?.y;
          inst.targetZ = dropoffTarget?.z;
        } else if (this.blob.carriedResourceType === CarriedResourceType.COMPUTE) {
          const source = this.getGatherComputeSourcePosition(i);
          const dropoffTarget = this.getNearestOwnedDropoffCenter(worldX, worldZ);
          carriedResourceInstances.push(
            createDraggedComputeInstance({
              localX: worldX,
              localZ: worldZ,
              baseY: unitTerrainY,
              forwardX: stepForwardX,
              forwardZ: stepForwardZ,
              sideX,
              sideZ,
              scale: unitRules.visualScale,
            })
          );
          const inst = carriedResourceInstances[carriedResourceInstances.length - 1]!;
          inst.growT = 1;
          inst.pickupT = pickupProgress;
          inst.throwT = dropoffProgress;
          inst.bobPhase = this.combatAnimT * 15.6 + i * 0.7;
          inst.sourceX = source?.x;
          inst.sourceY = source?.y;
          inst.sourceZ = source?.z;
          inst.targetX = dropoffTarget?.x;
          inst.targetY = dropoffTarget?.y;
          inst.targetZ = dropoffTarget?.z;
        } else if (this.blob.carriedResourceType === CarriedResourceType.BIOMASS) {
          const source = this.getGatherFarmSourcePosition(i);
          const dropoffTarget = this.getNearestOwnedDropoffCenter(worldX, worldZ);
          carriedResourceInstances.push(
            createDraggedPlantsInstance({
              localX: worldX,
              localZ: worldZ,
              baseY: unitTerrainY,
              forwardX: stepForwardX,
              forwardZ: stepForwardZ,
              sideX,
              sideZ,
              scale: unitRules.visualScale,
            })
          );
          const inst = carriedResourceInstances[carriedResourceInstances.length - 1]!;
          inst.growT = 1;
          inst.pickupT = pickupProgress;
          inst.throwT = dropoffProgress;
          inst.bobPhase = this.combatAnimT * 15.6 + i * 0.7;
          inst.sourceX = source?.x;
          inst.sourceY = source?.y;
          inst.sourceZ = source?.z;
          inst.targetX = dropoffTarget?.x;
          inst.targetY = dropoffTarget?.y;
          inst.targetZ = dropoffTarget?.z;
        }
      }
    }
    for (const m of this.unitsAgent) m.instanceMatrix.needsUpdate = true;
    for (const m of this.unitsArcher) m.instanceMatrix.needsUpdate = true;
    for (const m of this.unitsSynthaur) m.instanceMatrix.needsUpdate = true;
    this.unitsCentaur.instanceMatrix.needsUpdate = true;
    this.unitShield.instanceMatrix.needsUpdate = true;
    for (const m of this.unitsWarband) m.instanceMatrix.needsUpdate = true;
    this.selectionBeamDrawer.finishFrame();
    this.selectionBrightBeamDrawer.finishFrame();
    this.syncSelectionOutlineMeshes(UNIT_SELECTION_OUTLINE_COLOR);
    this.carriedResources.sync(carriedResourceInstances);

    this.updatePathLine(teamTint);
    this.updateTargetIndicator(Math.min(0.05, dt), terrainY);
  }

  private updatePathLine(teamTint: THREE.Color): void {
    const path = this.game.getBlobPath(this.id);
    if (!this.isSelected() || !this.isMine() || !path || path.length < 1) return;

    const tiles = this.game.getTiles();
    TEMP_PATH_COLOR.copy(teamTint).offsetHSL(0, -0.08, 0.22);

    const H = 0.55;
    const W = 0.32;
    const D = 0.18;

    // Skip waypoints the blob has already passed — find the one closest to current position.
    // Everything before it is behind the blob and should not be drawn.
    const center = this.getPredictedCenter();
    let firstIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(center.x - path[i]!.x, center.y - path[i]!.y);
      if (d < nearestDist) { nearestDist = d; firstIdx = i; }
    }

    // Draw: blob's current position → nearest remaining waypoint → … → destination
    let ax = center.x;
    let ay = center.y;
    let aTerrainY = getTerrainHeightAt(ax, ay, tiles);
    for (let i = firstIdx; i < path.length; i++) {
      const wp = path[i]!;
      const bTerrainY = getTerrainHeightAt(wp.x, wp.y, tiles);
      TEMP_A.set(ax,   aTerrainY + H, ay);
      TEMP_B.set(wp.x, bTerrainY + H, wp.y);
      this.game.drawBeam(TEMP_A, TEMP_B, W, D, TEMP_PATH_COLOR);
      ax = wp.x; ay = wp.y; aTerrainY = bTerrainY;
    }
  }

  private buildTargetIndicator(): void {
    const mat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });

    // Stationary target ring
    this.targetPinRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 48), mat(0.78));
    this.targetPinRing.rotation.x = -Math.PI / 2;
    this.targetPinRing.position.y = 0.05;

    // Expanding ping ring (animated in updateTargetIndicator)
    this.targetPingMesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.80, 48), mat(0));
    this.targetPingMesh.rotation.x = -Math.PI / 2;
    this.targetPingMesh.position.y = 0.06;

    // Small center disc
    this.targetDisc = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), mat(0.90));
    this.targetDisc.rotation.x = -Math.PI / 2;
    this.targetDisc.position.y = 0.07;

    this.targetGroup = new THREE.Group();
    this.targetGroup.add(this.targetPinRing, this.targetPingMesh, this.targetDisc);
    this.targetGroup.visible = false;

    // Dashed connector: two-point line updated each frame in-place
    const connGeom = new THREE.BufferGeometry();
    connGeom.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.targetConnector = new THREE.Line(
      connGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.20, depthWrite: false })
    );
    this.targetConnector.visible = false;
  }

  private updateTargetIndicator(dt: number, blobTerrainY: number): void {
    if (!this.blob || this.game.selectedEntityId !== this.id || !this.isMine()) {
      this.targetGroup.visible = false;
      this.targetConnector.visible = false;
      return;
    }

    const dx = this.blob.targetX - this.blob.x;
    const dy = this.blob.targetY - this.blob.y;
    if (Math.hypot(dx, dy) < 1.5) {
      this.targetGroup.visible = false;
      this.targetConnector.visible = false;
      return;
    }

    this.targetAnimT += dt;
    const tgtTerrainY = getTerrainHeightAt(this.blob.targetX, this.blob.targetY, this.game.getTiles());

    // Position group at target
    this.targetGroup.visible = true;
    this.targetGroup.position.set(this.blob.targetX, tgtTerrainY, this.blob.targetY);

    // Slowly rotate pin ring for liveliness
    this.targetPinRing.rotation.z = this.targetAnimT * 0.45;
    this.targetPinRing.material.color.copy(COLOR_MOVE_MARKER);
    const pinPulse = 1 + 0.06 * Math.sin(this.targetAnimT * 2.8);
    this.targetPinRing.scale.setScalar(pinPulse);

    // Cycling ping expansion: 0 → 1 over 1.8 s
    this.pingPhase = (this.pingPhase + dt / 1.8) % 1;
    const pingScale = 0.35 + this.pingPhase * 1.75;
    const pingAlpha = (1 - this.pingPhase) * 0.68;
    this.targetPingMesh.scale.setScalar(pingScale);
    this.targetPingMesh.material.opacity = pingAlpha;
    this.targetPingMesh.material.color.copy(COLOR_MOVE_MARKER);

    this.targetDisc.material.color.copy(COLOR_MOVE_MARKER);

    // Connector line: blob center → target
    const center = this.getPredictedCenter();
    const posAttr = this.targetConnector.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, center.x,            blobTerrainY + 0.12, center.y);
    posAttr.setXYZ(1, this.blob.targetX,   tgtTerrainY  + 0.12, this.blob.targetY);
    posAttr.needsUpdate = true;
    this.targetConnector.material.color.copy(COLOR_MOVE_MARKER);
    this.targetConnector.visible = true;
  }

  public isMine(): boolean {
    return this.blob !== null && this.game.isMyBlob(this.blob.ownerId);
  }

  public isSelected(): boolean {
    return this.blob !== null && this.game.selectedEntityId === this.id;
  }

  public containsWorldPoint(x: number, z: number): boolean {
    if (!this.blob) return false;
    const layout = this.getLayout();
    let { minor, major } = layout;
    const visualSpec = getUnitVisualSpec(this.blob.unitType);
    minor *= visualSpec.containsEllipseMult;
    major *= visualSpec.containsEllipseMult;
    const cos = Math.cos(-layout.heading);
    const sin = Math.sin(-layout.heading);
    const lx = (x - layout.x) * cos - (z - layout.y) * sin;
    const lz = (x - layout.x) * sin + (z - layout.y) * cos;
    return (lx * lx) / (minor * minor) + (lz * lz) / (major * major) <= 1.05;
  }

  public worldDistanceTo(x: number, z: number): number {
    if (!this.blob) return Infinity;
    const center = this.getPredictedCenter();
    return Math.hypot(x - center.x, z - center.y);
  }

  public getOwnerId(): string | null {
    return this.blob?.ownerId ?? null;
  }

  public getUnitCount(): number {
    return this.blob?.unitCount ?? 0;
  }

  public isInCombat(): boolean {
    return !!this.blob?.combatGroupId;
  }

  public getUnitType(): UnitTypeValue | null {
    return this.blob?.unitType ?? null;
  }

  public getHealth(): number {
    return this.blob?.health ?? 0;
  }

  public isStale(): boolean {
    return !this.game.room.state.blobs.get(this.id);
  }

  public isOwnedByMe(): boolean {
    return this.isMine();
  }

  public getSelectionInfo(): SelectionInfo | null {
    if (!this.blob) return null;
    const unitRules = getUnitRules(this.blob.unitType);
    const visualSpec = getUnitVisualSpec(this.blob.unitType);
    const enemy = !this.isMine();
    const engaged = this.blob.combatGroupId.length > 0;
    const isActive = this.blob.aggroMode === BlobAggroMode.ACTIVE;
    const carryingMaterial =
      this.blob.carriedAmount > 0 && this.blob.carriedResourceType === CarriedResourceType.MATERIAL;
    const carryingCompute =
      this.blob.carriedAmount > 0 && this.blob.carriedResourceType === CarriedResourceType.COMPUTE;
    const carryingBiomass =
      this.blob.carriedAmount > 0 && this.blob.carriedResourceType === CarriedResourceType.BIOMASS;
    const isGathering =
      this.blob.unitType === UnitType.VILLAGER &&
      (this.blob.gatherTargetKey.length > 0 || this.blob.gatherTargetBuildingId.length > 0);
    const carryCap = this.blob.unitType === UnitType.VILLAGER ? Math.max(1, this.blob.unitCount) * VILLAGER_CARRY_DISPLAY_CHUNK : 0;
    const statusSuffix =
      this.blob.gatherPhase === BlobGatherPhase.PICKING_UP
        ? " · Picking up"
        : this.blob.gatherPhase === BlobGatherPhase.DROPPING_OFF
          ? " · Dropping off"
          : carryingMaterial
            ? ` · Carry ${this.blob.carriedAmount}/${carryCap} material`
            : carryingCompute
              ? ` · Carry ${this.blob.carriedAmount}/${carryCap} compute`
              : carryingBiomass
                ? ` · Carry ${this.blob.carriedAmount}/${carryCap} biomass`
              : isGathering
                ? " · Harvesting"
                : "";
    const stanceActions = this.isMine()
      ? [
          { id: "aggro:active", label: "Active", active: isActive },
          { id: "aggro:passive", label: "Passive", active: !isActive },
        ]
      : [];
    const spreadActions =
      this.isMine() && visualSpec.supportsSpreadControls
        ? [
            { id: "spread:tight", label: "Tight", active: this.blob.spread === SquadSpread.TIGHT },
            { id: "spread:default", label: "Default", active: this.blob.spread === SquadSpread.DEFAULT },
            { id: "spread:wide", label: "Wide", active: this.blob.spread === SquadSpread.WIDE },
          ]
        : [];
    return {
      title: unitRules.label,
      detail: enemy
        ? `Enemy${engaged ? " · Engaged" : ""} · ${this.blob.unitCount} ${visualSpec.enemyDetailNoun}${unitRules.attackStyle === "ranged" ? ` · Range ${Math.round(unitRules.attackRange)}` : ""}`
        : `${visualSpec.idleDetail} · ${isActive ? "Active" : "Passive"}${engaged ? " · Engaged" : ""}${statusSuffix}${unitRules.attackStyle === "ranged" ? ` · Range ${Math.round(unitRules.attackRange)}` : ""}`,
      health: this.blob.health,
      maxHealth: getBlobMaxHealth(this.blob.unitType, this.blob.unitCount),
      color: this.game.getPlayerColor(this.blob.ownerId),
      actions: [...spreadActions, ...stanceActions],
      production: null,
    };
  }
}

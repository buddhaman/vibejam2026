import * as THREE from "three";
import { GAME_RULES, getUnitRules, type UnitType as UnitTypeValue } from "../../shared/game-rules.js";
import { getTerrainHeightAt, type TileView } from "./terrain.js";
import { applyStylizedShading } from "./stylized-shading.js";
import type { UnitVisualSpec } from "./unit-visual-config.js";

const DUMMY = new THREE.Object3D();
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const SHIELD_FWD = new THREE.Vector3();
const SHIELD_QUAT = new THREE.Quaternion();

const COLOR_LEG_BEAM = new THREE.Color(0x4a433a);
const COLOR_SWORD = new THREE.Color(0xd0d4dc);
const COLOR_SYNTHAUR_SWORD = new THREE.Color(0xe6e9f1);
const COLOR_BOW = new THREE.Color(0xa67642);
const COLOR_BOWSTRING = new THREE.Color(0xf3ead2);
const COLOR_BOW_ARROW = new THREE.Color(0xd9c8a1);

const BODY_FLOAT = GAME_RULES.UNIT_HEIGHT * 0.6;
const FOOT_GROUND_LIFT = 0.03;
const HIP_WIDTH = GAME_RULES.UNIT_RADIUS * 0.32;
const HIP_LIFT = GAME_RULES.UNIT_HEIGHT * 0.46;
const LEG_WIDTH = GAME_RULES.UNIT_RADIUS * 0.24;
const LEG_DEPTH = GAME_RULES.UNIT_RADIUS * 0.18;
const FOOT_IDLE_SPEED = 0.01;
const FOOT_STRIDE = GAME_RULES.UNIT_RADIUS * 1.05;

const SYNTHAUR_LEG_WIDTH = GAME_RULES.UNIT_RADIUS * 0.18;
const SYNTHAUR_LEG_DEPTH = GAME_RULES.UNIT_RADIUS * 0.14;
const SYNTHAUR_BODY_LIFT = GAME_RULES.UNIT_HEIGHT * 0.54;
const SYNTHAUR_BODY_LENGTH = GAME_RULES.UNIT_RADIUS * 1.7;
const SYNTHAUR_BODY_WIDTH = GAME_RULES.UNIT_RADIUS * 0.95;

const SHOULDER_H_FRAC = 0.78;
const SHOULDER_SIDE_FRAC = 0.30;
const ARM_LEN_FRAC = 0.30;
const SWORD_LEN_FRAC = 0.75;
const SWORD_W = 0.048;
const ARM_SWING_MAX = Math.PI * 0.4;
const ATTACK_SWING_MAX = Math.PI * 0.95;
const SHIELD_SWING_MAX = Math.PI * 0.06;
const SYNTHAUR_ARM_SWING_MAX = Math.PI * 0.52;
const SYNTHAUR_ATTACK_SWING_MAX = Math.PI * 1.18;
const SYNTHAUR_SWORD_LEN_FRAC = 1.02;
const SYNTHAUR_SWORD_WIDTH = 0.068;
const SYNTHAUR_SHOULDER_SIDE_FRAC = 0.36;
const SYNTHAUR_ARM_LEN_FRAC = 0.34;
const BOW_HALF_HEIGHT = GAME_RULES.UNIT_HEIGHT * 0.64;
const BOW_HALF_WIDTH = GAME_RULES.UNIT_RADIUS * 0.46;
const BOW_THICKNESS = 0.1;

export type UnitPoseState = {
  leftFootX: number;
  leftFootZ: number;
  rightFootX: number;
  rightFootZ: number;
  leftPlanted: boolean;
  distanceWalked: number;
  combatMode: "formation" | "chase" | "attack";
};

export function createSynthaurFallbackMesh(capacity: number): THREE.InstancedMesh {
  const geom = new THREE.BoxGeometry(
    GAME_RULES.UNIT_RADIUS * 1.7,
    GAME_RULES.UNIT_HEIGHT * 0.76,
    GAME_RULES.UNIT_RADIUS * 0.95
  );
  const mat = applyStylizedShading(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0.04,
  }));
  const mesh = new THREE.InstancedMesh(geom, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export function applyFamilyBodyMatrices(params: {
  family: UnitVisualSpec["animationFamily"];
  usesAgentMeshes: boolean;
  usesArcherMeshes: boolean;
  usesSynthaurMeshes: boolean;
  usesSynthaurFallback: boolean;
  index: number;
  localX: number;
  localY: number;
  localZ: number;
  forwardX: number;
  forwardZ: number;
  unitScale: number;
  unitsAgent: THREE.InstancedMesh[];
  unitsArcher: THREE.InstancedMesh[];
  unitsWarband: THREE.InstancedMesh[];
  unitsSynthaur: THREE.InstancedMesh[];
  unitsSynthaurFallback: THREE.InstancedMesh;
}): void {
  DUMMY.position.set(params.localX, params.localY, params.localZ);
  DUMMY.rotation.set(0, Math.atan2(params.forwardX, params.forwardZ), 0);
  DUMMY.scale.setScalar(params.unitScale);
  DUMMY.updateMatrix();

  if (params.usesSynthaurFallback) {
    DUMMY.position.y = params.localY + SYNTHAUR_BODY_LIFT * params.unitScale - BODY_FLOAT;
    DUMMY.updateMatrix();
    params.unitsSynthaurFallback.setMatrixAt(params.index, DUMMY.matrix);
    return;
  }
  if (params.usesSynthaurMeshes) {
    for (const mesh of params.unitsSynthaur) mesh.setMatrixAt(params.index, DUMMY.matrix);
    return;
  }
  if (params.usesArcherMeshes) {
    for (const mesh of params.unitsArcher) mesh.setMatrixAt(params.index, DUMMY.matrix);
    return;
  }
  if (params.usesAgentMeshes) {
    for (const mesh of params.unitsAgent) mesh.setMatrixAt(params.index, DUMMY.matrix);
    return;
  }
  for (const mesh of params.unitsWarband) mesh.setMatrixAt(params.index, DUMMY.matrix);
}

export function drawFamilyLegs(params: {
  family: UnitVisualSpec["animationFamily"];
  worldX: number;
  worldZ: number;
  unitTerrainY: number;
  bodySpeed: number;
  forwardX: number;
  forwardZ: number;
  sideX: number;
  sideZ: number;
  unitType: UnitTypeValue;
  state: UnitPoseState;
  tiles: Map<string, TileView>;
  drawBeam: (from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color) => void;
}): void {
  const unitRules = getUnitRules(params.unitType);
  if (params.family === "synthaur") {
    const vs = unitRules.visualScale;
    const gait = params.bodySpeed > FOOT_IDLE_SPEED
      ? Math.sin(params.state.distanceWalked / (FOOT_STRIDE * vs + 1e-6) * Math.PI * 2)
      : 0;
    const bodyLiftY = params.unitTerrainY + SYNTHAUR_BODY_LIFT * vs;
    const frontOffset = SYNTHAUR_BODY_LENGTH * 0.26 * vs;
    const rearOffset = -SYNTHAUR_BODY_LENGTH * 0.26 * vs;
    const sideOffset = SYNTHAUR_BODY_WIDTH * 0.24 * vs;
    const stepOffsetA = gait * FOOT_STRIDE * 0.32 * vs;
    const stepOffsetB = -gait * FOOT_STRIDE * 0.32 * vs;

    const drawLeg = (bodyAlong: number, bodySide: number, stepOffset: number) => {
      const hipX = params.worldX + params.forwardX * bodyAlong + params.sideX * bodySide;
      const hipZ = params.worldZ + params.forwardZ * bodyAlong + params.sideZ * bodySide;
      const footX = params.worldX + params.forwardX * (bodyAlong + stepOffset) + params.sideX * bodySide;
      const footZ = params.worldZ + params.forwardZ * (bodyAlong + stepOffset) + params.sideZ * bodySide;
      const footY = getTerrainHeightAt(footX, footZ, params.tiles) + FOOT_GROUND_LIFT;
      TEMP_A.set(hipX, bodyLiftY, hipZ);
      TEMP_B.set(footX, footY, footZ);
      params.drawBeam(TEMP_A, TEMP_B, SYNTHAUR_LEG_WIDTH * vs, SYNTHAUR_LEG_DEPTH * vs, COLOR_LEG_BEAM);
    };

    drawLeg(frontOffset, sideOffset, stepOffsetA);
    drawLeg(frontOffset, -sideOffset, stepOffsetB);
    drawLeg(rearOffset, sideOffset, stepOffsetB);
    drawLeg(rearOffset, -sideOffset, stepOffsetA);
    return;
  }

  const hipOffsetX = params.sideX * HIP_WIDTH * unitRules.visualScale;
  const hipOffsetZ = params.sideZ * HIP_WIDTH * unitRules.visualScale;
  const hipWorldY = params.unitTerrainY + HIP_LIFT * unitRules.visualScale;
  const leftFootTerrainY = getTerrainHeightAt(params.state.leftFootX, params.state.leftFootZ, params.tiles) + FOOT_GROUND_LIFT;
  const rightFootTerrainY = getTerrainHeightAt(params.state.rightFootX, params.state.rightFootZ, params.tiles) + FOOT_GROUND_LIFT;

  TEMP_A.set(params.worldX + hipOffsetX, hipWorldY, params.worldZ + hipOffsetZ);
  TEMP_B.set(params.state.leftFootX, leftFootTerrainY, params.state.leftFootZ);
  params.drawBeam(TEMP_A, TEMP_B, LEG_WIDTH * unitRules.visualScale, LEG_DEPTH * unitRules.visualScale, COLOR_LEG_BEAM);

  TEMP_A.set(params.worldX - hipOffsetX, hipWorldY, params.worldZ - hipOffsetZ);
  TEMP_B.set(params.state.rightFootX, rightFootTerrainY, params.state.rightFootZ);
  params.drawBeam(TEMP_A, TEMP_B, LEG_WIDTH * unitRules.visualScale, LEG_DEPTH * unitRules.visualScale, COLOR_LEG_BEAM);
}

export function drawFamilyEquipment(params: {
  visualSpec: UnitVisualSpec;
  worldX: number;
  worldZ: number;
  unitTerrainY: number;
  bodySpeed: number;
  forwardX: number;
  forwardZ: number;
  sideX: number;
  sideZ: number;
  unitType: UnitTypeValue;
  state: UnitPoseState;
  attackAnimT: number;
  attackPose: boolean;
  unitIndex: number;
  layoutX: number;
  layoutZ: number;
  terrainY: number;
  unitShield: THREE.InstancedMesh;
  shieldIndex: number;
  drawBeam: (from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color) => void;
  drawBrightBeam: (from: THREE.Vector3, to: THREE.Vector3, width: number, depth: number, color: THREE.Color) => void;
}): void {
  if (
    params.visualSpec.animationFamily !== "archer" &&
    !params.visualSpec.usesMeleeWeapon &&
    !params.visualSpec.usesShield
  ) return;
  const unitRules = getUnitRules(params.unitType);
  const vs = unitRules.visualScale;

  if (params.visualSpec.animationFamily === "archer") {
    const shoulderH = GAME_RULES.UNIT_HEIGHT * SHOULDER_H_FRAC * vs;
    const shoulderSide = GAME_RULES.UNIT_RADIUS * SHOULDER_SIDE_FRAC * vs;
    const armLen = GAME_RULES.UNIT_HEIGHT * ARM_LEN_FRAC * vs;
    const shoulderWorldY = params.unitTerrainY + shoulderH;
    const walkPhase = params.state.distanceWalked / (FOOT_STRIDE * vs + 1e-6);
    const isAttacking = params.attackPose;
    const isStriding = !isAttacking && params.bodySpeed > FOOT_IDLE_SPEED * 2;
    const attackPhase = params.attackAnimT * 9 + params.unitIndex * 0.37;
    const bowSwing = isAttacking
      ? -0.52 + Math.max(0, Math.sin(attackPhase)) * 1.15
      : isStriding
        ? Math.sin(walkPhase * Math.PI * 2) * 0.42
        : 0;

    const gripX =
      params.worldX - params.sideX * shoulderSide * 3.15 + params.forwardX * Math.cos(bowSwing) * armLen * 1.6;
    const gripY = shoulderWorldY + Math.sin(bowSwing) * armLen * 1.32;
    const gripZ =
      params.worldZ - params.sideZ * shoulderSide * 3.15 + params.forwardZ * Math.cos(bowSwing) * armLen * 1.6;
    const bowUp = isAttacking ? 0.28 : 0.18;

    const topX = gripX + params.sideX * BOW_HALF_WIDTH * vs;
    const topY = gripY + BOW_HALF_HEIGHT * vs + bowUp * vs;
    const topZ = gripZ + params.sideZ * BOW_HALF_WIDTH * vs;
    const midX = gripX + params.forwardX * BOW_HALF_WIDTH * 1.05 * vs;
    const midY = gripY;
    const midZ = gripZ + params.forwardZ * BOW_HALF_WIDTH * 1.05 * vs;
    const botX = gripX - params.sideX * BOW_HALF_WIDTH * vs;
    const botY = gripY - BOW_HALF_HEIGHT * vs + bowUp * vs;
    const botZ = gripZ - params.sideZ * BOW_HALF_WIDTH * vs;

    TEMP_A.set(topX, topY, topZ);
    TEMP_B.set(midX, midY, midZ);
    params.drawBrightBeam(TEMP_A, TEMP_B, BOW_THICKNESS * vs, BOW_THICKNESS * 0.7 * vs, COLOR_BOW);
    TEMP_A.set(midX, midY, midZ);
    TEMP_B.set(botX, botY, botZ);
    params.drawBrightBeam(TEMP_A, TEMP_B, BOW_THICKNESS * vs, BOW_THICKNESS * 0.7 * vs, COLOR_BOW);
    TEMP_A.set(topX, topY, topZ);
    TEMP_B.set(botX, botY, botZ);
    params.drawBrightBeam(TEMP_A, TEMP_B, BOW_THICKNESS * 0.28 * vs, BOW_THICKNESS * 0.18 * vs, COLOR_BOWSTRING);

    if (isAttacking) {
      const drawT = Math.max(0, Math.sin(attackPhase));
      const arrowTailX = gripX + params.forwardX * BOW_HALF_WIDTH * 0.3 * vs;
      const arrowTailY = gripY + drawT * 0.05;
      const arrowTailZ = gripZ + params.forwardZ * BOW_HALF_WIDTH * 0.3 * vs;
      const arrowTipX = arrowTailX + params.forwardX * GAME_RULES.UNIT_HEIGHT * 0.62 * vs;
      const arrowTipY = arrowTailY + drawT * 0.02;
      const arrowTipZ = arrowTailZ + params.forwardZ * GAME_RULES.UNIT_HEIGHT * 0.62 * vs;
      TEMP_A.set(arrowTailX, arrowTailY, arrowTailZ);
      TEMP_B.set(arrowTipX, arrowTipY, arrowTipZ);
      params.drawBrightBeam(TEMP_A, TEMP_B, BOW_THICKNESS * 0.22 * vs, BOW_THICKNESS * 0.22 * vs, COLOR_BOW_ARROW);
    }
    return;
  }

  const shoulderH = GAME_RULES.UNIT_HEIGHT * SHOULDER_H_FRAC * vs;
  const isSynthaur = params.visualSpec.animationFamily === "synthaur";
  const shoulderSide = GAME_RULES.UNIT_RADIUS * (isSynthaur ? SYNTHAUR_SHOULDER_SIDE_FRAC : SHOULDER_SIDE_FRAC) * vs;
  const armLen = GAME_RULES.UNIT_HEIGHT * (isSynthaur ? SYNTHAUR_ARM_LEN_FRAC : ARM_LEN_FRAC) * vs;
  const swordLen = GAME_RULES.UNIT_HEIGHT * (isSynthaur ? SYNTHAUR_SWORD_LEN_FRAC : SWORD_LEN_FRAC) * vs;
  const swordWidth = (isSynthaur ? SYNTHAUR_SWORD_WIDTH : SWORD_W) * vs;
  const shoulderWorldY = params.unitTerrainY + shoulderH;

  const walkPhase = params.state.distanceWalked / (FOOT_STRIDE * vs + 1e-6);
  const swingSign = params.state.leftPlanted ? 1 : -1;
  const isAttacking = params.attackPose;
  const isStriding = !isAttacking && params.bodySpeed > FOOT_IDLE_SPEED * 2;
  const attackPhase = params.attackAnimT * 9 + params.unitIndex * 0.37;
  const rightSwing = !params.visualSpec.usesMeleeWeapon
    ? 0
    : isAttacking
      ? -0.3 + Math.max(0, Math.sin(attackPhase)) * (isSynthaur ? SYNTHAUR_ATTACK_SWING_MAX : ATTACK_SWING_MAX)
      : isStriding
        ? Math.sin(walkPhase * Math.PI * 2) * swingSign * (isSynthaur ? SYNTHAUR_ARM_SWING_MAX : ARM_SWING_MAX)
        : 0;
  const leftSwing = !params.visualSpec.usesShield
    ? 0
    : isAttacking
      ? Math.sin(attackPhase * 0.85) * SHIELD_SWING_MAX * 0.8
      : isStriding
        ? Math.sin(walkPhase * Math.PI * 2) * (-swingSign) * SHIELD_SWING_MAX
        : 0;

  const rShX = params.worldX + params.sideX * shoulderSide;
  const rShZ = params.worldZ + params.sideZ * shoulderSide;
  const rFwd = Math.cos(rightSwing);
  const rUp = Math.sin(rightSwing);
  const handX = rShX + params.forwardX * rFwd * armLen;
  const handY = shoulderWorldY + rUp * armLen;
  const handZ = rShZ + params.forwardZ * rFwd * armLen;
  const tipX = handX + params.forwardX * rFwd * swordLen;
  const tipY = handY + rUp * swordLen;
  const tipZ = handZ + params.forwardZ * rFwd * swordLen;
  if (params.visualSpec.usesMeleeWeapon) {
    TEMP_A.set(handX, handY, handZ);
    TEMP_B.set(tipX, tipY, tipZ);
    params.drawBrightBeam(TEMP_A, TEMP_B, swordWidth, swordWidth, isSynthaur ? COLOR_SYNTHAUR_SWORD : COLOR_SWORD);
  }

  const lShX = params.worldX - params.sideX * shoulderSide;
  const lShZ = params.worldZ - params.sideZ * shoulderSide;
  const lFwd = Math.cos(leftSwing);
  const lUp = Math.sin(leftSwing);
  const shieldX = lShX + params.forwardX * lFwd * armLen;
  const shieldY = shoulderWorldY + lUp * armLen;
  const shieldZ = lShZ + params.forwardZ * lFwd * armLen;
  SHIELD_FWD.set(params.forwardX * lFwd, lUp, params.forwardZ * lFwd).normalize();
  SHIELD_QUAT.setFromUnitVectors(UP_AXIS, SHIELD_FWD);

  if (params.visualSpec.usesShield) {
    DUMMY.position.set(shieldX - params.layoutX, shieldY - params.terrainY, shieldZ - params.layoutZ);
    DUMMY.quaternion.copy(SHIELD_QUAT);
    DUMMY.scale.setScalar(vs);
    DUMMY.updateMatrix();
    params.unitShield.setMatrixAt(params.shieldIndex, DUMMY.matrix);
  }
}

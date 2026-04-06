import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GAME_RULES } from "../../shared/game-rules.js";

/** Merged torso + head for procedural villager / fallback unit mesh. */
export function createUnitBodyGeometry(): THREE.BufferGeometry {
  const torsoHeight = GAME_RULES.UNIT_HEIGHT * 0.72;
  const torsoWidth = GAME_RULES.UNIT_RADIUS * 1.12;
  const torsoDepth = GAME_RULES.UNIT_RADIUS * 0.72;
  const headRadius = GAME_RULES.UNIT_RADIUS * 0.34;
  const torso = new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth);
  torso.translate(0, torsoHeight * 0.5, 0);

  const head = new THREE.SphereGeometry(headRadius, 12, 10);
  head.translate(0, torsoHeight + headRadius * 1.6, 0);

  const merged = mergeGeometries([torso, head], false);
  if (!merged) throw new Error("createUnitBodyGeometry: mergeGeometries failed");
  return merged;
}

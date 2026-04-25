import * as THREE from "three";
import { BlobEntity } from "./blob-entity.js";
import { getTerrainHeightAt } from "./terrain.js";
import type { Game } from "./game.js";

const PROJECTED_TEXT_POS = new THREE.Vector3();

export type ProjectedWorldText = {
  sx: number;
  sy: number;
  amount: number;
  resourceType: number;
  age: number;
};

export type ProjectedAgentStatusLabel = {
  sx: number;
  sy: number;
  resourceType: number;
};

export function projectFloatingResourceTexts(
  game: Game,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  nowSec: number
): ProjectedWorldText[] {
  const projected: ProjectedWorldText[] = [];
  for (const text of game.getFloatingResourceTexts(nowSec)) {
    PROJECTED_TEXT_POS.set(text.x, getTerrainHeightAt(text.x, text.z, game.getTiles()) + 4.2, text.z);
    PROJECTED_TEXT_POS.project(camera);

    // Cheap cull before any HUD draw: skip clipped/off-screen world text.
    if (PROJECTED_TEXT_POS.z < -1 || PROJECTED_TEXT_POS.z > 1) continue;
    const sx = (PROJECTED_TEXT_POS.x * 0.5 + 0.5) * canvas.width;
    const sy = (-PROJECTED_TEXT_POS.y * 0.5 + 0.5) * canvas.height;
    if (sx < -120 || sx > canvas.width + 120 || sy < -80 || sy > canvas.height + 80) continue;

    projected.push({
      sx,
      sy,
      amount: text.amount,
      resourceType: text.resourceType,
      age: text.age,
    });
  }
  return projected;
}

export function projectAgentStatusLabels(
  game: Game,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): ProjectedAgentStatusLabel[] {
  const projected: ProjectedAgentStatusLabel[] = [];
  for (const entity of game.entities) {
    if (!(entity instanceof BlobEntity)) continue;
    if (!entity.isOwnedByMe()) continue;
    const resourceType = entity.getAgentResourceMarker();
    if (resourceType === null) continue;
    const center = entity.getPredictedWorldCenter();
    PROJECTED_TEXT_POS.set(center.x, getTerrainHeightAt(center.x, center.z, game.getTiles()) + 7.8, center.z);
    PROJECTED_TEXT_POS.project(camera);
    if (PROJECTED_TEXT_POS.z < -1 || PROJECTED_TEXT_POS.z > 1) continue;
    const sx = (PROJECTED_TEXT_POS.x * 0.5 + 0.5) * canvas.width;
    const sy = (-PROJECTED_TEXT_POS.y * 0.5 + 0.5) * canvas.height;
    if (sx < -120 || sx > canvas.width + 120 || sy < -80 || sy > canvas.height + 80) continue;
    projected.push({ sx, sy, resourceType });
  }
  return projected;
}

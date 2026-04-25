import {
  GAME_RULES,
  getTileCenter,
  getTileCoordsFromWorld,
  getTileKey,
} from "../../shared/game-rules.js";
import type { TileView } from "./terrain.js";

type Circle = {
  x: number;
  z: number;
  radius: number;
};

export type UnitCollisionQuery = Circle & {
  previousX: number;
  previousZ: number;
  fallbackX: number;
  fallbackZ: number;
};

const CELL_SIZE = GAME_RULES.UNIT_RADIUS * 4.2;
const TILE_PADDING = 0.015;
const UNIT_PADDING = 0.018;
const TILE_ITERATIONS = 3;
const UNIT_ITERATIONS = 2;

function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function stableFallback(x: number, z: number): { x: number; z: number } {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  const a = (h - Math.floor(h)) * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

export class UnitCollisionSystem {
  private readonly grid = new Map<string, Circle[]>();
  private tiles: Map<string, TileView> | null = null;

  public beginFrame(tiles: Map<string, TileView>): void {
    this.tiles = tiles;
    this.grid.clear();
  }

  public resolveAndRegister(query: UnitCollisionQuery): { x: number; z: number } {
    let x = query.x;
    let z = query.z;
    const radius = Math.max(0.05, query.radius);

    ({ x, z } = this.resolveTiles(x, z, radius));
    ({ x, z } = this.resolveUnits(x, z, radius, query));
    ({ x, z } = this.resolveTiles(x, z, radius));

    const circle = { x, z, radius };
    const minCx = Math.floor((x - radius) / CELL_SIZE);
    const maxCx = Math.floor((x + radius) / CELL_SIZE);
    const minCz = Math.floor((z - radius) / CELL_SIZE);
    const maxCz = Math.floor((z + radius) / CELL_SIZE);
    for (let czCell = minCz; czCell <= maxCz; czCell++) {
      for (let cxCell = minCx; cxCell <= maxCx; cxCell++) {
        const key = cellKey(cxCell, czCell);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(circle);
        else this.grid.set(key, [circle]);
      }
    }

    return { x, z };
  }

  public findNearestWalkablePoint(x: number, z: number, radius: number): { x: number; z: number } {
    const projected = this.resolveTiles(x, z, radius);
    const tile = this.getTile(projected.x, projected.z);
    if (tile?.canWalk) return projected;

    const { tx, tz } = getTileCoordsFromWorld(x, z);
    const tileSize = GAME_RULES.TILE_SIZE;
    const maxRing = 5;
    let best: { x: number; z: number; d2: number } | null = null;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const candidate = this.tiles?.get(getTileKey(tx + dx, tz + dz));
          if (!candidate?.canWalk) continue;
          const center = getTileCenter(candidate.tx, candidate.tz);
          const awayX = center.x - x;
          const awayZ = center.z - z;
          const len = Math.hypot(awayX, awayZ) || 1;
          const px = center.x - (awayX / len) * Math.max(radius, tileSize * 0.18);
          const pz = center.z - (awayZ / len) * Math.max(radius, tileSize * 0.18);
          const d2 = (px - x) ** 2 + (pz - z) ** 2;
          if (!best || d2 < best.d2) best = { x: px, z: pz, d2 };
        }
      }
      if (best) break;
    }
    return best ?? projected;
  }

  private resolveTiles(x: number, z: number, radius: number): { x: number; z: number } {
    if (!this.tiles || this.tiles.size === 0) return { x, z };
    for (let iter = 0; iter < TILE_ITERATIONS; iter++) {
      const { tx, tz } = getTileCoordsFromWorld(x, z);
      let moved = false;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tile = this.tiles.get(getTileKey(tx + dx, tz + dz));
          if (!tile || tile.canWalk) continue;
          const center = getTileCenter(tile.tx, tile.tz);
          const half = GAME_RULES.TILE_SIZE * 0.5;
          const minX = center.x - half;
          const maxX = center.x + half;
          const minZ = center.z - half;
          const maxZ = center.z + half;
          const closestX = Math.max(minX, Math.min(maxX, x));
          const closestZ = Math.max(minZ, Math.min(maxZ, z));
          let pushX = x - closestX;
          let pushZ = z - closestZ;
          let dist = Math.hypot(pushX, pushZ);

          if (dist < 1e-5) {
            const left = Math.abs(x - minX);
            const right = Math.abs(maxX - x);
            const top = Math.abs(z - minZ);
            const bottom = Math.abs(maxZ - z);
            const minSide = Math.min(left, right, top, bottom);
            if (minSide === left) {
              pushX = -1;
              pushZ = 0;
              dist = left;
            } else if (minSide === right) {
              pushX = 1;
              pushZ = 0;
              dist = right;
            } else if (minSide === top) {
              pushX = 0;
              pushZ = -1;
              dist = top;
            } else {
              pushX = 0;
              pushZ = 1;
              dist = bottom;
            }
            x += pushX * (dist + radius + TILE_PADDING);
            z += pushZ * (dist + radius + TILE_PADDING);
            moved = true;
            continue;
          }

          if (dist >= radius + TILE_PADDING) continue;
          const correction = radius + TILE_PADDING - dist;
          x += (pushX / dist) * correction;
          z += (pushZ / dist) * correction;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  private resolveUnits(
    x: number,
    z: number,
    radius: number,
    query: UnitCollisionQuery
  ): { x: number; z: number } {
    for (let iter = 0; iter < UNIT_ITERATIONS; iter++) {
      let moved = false;
      const minCx = Math.floor((x - radius) / CELL_SIZE) - 1;
      const maxCx = Math.floor((x + radius) / CELL_SIZE) + 1;
      const minCz = Math.floor((z - radius) / CELL_SIZE) - 1;
      const maxCz = Math.floor((z + radius) / CELL_SIZE) + 1;
      for (let czCell = minCz; czCell <= maxCz; czCell++) {
        for (let cxCell = minCx; cxCell <= maxCx; cxCell++) {
          const bucket = this.grid.get(cellKey(cxCell, czCell));
          if (!bucket) continue;
          for (const other of bucket) {
            const minDist = radius + other.radius + UNIT_PADDING;
            let dx = x - other.x;
            let dz = z - other.z;
            let dist = Math.hypot(dx, dz);
            if (dist >= minDist) continue;
            if (dist < 1e-5) {
              dx = query.x - query.previousX || query.fallbackX;
              dz = query.z - query.previousZ || query.fallbackZ;
              dist = Math.hypot(dx, dz);
              if (dist < 1e-5) {
                const fallback = stableFallback(query.previousX, query.previousZ);
                dx = fallback.x;
                dz = fallback.z;
                dist = 1;
              }
            }
            const correction = minDist - dist;
            x += (dx / dist) * correction;
            z += (dz / dist) * correction;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  private getTile(x: number, z: number): TileView | null {
    if (!this.tiles) return null;
    const { tx, tz } = getTileCoordsFromWorld(x, z);
    return this.tiles.get(getTileKey(tx, tz)) ?? null;
  }
}

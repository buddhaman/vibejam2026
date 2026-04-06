import { getTileCenter, getTileCoordsFromWorld, getTileKey, getWorldTileCount } from "../../shared/game-rules.js";

export type Waypoint = { x: number; y: number };

// --- Min-heap (open set) ---

type Node = {
  tx: number;
  tz: number;
  g: number;
  f: number;
  parent: Node | null;
};

class MinHeap {
  private items: Node[] = [];

  push(node: Node): void {
    this.items.push(node);
    this.up(this.items.length - 1);
  }

  pop(): Node | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.down(0);
    }
    return top;
  }

  get size(): number { return this.items.length; }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p]!.f <= this.items[i]!.f) break;
      const tmp = this.items[p]!; this.items[p] = this.items[i]!; this.items[i] = tmp;
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.items.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.items[l]!.f < this.items[s]!.f) s = l;
      if (r < n && this.items[r]!.f < this.items[s]!.f) s = r;
      if (s === i) break;
      const tmp = this.items[s]!; this.items[s] = this.items[i]!; this.items[i] = tmp;
      i = s;
    }
  }
}

// --- Line-of-sight (Bresenham) for path smoothing ---

function losCheck(
  ax: number, az: number,
  bx: number, bz: number,
  walkable: (tx: number, tz: number) => boolean
): boolean {
  const dx = Math.abs(bx - ax);
  const dz = Math.abs(bz - az);
  let x = ax, z = az;
  const sx = ax < bx ? 1 : -1;
  const sz = az < bz ? 1 : -1;
  let err = dx - dz;
  for (;;) {
    if (!walkable(x, z)) return false;
    if (x === bx && z === bz) return true;
    const e2 = err * 2;
    if (e2 > -dz) { err -= dz; x += sx; }
    if (e2 <  dx) { err += dx; z += sz; }
  }
}

/** Greedy string-pull: removes waypoints that are directly line-of-sight reachable, leaving only turns. */
function smoothPath(path: Node[], walkable: (tx: number, tz: number) => boolean): Node[] {
  if (path.length <= 2) return path;
  const out: Node[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !losCheck(path[i]!.tx, path[i]!.tz, path[j]!.tx, path[j]!.tz, walkable)) j--;
    i = j;
    out.push(path[i]!);
  }
  return out;
}

// --- 8-directional A* ---

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [0,  1, 1], [0, -1, 1], [ 1, 0, 1], [-1, 0, 1],
  [1,  1, SQRT2], [1, -1, SQRT2], [-1,  1, SQRT2], [-1, -1, SQRT2],
];

/**
 * A* on the tile grid with Bresenham string-pull smoothing.
 * Returns smoothed world-space waypoints (tile centers), or [] if goal is unreachable.
 */
export function findPath(
  startTx: number, startTz: number,
  goalTx: number, goalTz: number,
  walkable: (tx: number, tz: number) => boolean
): Waypoint[] {
  const N = getWorldTileCount();

  if (!walkable(goalTx, goalTz)) return [];
  if (startTx === goalTx && startTz === goalTz) {
    const c = getTileCenter(goalTx, goalTz);
    return [{ x: c.x, y: c.z }];
  }

  const idx = (tx: number, tz: number) => tz * N + tx;
  const h   = (tx: number, tz: number) => Math.hypot(tx - goalTx, tz - goalTz);

  const closed = new Uint8Array(N * N);
  const gBuf   = new Float64Array(N * N).fill(1e15);

  gBuf[idx(startTx, startTz)] = 0;
  const open = new MinHeap();
  open.push({ tx: startTx, tz: startTz, g: 0, f: h(startTx, startTz), parent: null });

  while (open.size > 0) {
    const cur = open.pop()!;
    const ck = idx(cur.tx, cur.tz);
    if (closed[ck]) continue;
    closed[ck] = 1;

    if (cur.tx === goalTx && cur.tz === goalTz) {
      const raw: Node[] = [];
      let n: Node | null = cur;
      while (n) { raw.unshift(n); n = n.parent; }
      return smoothPath(raw, walkable).map(n => {
        const c = getTileCenter(n.tx, n.tz);
        return { x: c.x, y: c.z };
      });
    }

    for (const [dtx, dtz, cost] of DIRS) {
      const ntx = cur.tx + dtx;
      const ntz = cur.tz + dtz;
      if (ntx < 0 || ntz < 0 || ntx >= N || ntz >= N) continue;
      if (!walkable(ntx, ntz)) continue;
      // Block diagonal movement through solid corners
      if (dtx !== 0 && dtz !== 0) {
        if (!walkable(cur.tx + dtx, cur.tz) || !walkable(cur.tx, cur.tz + dtz)) continue;
      }
      const nk = idx(ntx, ntz);
      if (closed[nk]) continue;
      const ng = cur.g + cost;
      if (ng >= gBuf[nk]) continue;
      gBuf[nk] = ng;
      open.push({ tx: ntx, tz: ntz, g: ng, f: ng + h(ntx, ntz), parent: cur });
    }
  }

  return [];
}

/**
 * Convenience wrapper: converts world positions to tile coords then calls findPath.
 */
export function findPathWorld(
  startX: number, startY: number,
  goalX: number, goalY: number,
  tileData: Map<string, { tx: number; tz: number; canWalk: boolean }>
): Waypoint[] {
  const walkable = (tx: number, tz: number) => tileData.get(getTileKey(tx, tz))?.canWalk ?? false;
  const start = getTileCoordsFromWorld(startX, startY);
  const goal  = getTileCoordsFromWorld(goalX,  goalY);
  return findPath(start.tx, start.tz, goal.tx, goal.tz, walkable);
}

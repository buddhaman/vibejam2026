import * as THREE from "three";
import { getDecodedBufferFromUrl, getMusicGainNodeForRouting, resumeAudioOnUserGesture } from "./audio-mixer.js";
import { publicAssetUrl } from "./asset-url.js";
import { getTerrainHeightAt, type TileView } from "./terrain.js";
import type { Game } from "./game.js";

const BATTLE_CRY_URLS = [
  publicAssetUrl("audio/battle/battle0.ogg"),
  publicAssetUrl("audio/battle/battle1.ogg"),
  publicAssetUrl("audio/battle/battle2.ogg"),
  publicAssetUrl("audio/battle/battle3.ogg"),
] as const;

/** Muted beyond this range (3D, world uu). */
const DIST_CUT = 300;
/** Reaches full loop headroom at or under this 3D distance. */
const DIST_LOUD = 32;
/** Frames of “no on-screen fight” before stopping the loop. */
const FRAMES_UNTIL_STOP = 8;
const LOOP_HEADROOM = 0.4;
const SMOOTH_S = 0.12;

const frustum = new THREE.Frustum();
const mProjView = new THREE.Matrix4();
const wPos = new THREE.Vector3();
const wCam = new THREE.Vector3();

type Play = { src: AudioBufferSourceNode; gain: GainNode; i: number };

type State = { t: "idle" } | { t: "loading"; g: number } | { t: "live"; p: Play; g: number };

const st: { s: State; miss: number; gen: number } = { s: { t: "idle" }, miss: 0, gen: 0 };

function dist01(d: number): number {
  if (d >= DIST_CUT) return 0;
  if (d <= DIST_LOUD) return 1;
  return 1 - (d - DIST_LOUD) / (DIST_CUT - DIST_LOUD);
}

function findBattle(
  game: Game,
  cam: THREE.PerspectiveCamera,
  tiles: Map<string, TileView> | null
): number | null {
  mProjView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(mProjView);

  const by = new Map<string, string>();
  game.room.state.blobs.forEach((_b, id) => {
    const b = _b as { combatGroupId?: string; unitCount?: number };
    if (!b.combatGroupId || b.unitCount == null) return;
    if (!by.has(b.combatGroupId)) by.set(b.combatGroupId, id as string);
  });

  let dBest = Number.POSITIVE_INFINITY;
  for (const id of by.values()) {
    const c = game.getBlobCombatContext(id);
    if (!c || c.enemies.length === 0) continue;
    const { x, z } = c.center;
    wPos.set(x, getTerrainHeightAt(x, z, tiles), z);
    if (!frustum.containsPoint(wPos)) continue;
    cam.getWorldPosition(wCam);
    dBest = Math.min(dBest, wCam.distanceTo(wPos));
  }
  if (dBest === Number.POSITIVE_INFINITY) return null;
  return dBest;
}

function shut(): void {
  st.gen++;
  if (st.s.t === "live") {
    try {
      st.s.p.src.stop(0);
    } catch {
      /* */
    }
    try {
      st.s.p.src.disconnect();
    } catch {
      /* */
    }
    try {
      st.s.p.gain.disconnect();
    } catch {
      /* */
    }
  }
  st.s = { t: "idle" };
  st.miss = 0;
}

function armLoad(g: number): void {
  const bus = getMusicGainNodeForRouting();
  const ctx = bus.context;
  if (ctx.state === "suspended") void ctx.resume();
  const idx = Math.floor(Math.random() * BATTLE_CRY_URLS.length);
  void (async () => {
    const buf = await getDecodedBufferFromUrl(BATTLE_CRY_URLS[idx]!);
    if (g !== st.gen) return;
    if (st.s.t !== "loading" || st.s.g !== g) return;
    if (!buf) {
      st.s = { t: "idle" };
      return;
    }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gNode = ctx.createGain();
      gNode.gain.value = 0;
      src.connect(gNode);
      gNode.connect(bus);
      src.start(0);
      st.s = { t: "live", p: { src, gain: gNode, i: idx }, g };
    } catch {
      st.s = { t: "idle" };
    }
  })();
}

/**
 * Plays at most one random looping battle-cry. Gain follows 3D distance to the
 * **nearest** on-screen skirmish (in frustum) and rides the music bus.
 */
export function updateBattleCryAmbience(
  game: Game,
  camera: THREE.PerspectiveCamera,
  tiles: Map<string, TileView> | null,
  _dt: number
): void {
  if (typeof window === "undefined") return;
  camera.updateMatrixWorld(true);
  resumeAudioOnUserGesture();

  const d3 = findBattle(game, camera, tiles);
  if (d3 != null) {
    st.miss = 0;
  } else {
    st.miss++;
  }

  if (d3 == null && st.miss >= FRAMES_UNTIL_STOP) {
    shut();
    return;
  }

  if (d3 == null) {
    if (st.s.t === "live") {
      const bus = getMusicGainNodeForRouting();
      st.s.p.gain.gain.setTargetAtTime(0, bus.context.currentTime, SMOOTH_S);
    }
    if (st.s.t === "loading") {
      st.gen++;
      st.s = { t: "idle" };
    }
    return;
  }

  if (st.s.t === "idle") {
    st.gen++;
    const g = st.gen;
    st.s = { t: "loading", g };
    armLoad(g);
  }

  if (st.s.t === "live") {
    const bus = getMusicGainNodeForRouting();
    const t = dist01(d3) * LOOP_HEADROOM;
    st.s.p.gain.gain.setTargetAtTime(t, bus.context.currentTime, SMOOTH_S);
  }
}

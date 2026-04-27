/**
 * Web Audio: separate SFX and music buses (independent gain), persisted levels,
 * and exclusive one-shot SFX (unit barks) with small random detune.
 */

const STORAGE_KEY = "vibejam-audio-v1";

type AudioStorage = {
  sfx: number;
  m: number;
  sm: boolean;
  mm: boolean;
};

/** SFX, music (BGM + battle on music bus). Music default kept soft for the main theme. */
const defaults: AudioStorage = { sfx: 0.45, m: 0.2, sm: false, mm: false };
let mem: AudioStorage = { ...defaults };

function readStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const j = JSON.parse(raw) as Partial<AudioStorage>;
    if (typeof j.sfx === "number" && j.sfx >= 0 && j.sfx <= 1) mem.sfx = j.sfx;
    if (typeof j.m === "number" && j.m >= 0 && j.m <= 1) mem.m = j.m;
    if (typeof j.sm === "boolean") mem.sm = j.sm;
    if (typeof j.mm === "boolean") mem.mm = j.mm;
  } catch {
    /* ignore */
  }
}

function writeStorage(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sfx: mem.sfx, m: mem.m, sm: mem.sm, mm: mem.mm } satisfies AudioStorage)
    );
  } catch {
    /* ignore */
  }
}

readStorage();

let ac: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
const bufferByUrl = new Map<string, Promise<AudioBuffer | null>>();
let exclusiveBarkSource: AudioBufferSourceNode | null = null;

function ensureContext(): AudioContext {
  if (ac) return ac;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("AudioContext not available");
  ac = new Ctx();
  sfxBus = ac.createGain();
  musicBus = ac.createGain();
  updateBusGains();
  sfxBus.connect(ac.destination);
  musicBus.connect(ac.destination);
  return ac;
}

function updateBusGains(): void {
  if (!sfxBus || !musicBus) return;
  const sfxL = mem.sm ? 0 : mem.sfx;
  const mL = mem.mm ? 0 : mem.m;
  sfxBus.gain.value = Math.min(1, Math.max(0, sfxL));
  musicBus.gain.value = Math.min(1, Math.max(0, mL));
}

/** User gesture: call on first interaction so playback is allowed. */
export function resumeAudioOnUserGesture(): void {
  try {
    const ctx = ac ?? ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* ignore */
  }
}

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = bufferByUrl.get(url);
  if (p) return p;
  const ctx = ensureContext();
  p = (async () => {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const arr = await r.arrayBuffer();
      return await ctx.decodeAudioData(arr);
    } catch {
      return null;
    }
  })();
  bufferByUrl.set(url, p);
  return p;
}

export function getDecodedBufferFromUrl(url: string): Promise<AudioBuffer | null> {
  return loadBuffer(url);
}

function stopExclusiveBark(): void {
  if (!exclusiveBarkSource) return;
  try {
    exclusiveBarkSource.stop();
  } catch {
    /* may already be stopped */
  }
  exclusiveBarkSource = null;
}

export type PlayExclusiveSfxOptions = {
  /** Extra linear multiplier on top of the SFX bus (0–1, default ~0.52 for voice barks). */
  clipLinear?: number;
  /** Random detune in cents (one-sided range). Default ~10.5 → ±10.5 cents. */
  pitchCentsMax?: number;
};

/**
 * Stops the previous exclusive line (barks) and plays `url` on the SFX bus with slight pitch wobble.
 */
export async function playExclusiveSfxFromUrl(url: string, options: PlayExclusiveSfxOptions = {}): Promise<void> {
  if (typeof window === "undefined") return;
  const clip =
    options.clipLinear ?? 0.52;
  const dMax = options.pitchCentsMax ?? 10.5;
  const detuneCents = (Math.random() * 2 - 1) * dMax;

  try {
    const ctx = ensureContext();
    resumeAudioOnUserGesture();
    if (!sfxBus) return;

    const buffer = await loadBuffer(url);
    if (!buffer) return;

    stopExclusiveBark();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (source.detune) {
      source.detune.value = detuneCents;
    } else {
      const rate = Math.pow(2, detuneCents / 1200);
      source.playbackRate.value = Math.min(1.12, Math.max(0.88, rate));
    }

    const clipGain = ctx.createGain();
    clipGain.gain.value = Math.min(1, Math.max(0, clip));
    source.connect(clipGain);
    clipGain.connect(sfxBus);

    exclusiveBarkSource = source;
    source.addEventListener(
      "ended",
      () => {
        if (exclusiveBarkSource === source) exclusiveBarkSource = null;
      },
      { once: true }
    );
    source.start(0);
  } catch {
    return;
  }
}

export function getSfxLevel01(): number {
  return mem.sfx;
}
export function setSfxLevel01(v: number): void {
  mem.sfx = Math.min(1, Math.max(0, v));
  updateBusGains();
  writeStorage();
}

export function getMusicLevel01(): number {
  return mem.m;
}
export function setMusicLevel01(v: number): void {
  mem.m = Math.min(1, Math.max(0, v));
  updateBusGains();
  writeStorage();
}

export function isSfxMuted(): boolean {
  return mem.sm;
}
export function setSfxMuted(m: boolean): void {
  mem.sm = m;
  updateBusGains();
  writeStorage();
}

export function isMusicMuted(): boolean {
  return mem.mm;
}
export function setMusicMuted(m: boolean): void {
  mem.mm = m;
  updateBusGains();
  writeStorage();
}

/** BGM + battle loop sources connect here; the user’s music fader and mute apply to the whole bus. */
export function getMusicGainNodeForRouting(): GainNode {
  ensureContext();
  return musicBus!;
}

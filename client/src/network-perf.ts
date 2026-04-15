import { Protocol } from "@colyseus/shared-types";
import type { Room } from "@colyseus/sdk";

type Counts = Record<number, number>;

function addCount(map: Counts, code: number, bytes: number): void {
  map[code] = (map[code] ?? 0) + bytes;
}

function protocolLabel(code: number): string {
  switch (code) {
    case Protocol.JOIN_ROOM:
      return "JOIN_ROOM";
    case Protocol.ERROR:
      return "ERROR";
    case Protocol.LEAVE_ROOM:
      return "LEAVE_ROOM";
    case Protocol.ROOM_DATA:
      return "ROOM_DATA";
    case Protocol.ROOM_STATE:
      return "ROOM_STATE";
    case Protocol.ROOM_STATE_PATCH:
      return "ROOM_STATE_PATCH";
    case Protocol.ROOM_DATA_SCHEMA:
      return "ROOM_DATA_SCHEMA";
    case Protocol.ROOM_DATA_BYTES:
      return "ROOM_DATA_BYTES";
    case Protocol.PING:
      return "PING";
    default:
      return `UNKNOWN_${code}`;
  }
}

function topContributors(counts: Counts, limit: number): string {
  const entries = Object.entries(counts)
    .map(([code, bytes]) => ({ code: Number(code), bytes }))
    .filter((e) => e.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
  if (entries.length === 0) return "—";
  return entries.map((e) => `${protocolLabel(e.code)}:${(e.bytes / 1024).toFixed(1)}KB`).join("  ");
}

export type NetworkPerfSnapshot = {
  enabled: boolean;
  downKbps: number;
  upKbps: number;
  rttMs: number | null;
  stateCallbacksPerSec: number;
  patchPerSec: number;
  fullStatePerSec: number;
  roomDataPerSec: number;
  blobs: number;
  buildings: number;
  players: number;
  topIn: string;
  topOut: string;
};

/**
 * Dev-only: toggle Colyseus WebSocket byte stats + RTT logging with Shift+G.
 * No-ops in production builds.
 */
export function attachDevNetworkPerf(room: Room): { tick: (now: number) => void; getSnapshot: () => NetworkPerfSnapshot } {
  if (!import.meta.env.DEV) {
    return {
      tick: () => {},
      getSnapshot: () => ({
        enabled: false,
        downKbps: 0,
        upKbps: 0,
        rttMs: null,
        stateCallbacksPerSec: 0,
        patchPerSec: 0,
        fullStatePerSec: 0,
        roomDataPerSec: 0,
        blobs: 0,
        buildings: 0,
        players: 0,
        topIn: "—",
        topOut: "—",
      }),
    };
  }

  let enabled = true;
  let wrapped = false;
  let lastLogTime = 0;

  let bytesInWindow = 0;
  let bytesOutWindow = 0;
  let inByCode: Counts = {};
  let outByCode: Counts = {};

  let patchFrames = 0;
  let fullStateFrames = 0;
  let roomDataInFrames = 0;
  let stateCallbacks = 0;

  let lastRttMs: number | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let snapshot: NetworkPerfSnapshot = {
    enabled: true,
    downKbps: 0,
    upKbps: 0,
    rttMs: null,
    stateCallbacksPerSec: 0,
    patchPerSec: 0,
    fullStatePerSec: 0,
    roomDataPerSec: 0,
    blobs: 0,
    buildings: 0,
    players: 0,
    topIn: "—",
    topOut: "—",
  };

  let stateUnsub: (() => void) | null = null;

  function ensureWrapped(): void {
    if (wrapped) return;
    wrapped = true;

    const conn = room.connection;
    const origSend = conn.send.bind(conn) as (data: Buffer | Uint8Array) => void;
    conn.send = (data: Buffer | Uint8Array) => {
      if (enabled) {
        const n = data.byteLength;
        bytesOutWindow += n;
        addCount(outByCode, data[0]!, n);
      }
      origSend(data);
    };

    const origSendUnreliable = conn.sendUnreliable.bind(conn) as (data: Buffer | Uint8Array) => void;
    conn.sendUnreliable = (data: Buffer | Uint8Array) => {
      if (enabled) {
        const n = data.byteLength;
        bytesOutWindow += n;
        addCount(outByCode, data[0]!, n);
      }
      origSendUnreliable(data);
    };

    const origOnMessage = conn.events.onmessage;
    conn.events.onmessage = (event: MessageEvent) => {
      if (enabled && event.data) {
        const buf = new Uint8Array(event.data as ArrayBuffer);
        const n = buf.byteLength;
        bytesInWindow += n;
        const code = buf[0]!;
        addCount(inByCode, code, n);
        if (code === Protocol.ROOM_STATE_PATCH) patchFrames++;
        else if (code === Protocol.ROOM_STATE) fullStateFrames++;
        else if (code === Protocol.ROOM_DATA) roomDataInFrames++;
      }
      origOnMessage?.(event);
    };
  }

  function attachStateCounter(): void {
    if (stateUnsub !== null) return;
    const onState = () => {
      if (enabled) stateCallbacks++;
    };
    room.onStateChange(onState);
    stateUnsub = () => room.onStateChange.remove(onState);
  }

  function detachStateCounter(): void {
    stateUnsub?.();
    stateUnsub = null;
  }

  ensureWrapped();
  attachStateCounter();
  lastLogTime = performance.now();
  pingInterval = setInterval(() => {
    if (!enabled || !room.connection?.isOpen) return;
    room.ping((ms) => {
      lastRttMs = ms;
    });
  }, 2000);
  room.ping((ms) => {
    lastRttMs = ms;
  });

  return {
    tick(now: number) {
      if (!enabled) return;
      if (now - lastLogTime < 1000) return;
      const dtSec = (now - lastLogTime) / 1000;
      lastLogTime = now;

      const downKbps = (bytesInWindow / 1024) / dtSec;
      const upKbps = (bytesOutWindow / 1024) / dtSec;

      const st = room.state as {
        blobs?: { size: number };
        buildings?: { size: number };
        players?: { size: number };
      };
      const blobs = st.blobs?.size ?? 0;
      const buildings = st.buildings?.size ?? 0;
      const players = st.players?.size ?? 0;
      snapshot = {
        enabled: true,
        downKbps,
        upKbps,
        rttMs: lastRttMs,
        stateCallbacksPerSec: stateCallbacks / dtSec,
        patchPerSec: patchFrames / dtSec,
        fullStatePerSec: fullStateFrames / dtSec,
        roomDataPerSec: roomDataInFrames / dtSec,
        blobs,
        buildings,
        players,
        topIn: topContributors(inByCode, 4),
        topOut: topContributors(outByCode, 4),
      };

      bytesInWindow = 0;
      bytesOutWindow = 0;
      inByCode = {};
      outByCode = {};
      patchFrames = 0;
      fullStateFrames = 0;
      roomDataInFrames = 0;
      stateCallbacks = 0;
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

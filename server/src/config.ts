function listenPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return 2567;
  }
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return n;
}

/** Gameplay constants — keep magic numbers out of the room. */
export const CONFIG = {
  PORT: listenPort(),
  TICK_HZ: 20,
  WORLD_MIN: -120,
  WORLD_MAX: 120,
  /** Units per second toward target */
  BLOB_MOVE_SPEED: 28,
  DEFAULT_BLOB_RADIUS: 4,
  DEFAULT_BLOB_HEALTH: 100,
  DEFAULT_UNIT_COUNT: 40,
  /** Offset between the two starter blobs */
  START_BLOB_SPACING: 10,
} as const;

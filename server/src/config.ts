import { GAME_RULES } from "../../shared/game-rules.js";

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

/** `npm run dev:server` sets NODE_ENV=development — keep Player uint16 fields ≤ 65535. */
const is_dev_server = process.env.NODE_ENV === "development";

export const CONFIG = {
  PORT: listenPort(),
  ...GAME_RULES,
  ...(is_dev_server
    ? {
        START_BIOMASS: 50_000,
        START_MATERIAL: 50_000,
        START_COMPUTE: 50_000,
        START_AGENT_UNIT_COUNT: 6,
        START_WARBAND_UNIT_COUNT: 100,
        START_ARCHER_UNIT_COUNT: 60,
        START_SYNTHAUR_UNIT_COUNT: 24,
        START_CENTAUR_UNIT_COUNT: 24,
        UNIT_TRAIN_TIME_MULTIPLIER: 0.1,
        KOTH_START_TIME_MS: 60_000,
      }
    : {}),
} as const;

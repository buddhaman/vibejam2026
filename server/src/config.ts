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

export const CONFIG = {
  PORT: listenPort(),
  ...GAME_RULES,
} as const;

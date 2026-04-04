#!/usr/bin/env node
/**
 * Blocks until something accepts TCP on the Colyseus port so `vite` does not
 * open the browser and proxy /matchmake before the game server is listening.
 * Port rules match server/src/config.ts (PORT env, default 2567).
 */
import { createConnection } from "node:net";

function listenPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") return 2567;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) return 2567;
  return n;
}

const port = listenPort();
const host = "127.0.0.1";

function tryConnect() {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port }, () => {
      sock.end();
      resolve();
    });
    sock.on("error", reject);
  });
}

async function main() {
  process.stderr.write(`[wait] Colyseus ${host}:${port}…\n`);
  for (;;) {
    try {
      await tryConnect();
      process.stderr.write(`[wait] ready.\n`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

main();

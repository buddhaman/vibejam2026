import { Client, type Room } from "@colyseus/sdk";
import { CLIENT_PROTOCOL_VERSION } from "../../shared/protocol.js";

function normalizedBasePath(): string {
  const raw = import.meta.env.BASE_URL || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

/**
 * In dev, talk to Colyseus through the Vite proxy (`/colyseus` → game server) so
 * `/matchmake` requests are same-origin and avoid CORS + `credentials: "include"`.
 * In production, keep Colyseus behind the same public base path so deployments
 * under a subpath (for example `/agi/`) do not need a separate public port.
 */
function colyseusEndpoint(): string {
  const basePath = normalizedBasePath();

  if (import.meta.env.DEV) {
    return `${window.location.origin}/colyseus`;
  }

  return new URL(`${basePath}colyseus`, window.location.origin).toString().replace(/\/$/, "");
}

export async function joinBattle(): Promise<Room> {
  const client = new Client(colyseusEndpoint());
  return client.joinOrCreate("battle", {
    protocolVersion: CLIENT_PROTOCOL_VERSION,
  });
}

/** Wait until synced state exposes the `blobs` collection. */
export function waitForSyncedGameState(room: Room): Promise<void> {
  const ok = (state: unknown) => {
    const s = state as { blobs?: unknown; terrainSeed?: unknown } | null | undefined;
    return s?.blobs != null && typeof s.terrainSeed === "number";
  };

  if (ok(room.state)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          "Timed out waiting for room state. Is the Colyseus server reachable from this page under the expected base path?"
        )
      );
    }, 15_000);

    room.onStateChange.once((state) => {
      clearTimeout(t);
      if (ok(state)) {
        resolve();
      } else {
        reject(
          new Error(
            "Room state missing `blobs` or `terrainSeed`. Ensure colyseus + @colyseus/sdk + @colyseus/schema versions match the server."
          )
        );
      }
    });
  });
}

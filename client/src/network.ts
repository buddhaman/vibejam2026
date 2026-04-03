import { Client, type Room } from "@colyseus/sdk";

/**
 * In dev, talk to Colyseus through the Vite proxy (`/colyseus` → game server) so
 * `/matchmake` requests are same-origin and avoid CORS + `credentials: "include"`.
 * In production, use the real game server origin (same host + port).
 */
function colyseusEndpoint(): string {
  const port =
    typeof import.meta.env.VITE_COLYSEUS_PORT === "string" &&
    import.meta.env.VITE_COLYSEUS_PORT.length > 0
      ? import.meta.env.VITE_COLYSEUS_PORT
      : "2567";

  if (import.meta.env.DEV) {
    return `${window.location.origin}/colyseus`;
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${port}`;
}

export async function joinBattle(): Promise<Room> {
  const client = new Client(colyseusEndpoint());
  return client.joinOrCreate("battle");
}

/** Wait until synced state exposes the `blobs` collection. */
export function waitForSyncedGameState(room: Room): Promise<void> {
  const ok = (state: unknown) => {
    const s = state as { blobs?: unknown } | null | undefined;
    return s?.blobs != null;
  };

  if (ok(room.state)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new Error(
          "Timed out waiting for room state. Is the Colyseus server running on the same port as this client?"
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
            "Room state missing `blobs`. Ensure colyseus + @colyseus/sdk + @colyseus/schema versions match the server."
          )
        );
      }
    });
  });
}

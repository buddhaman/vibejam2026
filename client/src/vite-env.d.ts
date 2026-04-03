/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Colyseus server port; must match `PORT` on the server. */
  readonly VITE_COLYSEUS_PORT?: string;
}

import { defineConfig } from "vite";

/** Must match the Colyseus server port (see `server/src/config.ts` / `PORT`). */
const colyseusPort = process.env.VITE_COLYSEUS_PORT ?? process.env.PORT ?? "2567";
const colyseusTarget = `http://127.0.0.1:${colyseusPort}`;
const publicBase = process.env.VITE_PUBLIC_BASE ?? "/";

export default defineConfig({
  root: ".",
  publicDir: "public",
  base: publicBase,
  server: {
    port: 5173,
    open: true,
    /**
     * Dev-only: proxy Colyseus HTTP + WebSocket through the Vite origin so
     * matchmaking is same-origin (avoids browser CORS + credentials issues on
     * `/matchmake`). Client uses `new Client(\`\${origin}/colyseus\`)` in dev.
     */
    proxy: {
      "/colyseus": {
        target: colyseusTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

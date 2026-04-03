import { CONFIG } from "./config.js";
import { gameServer } from "./app.config.js";

gameServer
  .listen(CONFIG.PORT)
  .then(() => {
    console.log(`[server] listening on http://localhost:${CONFIG.PORT}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

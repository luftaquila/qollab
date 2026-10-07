import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
const app = await createApp();
await app.listen({ port: config.port, host: config.host });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });

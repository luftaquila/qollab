import { createApplyApp } from "./app.js";
const app = await createApplyApp({
  origin: process.env.PUBLIC_ORIGIN || "http://localhost:3000",
  qollabOrigin: process.env.QOLLAB_INTERNAL_ORIGIN || "http://127.0.0.1:3000",
  database: process.env.APPLY_DATABASE || ".data/apply/state.sqlite",
  adminEmails: (process.env.APPLY_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
});
await app.listen({
  host: process.env.APPLY_HOST || "127.0.0.1",
  port: Number(process.env.APPLY_PORT || 3001),
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));

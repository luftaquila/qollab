// Test fixture process. This file is not copied into either production image.
import { mkdir, writeFile } from "node:fs/promises";
import { createApp } from "../apps/server/src/app.js";
import { pool } from "../apps/server/src/db.js";
import { token, hash } from "../apps/server/src/auth.js";
const app = await createApp({ logger: false });
const users = [];
for (const name of ["Alice", "Bob"]) {
  const raw = token(),
    csrf = token(),
    id = "e2e-" + name;
  // Alice has a Google profile photo; tests serve it from a stubbed route.
  await pool.query(
    "INSERT INTO users(id,email,name,picture) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET picture=$4",
    [
      id,
      name.toLowerCase() + "@example.com",
      name,
      name === "Alice" ? "https://lh3.googleusercontent.com/a/qollab-e2e" : null,
    ],
  );
  await pool.query(
    "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 hour')",
    [hash(raw), id, csrf],
  );
  users.push({ id, name, raw, csrf });
}
await mkdir("tmp", { recursive: true });
await writeFile("tmp/e2e-sessions.json", JSON.stringify(users), {
  mode: 0o600,
});
await app.listen({ host: "127.0.0.1", port: 3200 });

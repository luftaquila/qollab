import { resolve } from "node:path";
const number = (key: string, fallback: number) => {
  const n = Number(process.env[key] || fallback);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid ${key}`);
  return n;
};
const flag = (key: string) => {
  const value = (process.env[key] || "false").toLowerCase();
  if (!["true", "false"].includes(value))
    throw new Error(`${key} must be true or false`);
  return value === "true";
};
export const config = {
  port: number("PORT", 3000),
  host: process.env.HOST || "127.0.0.1",
  origin: process.env.PUBLIC_ORIGIN || "http://localhost:3000",
  database:
    process.env.DATABASE_URL ||
    "postgres://qollab:qollab-local@127.0.0.1:55432/qollab",
  data: resolve(process.env.DATA_DIR || ".data"),
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  workspace: process.env.GOOGLE_WORKSPACE_DOMAIN,
  approved:
    process.env.APPROVED_EMAILS?.split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean) || [],
  admission: process.env.ACCOUNT_POLICY || "approval",
  // Opt-in: anyone who can reach the server works as one shared guest account.
  anonymous: flag("ANONYMOUS_ACCESS"),
  rendererToken: process.env.RENDERER_TOKEN || "",
  adminToken: process.env.ADMIN_TOKEN || "",
  documentBytes: number("MAX_DOCUMENT_BYTES", 2 * 1024 * 1024),
  imageBytes: number("MAX_IMAGE_BYTES", 10 * 1024 * 1024),
  projectBytes: number("MAX_PROJECT_BYTES", 250 * 1024 * 1024),
  pixels: number("MAX_IMAGE_PIXELS", 40_000_000),
  historyBytes: number("MAX_HISTORY_BYTES", 1024 * 1024 * 1024),
  sessionHours: number("SESSION_HOURS", 168),
  debounce: number("BUILD_DEBOUNCE_MS", 2000),
  maxWait: number("BUILD_MAX_WAIT_MS", 10000),
  checkpointMs: number("CHECKPOINT_MS", 300000),
  buildSeconds: number("BUILD_TIMEOUT_SECONDS", 120),
};
if (!["all", "approval"].includes(config.admission))
  throw new Error("ACCOUNT_POLICY must be all or approval");
if (new URL(config.origin).origin !== config.origin)
  throw new Error("PUBLIC_ORIGIN must be an origin without a path");
if (process.env.NODE_ENV === "production") {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (config.rendererToken.length < 32 || config.adminToken.length < 32)
    throw new Error("Service tokens must contain at least 32 characters");
}

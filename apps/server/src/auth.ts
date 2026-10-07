import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "./config.js";
import { pool, Fault } from "./db.js";
export const token = () => randomBytes(32).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export interface Identity {
  id: string;
  email: string;
  name: string;
  csrf: string;
  session: string;
}
export async function identity(req: FastifyRequest): Promise<Identity> {
  const raw = req.cookies.qollab;
  if (!raw) throw new Fault("UNAUTHENTICATED", 401);
  const r = await pool.query(
    "SELECT u.*,s.csrf,s.id AS session FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires>now()",
    [hash(raw)],
  );
  if (!r.rowCount) throw new Fault("UNAUTHENTICATED", 401);
  return r.rows[0];
}
export function sameSecret(actual: string, expected: string) {
  return (
    !!expected &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export function requireOrigin(req: FastifyRequest) {
  if (req.headers.origin !== config.origin) throw new Fault("ORIGIN", 403);
}
export async function mutation(req: FastifyRequest) {
  requireOrigin(req);
  const user = await identity(req);
  if (!sameSecret(String(req.headers["x-csrf-token"] || ""), user.csrf))
    throw new Fault("CSRF", 403);
  return user;
}
export function validateClaims(
  claims: oidc.IDToken,
  policy = {
    workspace: config.workspace,
    admission: config.admission,
    approved: config.approved,
  },
) {
  if (
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  )
    throw new Fault("IDENTITY_CLAIMS", 403);
  if (policy.workspace && claims.hd !== policy.workspace)
    throw new Fault("WORKSPACE_REQUIRED", 403);
  if (
    policy.admission === "approval" &&
    !policy.approved.includes(claims.email.toLowerCase())
  )
    throw new Fault("ACCOUNT_APPROVAL", 403);
  return {
    id: claims.sub,
    email: claims.email,
    name: String(claims.name || claims.email),
  };
}
export async function establishSession(
  user: { id: string; email: string; name: string },
  reply: FastifyReply,
) {
  await pool.query(
    "INSERT INTO users VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET email=$2,name=$3",
    [user.id, user.email, user.name],
  );
  const raw = token(),
    csrf = token();
  await pool.query(
    "INSERT INTO sessions VALUES($1,$2,$3,now()+$4*interval '1 hour')",
    [hash(raw), user.id, csrf, config.sessionHours],
  );
  reply.setCookie("qollab", raw, {
    httpOnly: true,
    secure: config.origin.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionHours * 3600,
  });
  return csrf;
}
export async function authRoutes(
  app: FastifyInstance,
  disconnect: (id: string) => void,
  provided?: oidc.Configuration,
) {
  let client = provided;
  async function getClient() {
    if (client) return client;
    if (!config.clientId || !config.clientSecret)
      throw new Fault("OAUTH_UNCONFIGURED", 503);
    client = await oidc.discovery(
      new URL("https://accounts.google.com"),
      config.clientId,
      config.clientSecret,
      undefined,
      { execute: [oidc.enableNonRepudiationChecks] },
    );
    return client;
  }
  app.get("/api/session", async (req) => {
    let user: Identity | null = null;
    try {
      user = await identity(req);
    } catch {}
    return {
      user: user ? { id: user.id, email: user.email, name: user.name } : null,
      csrf: user?.csrf,
      oauthConfigured: !!provided || !!(config.clientId && config.clientSecret),
    };
  });
  app.get("/api/auth/google", async (req, reply) => {
    const c = await getClient(),
      state = token(),
      verifier = oidc.randomPKCECodeVerifier(),
      nonce = oidc.randomNonce();
    await pool.query(
      "INSERT INTO oidc_states VALUES($1,$2,$3,now()+interval '10 minutes')",
      [hash(state), verifier, nonce],
    );
    reply.setCookie("qollab_oidc", state, {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 600,
    });
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: config.origin + "/api/auth/callback",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    return reply.redirect(url.href);
  });
  app.get("/api/auth/callback", async (req, reply) => {
    const url = new URL(req.url, config.origin),
      state = url.searchParams.get("state") || "";
    if (!sameSecret(state, req.cookies.qollab_oidc || ""))
      throw new Fault("OIDC_STATE", 403);
    const r = await pool.query(
      "DELETE FROM oidc_states WHERE id=$1 AND expires>now() RETURNING *",
      [hash(state)],
    );
    if (!r.rowCount) throw new Fault("OIDC_STATE", 403);
    const row = r.rows[0];
    const tokens = await oidc.authorizationCodeGrant(await getClient(), url, {
      pkceCodeVerifier: row.verifier,
      expectedState: state,
      expectedNonce: row.nonce,
      idTokenExpected: true,
    });
    const user = validateClaims(tokens.claims()!);
    await establishSession(user, reply);
    reply.clearCookie("qollab_oidc", { path: "/api/auth" });
    return reply.redirect("/");
  });
  app.post("/api/logout", async (req, reply) => {
    const u = await mutation(req);
    await pool.query("DELETE FROM sessions WHERE id=$1", [u.session]);
    disconnect(u.id);
    reply.clearCookie("qollab", { path: "/" });
    return { ok: true };
  });
}

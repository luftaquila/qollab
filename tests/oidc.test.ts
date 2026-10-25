import { it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import {
  Configuration,
  allowInsecureRequests,
  enableNonRepudiationChecks,
} from "openid-client";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createApp } from "../apps/server/src/app.js";
import { pool } from "../apps/server/src/db.js";
import { config } from "../apps/server/src/config.js";
import { randomUUID } from "node:crypto";
const provider = Fastify();
let app: Awaited<ReturnType<typeof createApp>> | undefined;
afterAll(async () => {
  await app?.close();
  await provider.close();
  await pool.end();
});
it("completes a signed OIDC code+PKCE flow and rejects nonce, audience, signature and reused state", async () => {
  const pair = await generateKeyPair("RS256"),
    wrong = await generateKeyPair("RS256"),
    jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  jwk.use = "sig";
  let nonce = "",
    mode = "valid",
    challenge = "";
  provider.get("/jwks", async () => ({ keys: [jwk] }));
  provider.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_, body, done) => done(null, new URLSearchParams(body as string)),
  );
  provider.post("/token", async (req) => {
    const form = req.body as URLSearchParams;
    const { createHash } = await import("node:crypto");
    expect(
      createHash("sha256")
        .update(form.get("code_verifier")!)
        .digest("base64url"),
    ).toBe(challenge);
    const id_token = await new SignJWT({
      email: "oidc@example.com",
      email_verified: mode !== "unverified",
      name: "OIDC fixture",
      nonce: mode === "nonce" ? "bad" : nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("http://127.0.0.1:3101")
      .setSubject("oidc-sub")
      .setAudience(mode === "audience" ? "wrong" : "client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(mode === "signature" ? wrong.privateKey : pair.privateKey);
    return { access_token: "opaque", token_type: "Bearer", id_token };
  });
  await provider.listen({ host: "127.0.0.1", port: 3101 });
  const c = new Configuration(
    {
      issuer: "http://127.0.0.1:3101",
      authorization_endpoint: "http://127.0.0.1:3101/auth",
      token_endpoint: "http://127.0.0.1:3101/token",
      jwks_uri: "http://127.0.0.1:3101/jwks",
    },
    "client",
    "secret",
  );
  allowInsecureRequests(c);
  enableNonRepudiationChecks(c);
  app = await createApp({ oidc: c, logger: false });
  async function flow(next: string, destination = "/") {
    mode = next;
    const start = await app!.inject(
      "/api/auth/google?returnTo=" + encodeURIComponent(destination),
    );
    const url = new URL(start.headers.location!);
    nonce = url.searchParams.get("nonce")!;
    challenge = url.searchParams.get("code_challenge")!;
    const state = url.searchParams.get("state")!;
    const cookie = start.cookies.find((c) => c.name === "qollab_oidc")!;
    const callback = "/api/auth/callback?code=fixture&state=" + state;
    const result = await app!.inject({
      url: callback,
      headers: { cookie: `qollab_oidc=${cookie.value}` },
    });
    return { result, callback, cookie };
  }
  const ok = await flow("valid");
  expect(ok.result.statusCode, ok.result.body).toBe(302);
  expect(ok.result.cookies.some((c) => c.name === "qollab" && c.httpOnly)).toBe(
    true,
  );
  expect(
    (
      await app.inject({
        url: ok.callback,
        headers: { cookie: `qollab_oidc=${ok.cookie.value}` },
      })
    ).statusCode,
  ).toBe(403);
  for (const bad of ["nonce", "audience", "signature"])
    expect((await flow(bad)).result.statusCode).toBeGreaterThanOrEqual(400);
  const mismatched = await app.inject({
    url: "/api/auth/callback?code=x&state=bad",
    headers: { cookie: "qollab_oidc=different" },
  });
  expect(mismatched.statusCode).toBe(403);
  const admission = config.admission,
    approved = config.approved;
  const project = randomUUID();
  await pool.query(
    "INSERT INTO projects(id,name,data) VALUES($1,'Admission fixture','{}')",
    [project],
  );
  try {
    config.admission = "approval";
    config.approved = [];
    expect((await flow("valid")).result.json().code).toBe("ACCOUNT_APPROVAL");
    await pool.query(
      "INSERT INTO invites VALUES($1,$2,'OIDC@example.com','viewer',now()+interval '1 hour')",
      [randomUUID(), project],
    );
    expect((await flow("unverified")).result.json().code).toBe(
      "IDENTITY_CLAIMS",
    );
    expect(
      (await pool.query("SELECT * FROM members WHERE project_id=$1", [project]))
        .rowCount,
    ).toBe(0);
    // No account, approval-list entry or acceptance token is needed before first login.
    await pool.query("DELETE FROM sessions WHERE user_id='oidc-sub'");
    await pool.query("DELETE FROM users WHERE id='oidc-sub'");
    const destination = "/docs/p/" + project + "/chapter.html#rule";
    const invited = await flow("valid", destination);
    expect(invited.result.statusCode, invited.result.body).toBe(302);
    expect(invited.result.headers.location).toBe(destination);
    expect(
      (
        await pool.query(
          "SELECT user_id,role FROM members WHERE project_id=$1",
          [project],
        )
      ).rows,
    ).toEqual([{ user_id: "oidc-sub", role: "viewer" }]);
    expect(
      (await pool.query("SELECT * FROM invites WHERE project_id=$1", [project]))
        .rowCount,
    ).toBe(0);
    expect((await flow("valid", destination)).result.headers.location).toBe(
      destination,
    );
    // A removed member cannot reuse a former grant or an expired legacy invitation.
    await pool.query("DELETE FROM members WHERE project_id=$1", [project]);
    await pool.query(
      "INSERT INTO invites(id,project_id,email,role,expires) VALUES($1,$2,'oidc@example.com','viewer',now()-interval '1 second')",
      [randomUUID(), project],
    );
    expect((await flow("valid")).result.json().code).toBe("ACCOUNT_APPROVAL");
    await pool.query("INSERT INTO members VALUES($1,'oidc-sub','viewer')", [
      project,
    ]);
    expect(
      (await flow("valid", "/docs/p/" + project + "/chapter.html#rule")).result
        .headers.location,
    ).toBe("/docs/p/" + project + "/chapter.html#rule");
    expect(
      (await flow("valid", "https://evil.example/steal")).result.headers
        .location,
    ).toBe("/");
    await pool.query("DELETE FROM members WHERE project_id=$1", [project]);
    expect((await flow("valid")).result.json().code).toBe("ACCOUNT_APPROVAL");
    config.approved = ["oidc@example.com"];
    expect((await flow("valid", "/apply/")).result.headers.location).toBe(
      "/apply/",
    );
  } finally {
    config.admission = admission;
    config.approved = approved;
    await pool.query("DELETE FROM projects WHERE id=$1", [project]);
  }
});

import { beforeAll, afterAll, it, expect } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createApplyApp } from "../apps/apply/server/app";
import { pool } from "../apps/server/src/db";
import { config } from "../apps/server/src/config";
import { token, hash } from "../apps/server/src/auth";
import { FixtureSheets } from "./fixtures/apply-sheets";
import type { Connection, State } from "../apps/apply/server/model";
import { changeDigest } from "../apps/apply/server/model";
import { defaultNumbering } from "../packages/codec/src/numbering";
let core: Awaited<ReturnType<typeof createApp>>,
  tool: Awaited<ReturnType<typeof createApplyApp>>;
let failSave = false,
  loseSaveResponse = false;
const users: Record<string, { raw: string; csrf: string }> = {},
  sheets = new FixtureSheets();
const settings: Connection = {
  spreadsheetId: "fixture-spreadsheet",
  sheet: "Source",
  firstRow: 2,
  lastRow: 100,
  year: 2027,
  columns: {
    key: "A",
    context: [],
    source: ["B"],
    current: ["C"],
    notes: "D",
    decision: "E",
    timing: "F",
  },
  decisions: [
    { value: "Replace", action: "replace" },
    { value: "Hold", action: "hold" },
  ],
  timings: [
    { value: "2027", year: 2027 },
    { value: "2028", year: 2028 },
    { value: "Later", year: null },
  ],
};
const finalText = "New condition\n\nAdditional detail";
const source =
  "---\nformat: typst\n---\n\n```{=typst}\n#custom[untouched]\n```\n\n# Chapter {#scope}\n\nold condition\n\n# Other {#other}\n\nunchanged text\n";
const headers = (user = "owner") => ({
  cookie: "qollab=" + users[user].raw,
  origin: config.origin,
  "x-csrf-token": users[user].csrf,
});
const call = (path: string, method = "GET", body?: unknown, user = "owner") =>
  tool.inject({
    url: "/apply/api" + path,
    method: method as any,
    headers: headers(user),
    payload: body as any,
  });
const api = (path: string, method = "GET", body?: unknown, user = "owner") =>
  core.inject({
    url: "/api" + path,
    method: method as any,
    headers: headers(user),
    payload: body as any,
  });
beforeAll(async () => {
  core = await createApp({ logger: false });
  await pool.query(
    "TRUNCATE projects,users,sessions,oidc_states,updates,checkpoints,restores,builds,members,invites,audit CASCADE",
  );
  for (const user of ["owner", "editor", "viewer", "outsider"]) {
    users[user] = { raw: token(), csrf: token() };
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [
      user,
      user + "@example.com",
      user,
    ]);
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 day')",
      [hash(users[user].raw), user, users[user].csrf],
    );
  }
  tool = await createApplyApp({
    origin: config.origin,
    qollabOrigin: config.origin,
    database: ":memory:",
    sheets,
    logger: false,
    upstream: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const saving =
        init?.method === "PUT" &&
        url.pathname.endsWith("/raw") &&
        body?.source.includes("New condition");
      if (saving && failSave)
        return new Response(JSON.stringify({ code: "UNSAFE_BOUNDARY" }), {
          status: 409,
        });
      const response = await core.inject({
        url: url.pathname + url.search,
        method: init?.method as any,
        headers: init?.headers as any,
        payload: body,
      });
      if (saving && loseSaveResponse) {
        loseSaveResponse = false;
        throw new Error("Lost response");
      }
      return new Response(new Uint8Array(response.rawPayload), {
        status: response.statusCode,
        headers: response.headers as Record<string, string>,
      });
    }) as typeof fetch,
  });
});
afterAll(async () => {
  await tool.close();
  await core.close();
  await pool.end();
});
async function fixture() {
  const id = (await api("/projects", "POST", { name: "Apply fixture" })).json()
    .id;
  for (const [user, role] of [
    ["editor", "editor"],
    ["viewer", "viewer"],
  ])
    await pool.query("INSERT INTO members VALUES($1,$2,$3)", [id, user, role]);
  const project = (await api(`/projects/${id}`)).json(),
    file = project.data.files[0];
  const raw = (
    await api(`/projects/${id}/files/${file.id}/raw`, "POST", {
      revision: project.revision,
    })
  ).json();
  await api(`/projects/${id}/files/${file.id}/raw`, "PUT", {
    revision: raw.revision,
    epoch: raw.result.epoch,
    rawVersion: raw.result.rawVersion,
    source,
    visual: true,
  });
  const connection = settings;
  let response = await call(`/projects/${id}/connection`, "POST", {
    version: 0,
    connection,
  });
  expect(response.statusCode, response.body).toBe(200);
  response = await call(`/projects/${id}/import`, "POST", {
    version: response.json().version,
  });
  expect(response.statusCode, response.body).toBe(200);
  let state: State = response.json();
  const clause = state.clauses[0];
  response = await call(`/projects/${id}/clauses/${clause.id}/target`, "PUT", {
    version: state.version,
    fileId: file.id,
    anchor: "scope",
  });
  expect(response.statusCode, response.body).toBe(200);
  state = response.json();
  return {
    id,
    fileId: file.id,
    state,
    clauseId: clause.id,
  };
}
it("shows computed document numbers when choosing a clause target", async () => {
  const f = await fixture();
  const numbering = defaultNumbering();
  numbering.headings.enabled = true;
  numbering.headings.levels[0].format = "Article {n}";
  const saved = await api(`/projects/${f.id}/numbering`, "PATCH", {
    expected: null,
    numbering,
  });
  expect(saved.statusCode).toBe(200);
  const document = (
    await call(`/projects/${f.id}/document?fileId=${f.fileId}`)
  ).json();
  expect(document.sections.map((s: any) => s.number)).toEqual([
    "Article 1",
    "Article 2",
  ]);
});
it("refreshes sheet decisions while preserving target bindings without writing to the sheet", async () => {
  const f = await fixture();
  const sourceBefore = JSON.stringify(sheets.values);
  const refreshed = await call(`/projects/${f.id}/import`, "POST", {
    version: f.state.version,
  });
  expect(refreshed.statusCode).toBe(200);
  expect(refreshed.json().clauses[0].draft.final).toBe(finalText);
  expect(refreshed.json().clauses[0].id).toBe(f.clauseId);
  expect(JSON.stringify(sheets.values)).toBe(sourceBefore);
});
it("does not accept local edits of sheet decisions and clears stale timing on reimport", async () => {
  const f = await fixture();
  expect(
    (
      await call(`/projects/${f.id}/clauses/${f.clauseId}`, "PUT", {
        version: f.state.version,
        draft: { ...f.state.clauses[0].draft, year: 2099 },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call(`/projects/${f.id}/clauses/${f.clauseId}/target`, "PUT", {
        version: f.state.version,
        fileId: f.fileId,
        anchor: "scope",
        year: 2099,
      })
    ).statusCode,
  ).toBe(400);
  sheets.values.Source[1][5] = "";
  try {
    const imported = (
      await call(`/projects/${f.id}/import`, "POST", {
        version: f.state.version,
      })
    ).json();
    expect(imported.clauses[0].draft).toMatchObject({
      year: null,
      confirmed: false,
      anchor: "scope",
    });
    expect(
      (
        await call(`/projects/${f.id}/preview`, "POST", {
          version: imported.version,
          ids: [f.clauseId],
        })
      ).json().code,
    ).toBe("CLAUSE_NOT_READY");
    expect((await api(`/projects/${f.id}`)).json().data.files[0].source).toBe(
      source,
    );
  } finally {
    sheets.values.Source[1][5] = "2027";
  }
});
it("compares the current document after independent editor changes", async () => {
  const f = await fixture();
  const p = (await api(`/projects/${f.id}`)).json();
  const lock = (
    await api(`/projects/${f.id}/files/${f.fileId}/raw`, "POST", {
      revision: p.revision,
    })
  ).json();
  const edited = source.replace("old condition", "independent edit");
  await api(`/projects/${f.id}/files/${f.fileId}/raw`, "PUT", {
    revision: lock.revision,
    epoch: lock.result.epoch,
    rawVersion: lock.result.rawVersion,
    source: edited,
    visual: true,
  });
  const preview = await call(`/projects/${f.id}/preview`, "POST", {
    version: f.state.version,
    ids: [f.clauseId],
  });
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.json().state.clauses[0].draft.before).toBe("independent edit");
  expect(preview.json().plan.before).toBe(edited);
  expect(preview.json().plan.after).toBe(
    edited.replace("independent edit", finalText),
  );
});
it("records a deferred introduction and can later put the preserved proposal back", async () => {
  const f = await fixture();
  const numbering = defaultNumbering();
  numbering.headings.enabled = true;
  numbering.headings.levels[0].format = "Article {n}";
  expect(
    (
      await api(`/projects/${f.id}/numbering`, "PATCH", {
        expected: null,
        numbering,
      })
    ).statusCode,
  ).toBe(200);
  let state = f.state;
  for (const year of [null, 2027]) {
    const c = state.clauses.find((c) => c.id === f.clauseId)!;
    sheets.values.Source[1][5] = year === null ? "Later" : "2027";
    const review = await call(`/projects/${f.id}/import`, "POST", {
      version: state.version,
    });
    expect(review.statusCode, review.body).toBe(200);
    state = review.json();
    const preview = await call(`/projects/${f.id}/preview`, "POST", {
      version: state.version,
      ids: [c.id],
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const plan = preview.json().plan;
    expect(plan.after.includes("# Chapter {#scope}")).toBe(year === 2027);
    expect(plan.after).toContain("#custom[untouched]");
    expect(plan.after.includes("New condition")).toBe(year === 2027);
    expect(plan.references.after.other).toBe(
      year === 2027 ? "Article 2" : "Article 1",
    );
    const saved = await call(`/projects/${f.id}/apply`, "POST", {
      planId: plan.id,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    state = saved.json().state;
    const actual = state.clauses.find((c) => c.id === f.clauseId)!;
    expect(actual.draft.before).toBe(year === 2027 ? finalText : "");
    expect(actual.draft.final).toBe(finalText);
    expect(actual.appliedHash).toBe(changeDigest(actual));
    const again = await call(`/projects/${f.id}/apply`, "POST", {
      planId: plan.id,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().run.id).toBe(saved.json().run.id);
  }
});
it("requires a real Qollab identity, role, CSRF and project-owner connection settings", async () => {
  expect((await tool.inject("/apply/api/projects")).statusCode).toBe(401);
  const f = await fixture();
  expect(
    (await call(`/projects/${f.id}`, "GET", undefined, "outsider")).statusCode,
  ).toBe(404);
  expect(
    (await call(`/projects/${f.id}`, "GET", undefined, "viewer")).statusCode,
  ).toBe(200);
  expect(
    (
      await call(
        `/projects/${f.id}/import`,
        "POST",
        { version: f.state.version },
        "viewer",
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        `/projects/${f.id}/connection`,
        "POST",
        { version: f.state.version, connection: settings },
        "editor",
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await tool.inject({
        url: `/apply/api/projects/${f.id}/import`,
        method: "POST",
        headers: { cookie: "qollab=" + users.owner.raw, origin: config.origin },
        payload: { version: f.state.version },
      })
    ).statusCode,
  ).toBe(403);
});
it("previews exact changes, saves as the operator, checkpoints and makes retries idempotent", async () => {
  const f = await fixture();
  const before = (await api(`/projects/${f.id}`)).json();
  const preview = await call(
    `/projects/${f.id}/preview`,
    "POST",
    { version: f.state.version, ids: [f.clauseId] },
    "editor",
  );
  expect(preview.statusCode, preview.body).toBe(200);
  expect((await api(`/projects/${f.id}`)).json().revision).toBe(
    before.revision,
  );
  const plan = preview.json().plan;
  expect(plan.after).toBe(source.replace("old condition", finalText));
  const saved = await call(
    `/projects/${f.id}/apply`,
    "POST",
    { planId: plan.id },
    "editor",
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().run).toMatchObject({
    status: "applied",
    actor: "editor",
  });
  const current = (await api(`/projects/${f.id}`)).json();
  expect(current.data.files[0].source).toBe(plan.after);
  expect(current.data.files[0].mode).toBe("visual");
  const synced = (
    await call(`/projects/${f.id}/import`, "POST", {
      version: saved.json().state.version,
    })
  ).json();
  expect(synced.clauses[0].matches).toBe(true);
  const retry = await call(
    `/projects/${f.id}/apply`,
    "POST",
    { planId: plan.id },
    "editor",
  );
  expect(retry.statusCode).toBe(200);
  expect((await api(`/projects/${f.id}`)).json().revision).toBe(
    current.revision,
  );
  expect((await api(`/projects/${f.id}/changes`)).json()[0].actor).toBe(
    "editor",
  );
  expect(
    (await api(`/projects/${f.id}/history`))
      .json()
      .some((c: any) => c.label.startsWith("문서 반영 전")),
  ).toBe(true);
  const cloned = await call("/clone", "POST", {
    project: f.id,
    name: "Next edition",
  });
  expect(cloned.statusCode).toBe(200);
  expect(
    (await api(`/projects/${cloned.json().id}`)).json().data.files[0].source,
  ).toBe(plan.after);
});
it("stops when the sheet or document changes after review without writing stale content", async () => {
  const f = await fixture();
  let preview = (
    await call(`/projects/${f.id}/preview`, "POST", {
      version: f.state.version,
      ids: [f.clauseId],
    })
  ).json();
  sheets.values.Source[1][1] = "Changed source wording";
  expect(
    (
      await call(`/projects/${f.id}/apply`, "POST", { planId: preview.plan.id })
    ).json().code,
  ).toBe("SOURCE_CHANGED");
  sheets.values.Source[1][1] = "New condition";
  const p = (await api(`/projects/${f.id}`)).json();
  await api(`/projects/${f.id}`, "PATCH", {
    revision: p.revision,
    name: "Edited while comparing",
  });
  expect(
    (
      await call(`/projects/${f.id}/apply`, "POST", { planId: preview.plan.id })
    ).json().code,
  ).toBe("DOCUMENT_CHANGED");
  expect((await api(`/projects/${f.id}`)).json().data.files[0].source).toBe(
    source,
  );
});
it("recovers an acknowledged write whose HTTP response was lost without duplicating it", async () => {
  const f = await fixture(),
    p = (
      await call(`/projects/${f.id}/preview`, "POST", {
        version: f.state.version,
        ids: [f.clauseId],
      })
    ).json();
  loseSaveResponse = true;
  const result = await call(`/projects/${f.id}/apply`, "POST", {
    planId: p.plan.id,
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().run.status).toBe("applied");
  expect((await api(`/projects/${f.id}`)).json().data.files[0].source).toBe(
    source.replace("old condition", finalText),
  );
});
it("releases its raw editing lock on rejected content and safely retries the document change", async () => {
  const f = await fixture(),
    p = (
      await call(`/projects/${f.id}/preview`, "POST", {
        version: f.state.version,
        ids: [f.clauseId],
      })
    ).json();
  failSave = true;
  try {
    expect(
      (await call(`/projects/${f.id}/apply`, "POST", { planId: p.plan.id }))
        .statusCode,
    ).toBe(409);
  } finally {
    failSave = false;
  }
  const doc = (await api(`/projects/${f.id}`)).json().data.files[0];
  expect(doc.source).toBe(source);
  expect(doc.mode).toBe("visual");
  expect(doc.rawOwner).toBeUndefined();
  let state = (await call(`/projects/${f.id}`)).json().state;
  const next = (
    await call(`/projects/${f.id}/preview`, "POST", {
      version: state.version,
      ids: [f.clauseId],
    })
  ).json();
  const done = await call(`/projects/${f.id}/apply`, "POST", {
    planId: next.plan.id,
  });
  expect(done.statusCode, done.body).toBe(200);
  expect(done.json().run).toMatchObject({
    status: "applied",
  });
  const revision = (await api(`/projects/${f.id}`)).json().revision;
  const retry = await call(
    `/projects/${f.id}/runs/${done.json().run.id}/reconcile`,
    "POST",
    {},
  );
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().run.status).toBe("applied");
  expect((await api(`/projects/${f.id}`)).json().revision).toBe(revision);
});

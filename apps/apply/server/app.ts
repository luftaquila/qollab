import Fastify, { type FastifyRequest } from "fastify";
import staticPlugin from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { createTwoFilesPatch } from "diff";
import { ApplyStore } from "./store.js";
import { GoogleSheets, type Sheets } from "./sheets.js";
import {
  ApplyError,
  connectionSchema,
  draftSchema,
  digest,
  changeDigest,
  sourceRange,
  type State,
  type Clause,
  type Plan,
  type Run,
} from "./model.js";
import {
  sourceClauses,
  sections,
  patchDocument,
  scheduledText,
} from "./engine.js";

export interface ApplyOptions {
  origin: string;
  qollabOrigin: string;
  database: string;
  sheets?: Sheets;
  upstream?: typeof fetch;
  staticRoot?: string;
  logger?: boolean;
}
export async function createApplyApp(options: ApplyOptions) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 2 * 1024 * 1024,
  });
  const store = new ApplyStore(options.database),
    sheets = options.sheets || new GoogleSheets();
  const fetcher = options.upstream || fetch;
  const locks = new Map<string, Promise<unknown>>();
  async function lock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const current = (locks.get(id) || Promise.resolve())
      .catch(() => {})
      .then(work);
    locks.set(id, current);
    try {
      return await current;
    } finally {
      if (locks.get(id) === current) locks.delete(id);
    }
  }
  async function upstream(
    req: FastifyRequest,
    path: string,
    method = "GET",
    body?: unknown,
    binary = false,
  ): Promise<any> {
    const response = await fetcher(
      new URL("/api" + path, options.qollabOrigin),
      {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        headers: {
          cookie: req.headers.cookie || "",
          origin: options.origin,
          "content-type": "application/json",
          "x-csrf-token": String(req.headers["x-csrf-token"] || ""),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ code: "QOLLAB_UNAVAILABLE" }))) as any;
      throw new ApplyError(error.code || "QOLLAB_UNAVAILABLE", response.status);
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  const pid = (req: FastifyRequest) =>
    z
      .string()
      .uuid()
      .parse((req.params as any).pid);
  async function context(req: FastifyRequest, id?: string, role = "viewer") {
    const session = await upstream(req, "/session");
    if (!session.user || session.user.id === "anonymous")
      throw new ApplyError("UNAUTHENTICATED", 401);
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.origin !== options.origin)
        throw new ApplyError("ORIGIN", 403);
      const actual = Buffer.from(String(req.headers["x-csrf-token"] || "")),
        expected = Buffer.from(session.csrf || "");
      if (
        !expected.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new ApplyError("CSRF", 403);
    }
    const project = id ? await upstream(req, `/projects/${id}`) : undefined;
    const ranks: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };
    if (project && ranks[project.role] < ranks[role])
      throw new ApplyError("FORBIDDEN", 403);
    return { session, user: session.user, project };
  }
  const expectVersion = (state: State, version: unknown) => {
    if (state.version !== z.number().int().nonnegative().parse(version))
      throw new ApplyError("STATE_CHANGED", 409);
  };
  const connection = (state: State) => {
    if (!state.connection) throw new ApplyError("CONNECTION_REQUIRED", 409);
    return state.connection;
  };
  async function fresh(state: State) {
    const c = connection(state);
    const values = await sheets.read(c.spreadsheetId, sourceRange(c));
    return { clauses: sourceClauses(values, c, state.clauses) };
  }
  const selected = (clauses: Clause[], ids: string[]) =>
    ids.map((id) => {
      const clause = clauses.find((c) => c.id === id);
      if (!clause) throw new ApplyError("CLAUSE_NOT_FOUND", 409);
      return clause;
    });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply
      .header("Cache-Control", "private, no-store")
      .header("Vary", "Cookie")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "same-origin")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
    return payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApplyError)
      return reply
        .code(error.status)
        .send({ code: error.code, detail: error.detail });
    if (error instanceof ZodError)
      return reply.code(400).send({ code: "INVALID_REQUEST" });
    app.log.error(
      { message: error instanceof Error ? error.message : "Unknown error" },
      "Apply request failed",
    );
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });
  app.get("/apply/api/health", async () => ({ ok: true }));
  app.get("/apply/api/session", async (req) => {
    const s = await upstream(req, "/session");
    return {
      ...s,
      user: s.user?.id === "anonymous" ? null : s.user,
    };
  });
  app.get("/apply/api/projects", async (req) => {
    await context(req);
    return upstream(req, "/projects");
  });
  app.post("/apply/api/clone", async (req) => {
    const body = z
      .object({
        project: z.string().uuid(),
        name: z.string().trim().min(1).max(160),
      })
      .parse(req.body);
    await context(req, body.project);
    const zip = await upstream(
      req,
      `/projects/${body.project}/export`,
      "GET",
      undefined,
      true,
    );
    return upstream(req, "/import", "POST", {
      name: body.name,
      bytes: zip.toString("base64"),
    });
  });
  app.get("/apply/api/projects/:pid", async (req) => {
    const id = pid(req),
      { project } = await context(req, id);
    return {
      state: store.get(id),
      project: {
        id: project.id,
        name: project.name,
        role: project.role,
        revision: project.revision,
        files: project.data.files
          .filter((f: any) => f.kind === "document")
          .map((f: any) => ({ id: f.id, path: f.path })),
      },
    };
  });
  app.get("/apply/api/projects/:pid/document", async (req) => {
    const { project } = await context(req, pid(req));
    const id = z
      .string()
      .uuid()
      .parse((req.query as any).fileId);
    const file = project.data.files.find(
      (f: any) => f.id === id && f.kind === "document",
    );
    if (!file) throw new ApplyError("NOT_FOUND", 404);
    return {
      source: file.source,
      sections: sections(file.source),
      revision: project.revision,
    };
  });
  app.post("/apply/api/projects/:pid/connection", async (req) => {
    const id = pid(req);
    await context(req, id, "owner");
    const body = z
      .object({ version: z.number(), connection: connectionSchema })
      .parse(req.body);
    return lock(id, async () => {
      const state = store.get(id);
      expectVersion(state, body.version);
      const clauses = sourceClauses(
        await sheets.read(
          body.connection.spreadsheetId,
          sourceRange(body.connection),
        ),
        body.connection,
        [],
      );
      if (!clauses.length) throw new ApplyError("SHEET_EMPTY", 400);
      // Existing identities must not silently be attached to a different sheet.
      if (
        state.clauses.length &&
        state.connection &&
        digest([
          state.connection.spreadsheetId,
          state.connection.sheet,
          state.connection.columns.key,
          state.connection.columns.context,
        ]) !==
          digest([
            body.connection.spreadsheetId,
            body.connection.sheet,
            body.connection.columns.key,
            body.connection.columns.context,
          ])
      )
        throw new ApplyError("SOURCE_IDENTITY_CHANGED", 409);
      state.connection = body.connection;
      return store.put(id, state, state.version);
    });
  });
  app.post("/apply/api/projects/:pid/import", async (req) => {
    const id = pid(req);
    await context(req, id, "editor");
    return lock(id, async () => {
      const state = store.get(id);
      expectVersion(state, (req.body as any).version);
      const c = connection(state);
      const values = await sheets.read(c.spreadsheetId, sourceRange(c));
      const incoming = sourceClauses(values, c, state.clauses);
      const missing = state.clauses
        .filter((p) => !incoming.some((c) => c.id === p.id))
        .map((c) => ({ ...c, missing: true }));
      state.clauses = [...incoming, ...missing];
      return store.put(id, state, state.version);
    });
  });
  app.put("/apply/api/projects/:pid/clauses/:cid", async (req) => {
    const id = pid(req);
    await context(req, id, "editor");
    const cid = z
      .string()
      .uuid()
      .parse((req.params as any).cid);
    const body = z
      .object({ version: z.number(), draft: draftSchema })
      .parse(req.body);
    return lock(id, async () => {
      const state = store.get(id);
      expectVersion(state, body.version);
      const clause = state.clauses.find((c) => c.id === cid);
      if (!clause) throw new ApplyError("NOT_FOUND", 404);
      const current = await fresh(state),
        actual = current.clauses.find((c) => c.id === cid);
      if (!actual || actual.sourceHash !== clause.sourceHash)
        throw new ApplyError("SOURCE_CHANGED", 409);
      clause.draft = body.draft;
      clause.approvalHash = clause.sourceHash;
      return store.put(id, state, state.version);
    });
  });
  app.post("/apply/api/projects/:pid/preview", async (req) => {
    const id = pid(req);
    const { project } = await context(req, id, "editor");
    const body = z
      .object({
        version: z.number(),
        ids: z.array(z.string().uuid()).min(1).max(100),
      })
      .parse(req.body);
    if (new Set(body.ids).size !== body.ids.length)
      throw new ApplyError("DUPLICATE_SELECTION");
    return lock(id, async () => {
      const state = store.get(id);
      expectVersion(state, body.version);
      const current = await fresh(state),
        clauses = selected(current.clauses, body.ids);
      const fileId = clauses[0].draft.fileId;
      const file = project.data.files.find(
        (f: any) => f.id === fileId && f.kind === "document",
      );
      if (!file) throw new ApplyError("TARGET_REQUIRED", 409);
      if (file.mode !== "visual") throw new ApplyError("DOCUMENT_LOCKED", 409);
      const after = patchDocument(
        file.source,
        clauses,
        connection(state).year,
        fileId,
      );
      // Keep the preview tied to the exact imported source and reviewed draft.
      state.clauses = state.clauses.map(
        (c) =>
          current.clauses.find((n) => n.id === c.id) || { ...c, missing: true },
      );
      const saved = store.put(id, state, state.version);
      const plan: Plan = {
        id: randomUUID(),
        project: id,
        version: saved.version,
        fileId,
        revision: Number(project.revision),
        year: connection(state).year,
        before: file.source,
        after,
        ids: body.ids,
        digests: Object.fromEntries(
          clauses.map((c) => [c.id, changeDigest(c)]),
        ),
        sourceDigest: digest(clauses.map((c) => c.sourceHash)),
        expires: Date.now() + 10 * 60 * 1000,
      };
      store.plan(plan);
      return {
        state: saved,
        plan: {
          id: plan.id,
          file: file.path,
          revision: plan.revision,
          ids: plan.ids,
          before: plan.before,
          after: plan.after,
          diff: createTwoFilesPatch(
            file.path,
            file.path,
            plan.before,
            plan.after,
          ),
        },
      };
    });
  });
  async function finish(
    id: string,
    state: State,
    run: Run,
    plan: Plan,
    revision: number,
  ) {
    run.status = "applied";
    run.revision = revision;
    delete run.error;
    for (const clause of state.clauses)
      if (plan.ids.includes(clause.id)) {
        if (clause.draft.action === "schedule") {
          clause.draft.before = scheduledText(
            clause.draft,
            plan.year ?? connection(state).year,
          );
          clause.appliedHash = changeDigest(clause);
        } else clause.appliedHash = plan.digests[clause.id];
        clause.appliedRevision = revision;
        clause.appliedBy = run.actorName;
      }
    const saved = store.put(id, state, state.version);
    return { state: saved, run: saved.runs.find((r) => r.id === run.id)! };
  }
  app.post("/apply/api/projects/:pid/apply", async (req) => {
    const id = pid(req),
      { user } = await context(req, id, "editor");
    const { planId } = z.object({ planId: z.string().uuid() }).parse(req.body);
    return lock(id, async () => {
      let state = store.get(id);
      const existing = state.runs.find((r) => r.planId === planId);
      if (existing?.status === "applied") return { state, run: existing };
      if (existing) throw new ApplyError("RECOVERY_REQUIRED", 409);
      const plan = store.getPlan(planId, id);
      expectVersion(state, plan.version);
      const current = await fresh(state),
        clauses = selected(current.clauses, plan.ids);
      if (digest(clauses.map((c) => c.sourceHash)) !== plan.sourceDigest)
        throw new ApplyError("SOURCE_CHANGED", 409);
      if (
        patchDocument(
          plan.before,
          clauses,
          connection(state).year,
          plan.fileId,
        ) !== plan.after
      )
        throw new ApplyError("PLAN_CHANGED", 409);
      const project = await upstream(req, `/projects/${id}`),
        file = project.data.files.find((f: any) => f.id === plan.fileId);
      if (
        !file ||
        file.source !== plan.before ||
        Number(project.revision) !== plan.revision ||
        file.mode !== "visual"
      )
        throw new ApplyError("DOCUMENT_CHANGED", 409);
      const run: Run = {
        id: randomUUID(),
        planId,
        ids: plan.ids,
        fileId: plan.fileId,
        status: "pending",
        beforeHash: digest(plan.before),
        afterHash: digest(plan.after),
        actor: user.id,
        actorName: user.name,
        at: new Date().toISOString(),
      };
      state.runs.unshift(run);
      state = store.put(id, state, state.version);
      const savedRun = state.runs.find((r) => r.id === run.id)!;
      if (plan.before === plan.after)
        return finish(id, state, savedRun, plan, plan.revision);
      let locked: any;
      try {
        const checkpoint = await upstream(
          req,
          `/projects/${id}/history`,
          "POST",
          {
            revision: plan.revision,
            label: `문서 반영 전 · ${connection(state).year} · ${plan.ids.length}개`,
          },
        );
        savedRun.checkpoint = checkpoint.result.id;
        state = store.put(id, state, state.version);
        locked = await upstream(
          req,
          `/projects/${id}/files/${plan.fileId}/raw`,
          "POST",
          { revision: checkpoint.revision },
        );
        const result = await upstream(
          req,
          `/projects/${id}/files/${plan.fileId}/raw`,
          "PUT",
          {
            revision: locked.revision,
            epoch: locked.result.epoch,
            rawVersion: locked.result.rawVersion,
            source: plan.after,
            visual: true,
          },
        );
        return finish(id, state, savedRun, plan, Number(result.revision));
      } catch (error: any) {
        // A lost HTTP response does not prove that the write failed. Re-read before retrying.
        try {
          const latest = await upstream(req, `/projects/${id}`),
            f = latest.data.files.find((f: any) => f.id === plan.fileId);
          if (f?.source === plan.after)
            return finish(id, state, savedRun, plan, Number(latest.revision));
          if (
            f?.source === plan.before &&
            f.mode === "raw" &&
            f.rawOwner === user.id &&
            (!locked || f.epoch === locked.result.epoch)
          )
            await upstream(
              req,
              `/projects/${id}/files/${plan.fileId}/raw`,
              "PUT",
              {
                revision: Number(latest.revision),
                epoch: f.epoch,
                rawVersion: f.rawVersion,
                source: plan.before,
                visual: true,
              },
            );
          savedRun.status = f?.source === plan.before ? "failed" : "uncertain";
        } catch {
          savedRun.status = "uncertain";
        }
        savedRun.error =
          error instanceof ApplyError ? error.code : "APPLY_INTERRUPTED";
        store.put(id, state, state.version);
        throw new ApplyError(
          savedRun.status === "uncertain"
            ? "RECOVERY_REQUIRED"
            : savedRun.error,
          409,
        );
      }
    });
  });
  app.post("/apply/api/projects/:pid/runs/:rid/reconcile", async (req) => {
    const id = pid(req),
      { user } = await context(req, id, "editor");
    const rid = z
      .string()
      .uuid()
      .parse((req.params as any).rid);
    return lock(id, async () => {
      const state = store.get(id),
        run = state.runs.find((r) => r.id === rid);
      if (!run) throw new ApplyError("NOT_FOUND", 404);
      if (run.status === "applied") return { state, run };
      const project = await upstream(req, `/projects/${id}`),
        file = project.data.files.find((f: any) => f.id === run.fileId);
      if (file && digest(file.source) === run.afterHash)
        return finish(
          id,
          state,
          run,
          store.getPlan(run.planId, id, true),
          Number(project.revision),
        );
      if (file && digest(file.source) === run.beforeHash) {
        if (file.mode === "raw") {
          if (file.rawOwner !== user.id)
            throw new ApplyError("DOCUMENT_LOCKED", 409);
          await upstream(req, `/projects/${id}/files/${file.id}/raw`, "PUT", {
            revision: Number(project.revision),
            epoch: file.epoch,
            rawVersion: file.rawVersion,
            source: file.source,
            visual: true,
          });
        }
        run.status = "failed";
        run.error = "NO_DOCUMENT_CHANGE";
        return { state: store.put(id, state, state.version), run };
      }
      throw new ApplyError("DOCUMENT_CHANGED_AFTER_APPLY", 409);
    });
  });
  const root = resolve(options.staticRoot || "apps/apply/dist");
  if (existsSync(root)) {
    app.addHook("onRequest", async (req, reply) => {
      if (req.url.startsWith("/apply/api/")) return;
      try {
        await context(req);
      } catch (e) {
        if (e instanceof ApplyError && e.status === 401)
          return reply.redirect("/?returnTo=" + encodeURIComponent(req.url));
        throw e;
      }
    });
    await app.register(staticPlugin, { root, prefix: "/apply/" });
    app.get("/apply", async (_req, reply) => reply.redirect("/apply/"));
  }
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ code: "NOT_FOUND" }),
  );
  app.addHook("onClose", async () => {
    await Promise.allSettled([...locks.values()]);
    store.close();
  });
  return app;
}

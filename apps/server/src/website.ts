import type { FastifyInstance } from "fastify";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  symlink,
  rm,
} from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import { z } from "zod";
import { config } from "./config.js";
import { Fault, pool } from "./db.js";
import { identity, mutation } from "./auth.js";
import { access, observeEvents } from "./store.js";
import { content } from "./blobs.js";
import type { Project } from "./model.js";
import { renderDocument } from "../../web/src/web-document.js";
import { webFormatSource } from "../../../packages/codec/src/web-format.js";
import { WebsiteRefresh } from "./website-refresh.js";
const exec = promisify(execFile);
const hash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 16);
// Invalidate generated themes while retaining old chunks for already-open tabs.
const siteGenerations = ["websites-v4", "websites-v3", "websites-v2"];
export const websiteBase = (id: string) =>
  config.docsProject === id ? "/docs/" : `/docs/p/${id}/`;
const siteRoot = (id: string, revision: number, portable = false) =>
  resolve(
    config.data,
    siteGenerations[0],
    id,
    String(revision),
    portable ? "portable" : "hosted",
  );
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const siteCss = `.document-content li[data-marker]{position:relative;list-style:none}.document-content li[data-marker]::before{content:attr(data-marker);position:absolute;right:calc(100% + .5em);white-space:nowrap}.document-content .document-table{overflow:auto}.document-content .document-table table{width:100%;display:table}.document-content figure{margin:24px 0;text-align:center}.document-content figure img{max-width:100%;height:auto;margin:auto}.document-content figcaption{font-size:.9em;margin-top:8px}.document-content .katex-display{overflow:auto}`;
/** Each build has only this project's content, local search index, theme and assets. */
export async function buildWebsite(project: Project, portable = false) {
  const root = siteRoot(project.id, project.revision, portable),
    dist = resolve(root, ".vitepress/dist");
  if (
    existsSync(resolve(root, "build.complete")) &&
    existsSync(resolve(dist, "index.html")) &&
    existsSync(resolve(dist, "site-version.json"))
  )
    return dist;
  const base = portable ? "/" : websiteBase(project.id);
  await mkdir(resolve(root, ".vitepress/theme"), { recursive: true });
  await mkdir(resolve(root, "public/media"), { recursive: true });
  if (!existsSync(resolve(root, "node_modules")))
    await symlink(resolve("node_modules"), resolve(root, "node_modules"));
  const docs = project.data.files.filter((f) => f.kind === "document");
  const media = new Map<string, string>();
  for (const file of project.data.files.filter((f) => f.kind === "image")) {
    const name = hash(file.path) + extname(file.path).toLowerCase();
    media.set(file.path, `/media/${name}`);
    await writeFile(resolve(root, "public/media", name), await content(file));
  }
  const rendered = docs.map((file) => ({
    file,
    doc: renderDocument(file.source || "", {
      project: project.id,
      path: file.path,
      numbering: project.data.numbering,
      webFormat: webFormatSource(project.data.files),
      resource: (path, image, anchor) =>
        image
          ? media.get(path) || ""
          : docs.find((f) => f.path === path)
            ? `${base}${docs.find((f) => f.path === path)!.id}/${anchor}`
            : "",
    }),
  }));
  const links = new Map<string, string>();
  for (const { file, doc } of rendered)
    for (const page of doc.pages)
      for (const m of page.html.matchAll(/\bid="([^"]+)"/g))
        links.set(
          file.path + "#" + m[1],
          `${base}${file.id}/${hash(page.id)}.html#${m[1]}`,
        );
  const html = (value: string, path: string) =>
    value
      .replace(/href="#([^"]+)"/g, (all, id) =>
        links.has(path + "#" + id)
          ? `href="${escape(links.get(path + "#" + id)!)}"`
          : all,
      )
      .replace(
        /<h([1-6])\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)<\/h\1>/g,
        (_, level, attrs, id, title) =>
          `<h${level}${attrs} tabindex="-1">${title}<a class="header-anchor" href="#${id}" aria-label="Permalink to this heading">​</a></h${level}>`,
      );
  const writePage = async (
    path: string,
    title: string,
    value: string,
    originalPath: string,
  ) => {
    const destination = resolve(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      `---\ntitle: ${JSON.stringify(title)}\n---\n\n<div v-pre class="document-content">\n\n${html(value, originalPath)}\n\n</div>\n`,
    );
  };
  const sidebar: any[] = [];
  const target =
    rendered.find((d) => d.file.path === project.data.target) || rendered[0];
  const titleHtml = `<h1 id="document-title">${escape(project.name)}</h1>`;
  await writePage(
    "index.md",
    project.name,
    titleHtml + (target?.doc.introduction || ""),
    target?.file.path || "",
  );
  for (const { file, doc } of rendered) {
    await writePage(
      `${file.id}/index.md`,
      file.path,
      `<h1 id="document-title">${escape(file.path)}</h1>` +
        (doc.pages.length ? doc.introduction : doc.html),
      file.path,
    );
    const items = [];
    for (const page of doc.pages) {
      const path = `${file.id}/${hash(page.id)}`;
      await writePage(path + ".md", page.title, page.html, file.path);
      items.push({ text: page.title, link: "/" + path });
    }
    if (rendered.length === 1) sidebar.push(...items);
    else sidebar.push({ text: file.path, link: `/${file.id}/`, items });
  }
  await writeFile(
    resolve(root, "public/site-version.json"),
    JSON.stringify({ revision: project.revision }),
  );
  await writeFile(resolve(root, ".vitepress/theme/style.css"), siteCss);
  // No session, collaboration, editor or project-list dependency in the site.
  await writeFile(
    resolve(root, ".vitepress/theme/index.js"),
    `import DefaultTheme from 'vitepress/theme';
import './style.css';
import 'katex/dist/katex.min.css';
export default {extends:DefaultTheme,enhanceApp(){
  if(typeof window === 'undefined')return;
  let timer,active=true,checking=false,controller;
  const poll=async()=>{
    if(!active||document.hidden||checking)return;
    checking=true;
    const request=new AbortController();controller=request;
    const timeout=setTimeout(()=>request.abort(),5000);
    try{
      const r=await fetch(import.meta.env.BASE_URL+'site-version.json',{cache:'no-store',signal:request.signal});
      if(r.status===401||r.status===403){
        active=false;clearInterval(timer);document.documentElement.replaceChildren();location.reload();return;
      }
      if(r.ok){
        const next=await r.json();
        if(active&&Number(next.revision)>${project.revision}){
          active=false;clearInterval(timer);location.reload();
        }
      }
    }catch{}finally{clearTimeout(timeout);checking=false;controller=undefined}
  };
  const start=()=>{active=true;clearInterval(timer);timer=setInterval(poll,500);void poll()};
  document.addEventListener('visibilitychange',poll);
  window.addEventListener('focus',poll);
  window.addEventListener('pageshow',start);
  window.addEventListener('pagehide',()=>{active=false;clearInterval(timer);controller?.abort()});
  start();
}};
`,
  );
  const configuration = {
    vite: { build: { assetsInlineLimit: 0 } },
    title: project.name,
    description: "",
    base,
    lang: "ko-KR",
    cleanUrls: false,
    ignoreDeadLinks: true,
    themeConfig: {
      nav: [],
      sidebar,
      search: {
        provider: "local",
        options: {
          translations: {
            button: { buttonText: "검색", buttonAriaLabel: "문서 검색" },
            modal: {
              noResultsText: "검색 결과가 없습니다",
              resetButtonTitle: "검색어 지우기",
              footer: {
                selectText: "선택",
                navigateText: "이동",
                closeText: "닫기",
              },
            },
          },
        },
      },
      outline: { level: [1, 3], label: "이 페이지의 목차" },
      docFooter: { prev: "이전", next: "다음" },
      returnToTopLabel: "맨 위로",
      sidebarMenuLabel: "목차",
    },
  };
  await writeFile(
    resolve(root, ".vitepress/config.mjs"),
    `import {createHash} from 'node:crypto';\nimport {mkdir,writeFile} from 'node:fs/promises';\nimport {resolve} from 'node:path';\nexport default {...${JSON.stringify(configuration)},outDir:${JSON.stringify(dist)},async transformHtml(html){for(const m of [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/g)]){if(/\\bsrc=/.test(m[1])||!m[2].trim())continue;const n='inline-'+createHash('sha256').update(m[2]).digest('hex').slice(0,16)+'.js';await mkdir(resolve(${JSON.stringify(dist)},'assets'),{recursive:true});await writeFile(resolve(${JSON.stringify(dist)},'assets',n),m[2]);html=html.replace(m[0],'<script'+m[1]+' src="'+${JSON.stringify(base)}+'assets/'+n+'"></script>')}return html}};\n`,
  );
  // VitePress runs in a child so its build environment and caches cannot affect the editor server.
  try {
    await exec(
      process.execPath,
      [resolve("node_modules/vitepress/bin/vitepress.js"), "build", root],
      { cwd: resolve("."), timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error: any) {
    throw new Error(
      "Website build failed: " +
        (error.stderr || error.stdout || error.message).slice(-8000),
    );
  }
  await writeFile(resolve(root, "build.complete"), "ok");
  return dist;
}
let queue = Promise.resolve();
const pending = new Map<string, Promise<string>>();
const exporting = new Map<string, number>();
async function recentSites(id: string, generation: string) {
  const parent = resolve(config.data, generation, id);
  if (!existsSync(parent)) return [];
  return (await readdir(parent))
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(b) - Number(a));
}
async function pruneSites(id: string, current: number) {
  // Continuous editing now publishes during typing. Bound generated artifacts,
  // preserving recent assets and the snapshot currently served by the routes.
  for (const generation of siteGenerations) {
    const revisions = await recentSites(id, generation);
    for (const revision of revisions.slice(3)) {
      if (Number(revision) >= current) continue;
      const root = resolve(config.data, generation, id, revision);
      if (exporting.has(root)) continue;
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  }
}
async function publish(id: string) {
  if (pending.has(id)) return pending.get(id)!;
  const work = queue.then(async () => {
    const project = (
      await pool.query("SELECT * FROM projects WHERE id=$1", [id])
    ).rows[0];
    if (!project) throw new Fault("NOT_FOUND", 404);
    project.revision = Number(project.revision);
    const dist = await buildWebsite(project);
    await pool.query(
      "INSERT INTO websites(project_id,revision) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET revision=$2,updated=now()",
      [id, project.revision],
    );
    // Pruning failure must not roll back a successfully published document.
    await pruneSites(id, project.revision).catch(() => {});
    return dist;
  });
  pending.set(id, work);
  queue = work.then(
    () => {},
    () => {},
  );
  void work.finally(() => pending.delete(id)).catch(() => {});
  return work;
}
export async function websiteRoutes(app: FastifyInstance) {
  const idOf = (req: any) => z.string().uuid().parse(req.params.pid);
  app.get("/api/projects/:pid/website", async (req) => {
    const user = await identity(req),
      id = idOf(req);
    await access(pool, id, user.id);
    const site = (
      await pool.query(
        "SELECT revision,updated FROM websites WHERE project_id=$1",
        [id],
      )
    ).rows[0];
    return { published: !!site, ...site, url: websiteBase(id) };
  });
  app.post("/api/projects/:pid/website", async (req) => {
    const user = await mutation(req),
      id = idOf(req);
    await access(pool, id, user.id, "owner");
    await publish(id);
    return { url: websiteBase(id) };
  });
  app.get("/api/projects/:pid/website/export", async (req, reply) => {
    const user = await identity(req),
      project = await access(pool, idOf(req), user.id);
    const root = resolve(siteRoot(project.id, project.revision), "..");
    exporting.set(root, (exporting.get(root) || 0) + 1);
    try {
      let dist = "";
      const work = queue.then(async () => {
        dist = await buildWebsite(project, true);
      });
      queue = work.catch(() => {});
      await work;
      const files: Record<string, Uint8Array> = {};
      for (const entry of await readdir(dist, {
        recursive: true,
        withFileTypes: true,
      }))
        if (entry.isFile()) {
          const path = resolve(entry.parentPath, entry.name);
          files[relative(dist, path)] = await readFile(path);
        }
      return reply
        .type("application/zip")
        .header("Content-Disposition", 'attachment; filename="website.zip"')
        .send(Buffer.from(zipSync(files, { level: 6 })));
    } finally {
      const remaining = exporting.get(root)! - 1;
      if (remaining) exporting.set(root, remaining);
      else exporting.delete(root);
    }
  });
  app.get("/docs", async (_req, reply) =>
    reply.header("Cache-Control", "private, no-store").redirect("/docs/"),
  );
  app.get("/docs/*", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store").header("Vary", "Cookie");
    const url = new URL(req.url, "http://local");
    let path = decodeURIComponent(url.pathname.slice("/docs/".length)),
      id = config.docsProject;
    const match = /^p\/([\da-f-]{36})(?:\/(.*))?$/i.exec(path);
    if (match) {
      id = z.string().uuid().parse(match[1]);
      path = match[2] || "";
    }
    if (!id) throw new Fault("NOT_FOUND", 404);
    const pageRequest =
      !extname(path) || extname(path) === ".html" || path.endsWith("/");
    try {
      const user = await identity(req);
      await access(pool, id, user.id);
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      if (error.status === 401 && pageRequest)
        return reply.redirect("/?returnTo=" + encodeURIComponent(req.url));
      if (error.status === 404 || error.status === 403) {
        if (pageRequest)
          return reply
            .code(403)
            .type("text/html; charset=utf-8")
            .send(
              '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>문서 접근 권한</title><main><h1>이 문서에 접근할 권한이 없습니다</h1><p>프로젝트 소유자에게 초대를 요청해 주세요.</p><a href="/">내 프로젝트로 이동</a></main></html>',
            );
        throw new Fault("FORBIDDEN", 403);
      }
      throw error;
    }
    if (match && id === config.docsProject)
      return reply.redirect("/docs/" + path + url.search);
    const site = (
      await pool.query(
        "SELECT w.revision,p.revision AS current FROM websites w JOIN projects p ON p.id=w.project_id WHERE p.id=$1",
        [id],
      )
    ).rows[0];
    if (!site) throw new Fault("NOT_FOUND", 404);
    let root = resolve(siteRoot(id, Number(site.revision)), ".vitepress/dist");
    if (!existsSync(resolve(root, "index.html"))) root = await publish(id);
    else if (site.revision !== site.current) schedule(id);
    if (!path || path.endsWith("/")) path += "index.html";
    if (!extname(path)) path += ".html";
    let file = resolve(root, path);
    if (!file.startsWith(root + "/")) throw new Fault("NOT_FOUND", 404);
    // A tab can still request a hashed chunk from the preceding publication
    // before its next version poll. Keep that project's recent chunks usable.
    if (!existsSync(file) && path.startsWith("assets/")) {
      for (const generation of siteGenerations) {
        for (const revision of (await recentSites(id, generation)).slice(
          0,
          3,
        )) {
          const candidate = resolve(
            config.data,
            generation,
            id,
            revision,
            "hosted",
            ".vitepress/dist",
            path,
          );
          if (existsSync(candidate)) {
            file = candidate;
            break;
          }
        }
        if (existsSync(file)) break;
      }
    }
    if (!existsSync(file) || (await stat(file)).isDirectory())
      throw new Fault("NOT_FOUND", 404);
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
    };
    return reply
      .type(mime[extname(file)] || "application/octet-stream")
      .send(createReadStream(file));
  });
  const refresh = new WebsiteRefresh(
    async (id) => {
      const row = (
        await pool.query(
          "SELECT w.revision,p.revision AS current FROM websites w JOIN projects p ON p.id=w.project_id WHERE p.id=$1",
          [id],
        )
      ).rows[0];
      if (!row || row.revision === row.current) return false;
      await publish(id);
      const latest = (
        await pool.query(
          "SELECT w.revision,p.revision AS current FROM websites w JOIN projects p ON p.id=w.project_id WHERE p.id=$1",
          [id],
        )
      ).rows[0];
      return !!latest && latest.revision !== latest.current;
    },
    (error) => app.log.error(error, "Website refresh failed"),
  );
  const schedule = (id: string) => refresh.schedule(id);
  const stop = observeEvents((id, event: any) => {
    if (["changed", "document", "restored"].includes(event?.type)) schedule(id);
  });
  app.addHook("onClose", async () => {
    stop();
    await refresh.close();
    await queue;
  });
}

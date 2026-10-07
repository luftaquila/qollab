<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  defineAsyncComponent,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { api, setCsrf, base64, downloadText, uploadAsset } from "./api";
import { t, lang, errorText } from "./i18n";
const Editor = defineAsyncComponent(() => import("./Editor.vue"));
const Pdf = defineAsyncComponent(() => import("./Pdf.vue"));
const user = ref<any>(),
  configured = ref(false),
  boot = ref(true),
  projects = ref<any[]>([]),
  project = ref<any>(),
  selected = ref<string>(),
  tab = ref("files"),
  error = ref(""),
  history = ref<any[]>([]),
  members = ref<any[]>([]),
  builds = ref<any[]>([]),
  comparison = ref<any>(),
  showSource = ref(false),
  showPdf = ref(true),
  sourceDraft = ref(""),
  sourceVisible = ref(""),
  editor = shallowRef<any>(),
  sessionKey = ref(0),
  busy = ref(false),
  inviteLink = ref("");
let stream: EventSource | undefined;
const file = computed(() =>
  project.value?.data.files.find((f: any) => f.id === selected.value),
);
const editable = computed(() => project.value?.role !== "viewer");
const owner = computed(() => project.value?.role === "owner");
const latestBuild = computed(() => builds.value[0]);
const images = computed(
  () => project.value?.data.files.filter((f: any) => f.kind === "image") || [],
);
const headings = computed(() =>
  [...(file.value?.source || "").matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
    (m: any) => ({ level: m[1].length, text: m[2] }),
  ),
);
const refs = computed(() => [
  ...new Set(
    (file.value?.source || "").match(/(?:@[a-zA-Z][\w:-]*|#fig-[\w-]+)/g) || [],
  ),
]);
async function perform(fn: () => Promise<any>) {
  error.value = "";
  busy.value = true;
  try {
    return await fn();
  } catch (e: any) {
    error.value = errorText(e.code || e.message || "NETWORK");
  } finally {
    busy.value = false;
  }
}
async function loadProjects() {
  projects.value = await api("/projects");
}
async function refresh() {
  if (!project.value) return;
  const p = await api("/projects/" + project.value.id);
  project.value = p;
  builds.value = await api(`/projects/${p.id}/builds`);
  if (tab.value === "history")
    history.value = await api(`/projects/${p.id}/history`);
  if (tab.value === "members")
    members.value = await api(`/projects/${p.id}/members`);
}
async function openProject(id: string) {
  if (editor.value?.pending())
    downloadText(file.value.path, editor.value.source());
  stream?.close();
  project.value = await api("/projects/" + id);
  selected.value = project.value.data.files.find(
    (f: any) => f.kind === "document",
  )?.id;
  sourceDraft.value =
    project.value.data.files.find((f: any) => f.id === selected.value)
      ?.source || "";
  tab.value = "files";
  sessionKey.value++;
  showSource.value = false;
  await refresh();
  stream = new EventSource(`/api/projects/${id}/events`);
  let timer: ReturnType<typeof setTimeout>;
  stream.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "heartbeat") return;
    if (event.type === "document") {
      revision(event.revision);
      project.value.data.contentRevision = event.revision;
      return;
    }
    if (
      event.type === "build" &&
      project.value?.id === id &&
      event.epoch === project.value.data.epoch &&
      event.pdfBuild &&
      event.pdfRevision >= (project.value.data.pdfRevision ?? -1)
    ) {
      project.value.data.pdfBuild = event.pdfBuild;
      project.value.data.pdfRevision = event.pdfRevision;
    }
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        void refresh().catch((e: any) => {
          error.value = errorText(e.code || "NETWORK");
        }),
      200,
    );
  };
}
async function newProject() {
  const name = prompt(t("name"));
  if (!name) return;
  const p = await api("/projects", "POST", { name });
  await loadProjects();
  await openProject(p.id);
}
async function selectFile(f: any) {
  if (editor.value?.pending()) {
    downloadText(file.value.path, editor.value.source());
  }
  selected.value = f.id;
  sessionKey.value++;
  showSource.value = false;
  sourceDraft.value = f.source || "";
}
async function addFile() {
  const path = prompt(t("newFile"), "chapter.qmd");
  if (!path) return;
  await api(`/projects/${project.value.id}/files`, "POST", {
    revision: Number(project.value.revision),
    path,
    source: "",
  });
  await refresh();
}
async function renameFile() {
  const path = prompt(t("name"), file.value.path);
  if (!path) return;
  await api(`/projects/${project.value.id}/files/${file.value.id}`, "PATCH", {
    revision: Number(project.value.revision),
    path,
  });
  await refresh();
}
async function deleteFile() {
  if (!confirm(t("deleteConfirm"))) return;
  await api(`/projects/${project.value.id}/files/${file.value.id}`, "DELETE", {
    revision: Number(project.value.revision),
  });
  selected.value = undefined;
  await refresh();
}
async function switchTab(value: string) {
  tab.value = value;
  await refresh();
}
async function makeCheckpoint() {
  const label = prompt(t("name"), new Date().toLocaleString());
  if (!label) return;
  await api(`/projects/${project.value.id}/history`, "POST", {
    revision: Number(project.value.revision),
    label,
  });
  await refresh();
}
async function compare(id: string) {
  const version = await api(`/projects/${project.value.id}/history/${id}`);
  const { diffLines } = await import("diff");
  const paths = new Set<string>(
    [...version.snapshot.files, ...project.value.data.files]
      .filter((f: any) => f.source !== undefined)
      .map((f: any) => f.path),
  );
  version.diffs = [...paths].map((path) => ({
    path,
    changes: diffLines(
      version.snapshot.files.find((f: any) => f.path === path)?.source || "",
      project.value.data.files.find((f: any) => f.path === path)?.source || "",
    ),
  }));
  comparison.value = version;
}
async function restore(id: string) {
  if (!confirm(t("restoreConfirm"))) return;
  if (editor.value?.pending())
    downloadText(file.value.path, editor.value.source());
  await api(`/projects/${project.value.id}/history/${id}/restore`, "POST", {
    revision: Number(project.value.revision),
  });
  comparison.value = null;
  await openProject(project.value.id);
}
async function startRaw() {
  if (editor.value?.pending()) throw new Error("SAVING");
  await api(
    `/projects/${project.value.id}/files/${file.value.id}/raw`,
    "POST",
    { revision: Number(project.value.revision) },
  );
  await refresh();
  sourceDraft.value = file.value.source;
  sessionKey.value++;
}
async function saveRaw(visual = false) {
  const f = file.value;
  await api(`/projects/${project.value.id}/files/${f.id}/raw`, "PUT", {
    revision: Number(project.value.revision),
    epoch: f.epoch,
    rawVersion: f.rawVersion,
    source: sourceDraft.value,
    visual,
  });
  await refresh();
  if (visual) sessionKey.value++;
}
async function saveText() {
  await api(
    `/projects/${project.value.id}/files/${file.value.id}/text`,
    "PUT",
    { revision: Number(project.value.revision), source: sourceDraft.value },
  );
  await refresh();
}
async function importZip(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files?.[0]) return;
  const f = input.files[0];
  await perform(async () => {
    const p = await api("/import", "POST", {
      name: f.name.replace(/\.zip$/i, ""),
      bytes: await base64(f),
    });
    await loadProjects();
    await openProject(p.id);
  });
  input.value = "";
}
const imageForm = ref<any>();
async function uploadImages(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const f of input.files || []) {
    await perform(async () => {
      const r = await uploadAsset(project.value.id, {
        revision: Number(project.value.revision),
        uploadId: crypto.randomUUID(),
        name: f.name,
        bytes: await base64(f),
        documentId: file.value?.kind === "document" ? file.value.id : undefined,
      });
      await refresh();
      if (file.value?.mode === "visual")
        imageForm.value = {
          caption: "",
          alt: "",
          width: "80%",
          align: "center",
          identifier: "",
          ...imageForm.value,
          src: r.result.relative,
        };
    });
  }
  input.value = "";
}
function reuseImage(f: any) {
  if (file.value?.kind !== "document" || file.value.mode !== "visual") return;
  const docParts = file.value.path.split("/");
  docParts.pop();
  const parts = f.path.split("/");
  while (docParts.length && docParts[0] === parts[0]) {
    docParts.shift();
    parts.shift();
  }
  imageForm.value = {
    src: "../".repeat(docParts.length) + parts.join("/"),
    caption: "",
    alt: "",
    width: "80%",
    align: "center",
    identifier: "",
  };
}
async function invite() {
  const email = prompt(t("email"));
  if (!email) return;
  const r = await api(`/projects/${project.value.id}/invites`, "POST", {
    revision: Number(project.value.revision),
    email,
    role: "editor",
  });
  inviteLink.value = r.result.url;
  await refresh();
}
async function changeRole(m: any, role: string | null, transfer = false) {
  await api(
    `/projects/${project.value.id}/members/${encodeURIComponent(m.id)}`,
    "PATCH",
    { revision: Number(project.value.revision), role, transfer },
  );
  await refresh();
}
async function reopen() {
  if (editor.value?.pending())
    downloadText(file.value.path, editor.value.source());
  await refresh();
  sessionKey.value++;
}
function leaveProject() {
  if (editor.value?.pending())
    downloadText(file.value.path, editor.value.source());
  stream?.close();
  project.value = null;
  void perform(loadProjects);
}
function revision(value: number) {
  if (project.value)
    project.value.revision = Math.max(Number(project.value.revision), value);
}
onMounted(
  () =>
    void perform(async () => {
      const s = await api("/session");
      user.value = s.user;
      configured.value = s.oauthConfigured;
      setCsrf(s.csrf || "");
      if (s.user) {
        await loadProjects();
        const invite = new URLSearchParams(location.search).get("invite");
        if (invite) {
          const p = await api("/invites/accept", "POST", { token: invite });
          window.history.replaceState({}, "", location.pathname);
          await openProject(p.id);
        }
      }
      boot.value = false;
      document.documentElement.lang = lang;
    }),
);
onBeforeUnmount(() => stream?.close());
</script>
<template>
  <div v-if="boot" class="boot">
    <span class="brand-mark">Q</span>{{ t("loading") }}
  </div>
  <div v-else-if="!user" class="login-page">
    <header class="landing-header">
      <a class="brand"><span class="brand-mark">Q</span>qollab</a
      ><span>Quarto · Collaboration</span>
    </header>
    <main class="login-content">
      <div class="eyebrow">
        {{ lang === "ko" ? "아이디어를 문서로" : "A PLACE FOR YOUR IDEAS" }}
      </div>
      <h1>{{ t("tagline") }}</h1>
      <p>{{ t("intro") }}</p>
      <a v-if="configured" href="/api/auth/google" class="button primary google"
        ><span>G</span>{{ t("google") }}</a
      >
      <div v-else class="notice oauth-notice">{{ t("unconfigured") }}</div>
      <div class="login-foot">
        Markdown <span>→</span> Quarto <span>→</span> PDF
      </div>
    </main>
    <div class="document-art" aria-hidden="true">
      <div class="art-label">report.qmd <span>●</span></div>
      <div class="art-paper">
        <small>WORKING TOGETHER</small>
        <h2>Ideas take shape.</h2>
        <div class="art-line" />
        <div class="art-line short" />
        <div class="art-formula">E = mc²</div>
        <div class="art-line" />
        <div class="art-line" />
        <div class="art-line short" />
        <div class="art-caption">01 / A shared beginning</div>
      </div>
    </div>
    <footer class="landing-footer">Qollab · Open source · MIT</footer>
  </div>
  <div v-else-if="!project" class="project-page">
    <header class="main-header">
      <a class="brand"><span class="brand-mark">Q</span>qollab</a
      ><span class="spacer" /><span>{{ user.name }}</span
      ><button
        @click="
          perform(async () => {
            await api('/logout', 'POST');
            user = null;
          })
        "
      >
        {{ t("logout") }}
      </button>
    </header>
    <main class="project-content">
      <div class="eyebrow">
        {{ lang === "ko" ? "나의 작업 공간" : "YOUR WORKSPACE" }}
      </div>
      <div class="project-heading">
        <h1>{{ t("projects") }}</h1>
        <span class="spacer" /><label class="button"
          >↑ {{ t("import")
          }}<input
            hidden
            type="file"
            accept=".zip"
            @change="importZip" /></label
        ><button class="primary" @click="perform(newProject)">
          ＋ {{ t("newProject") }}
        </button>
      </div>
      <p class="muted">{{ t("welcomeTitle") }}</p>
      <div v-if="!projects.length" class="empty-project">{{ t("empty") }}</div>
      <div class="project-grid">
        <button
          v-for="p in projects"
          :key="p.id"
          class="project-card"
          @click="perform(() => openProject(p.id))"
        >
          <span class="file-glyph">QMD</span>
          <h2>{{ p.name }}</h2>
          <span class="muted"
            >{{ t(p.role) }} · {{ t("revision") }} {{ p.revision }}</span
          ><span class="card-arrow">↗</span>
        </button>
      </div>
    </main>
  </div>
  <div v-else class="workspace">
    <header class="workspace-header">
      <button class="brand" @click="leaveProject()">
        <span class="brand-mark">Q</span></button
      ><button class="back-link" @click="leaveProject()">{{ t("back") }}</button
      ><span class="header-divider">/</span><strong>{{ project.name }}</strong
      ><span class="role-pill">{{ t(project.role) }}</span
      ><span class="spacer" /><button @click="showPdf = !showPdf">
        ◫ {{ t("pdf") }}</button
      ><a class="button" :href="`/api/projects/${project.id}/export`"
        >↓ {{ t("export") }}</a
      ><span class="avatar" :title="user.name">{{
        user.name.slice(0, 1)
      }}</span>
    </header>
    <div class="workspace-body">
      <aside class="sidebar">
        <nav class="sidebar-tabs">
          <button
            v-for="item in ['files', 'images', 'history', 'members']"
            :class="{ active: tab === item }"
            @click="perform(() => switchTab(item))"
          >
            {{ t(item as any) }}
          </button>
        </nav>
        <div v-if="tab === 'files'" class="sidebar-content">
          <div class="sidebar-title">
            {{ t("files")
            }}<button v-if="editable" @click="perform(addFile)">＋</button>
          </div>
          <button
            v-for="f in project.data.files"
            :key="f.id"
            :class="['file-row', { active: selected === f.id }]"
            @click="perform(() => selectFile(f))"
          >
            <span class="file-type">{{ f.kind === "image" ? "▧" : "≡" }}</span
            ><span>{{ f.path }}</span
            ><span v-if="f.path === project.data.target" class="target-dot"
              >●</span
            >
          </button>
          <div v-if="file" class="file-actions">
            <button v-if="editable" @click="perform(renameFile)">
              {{ t("rename") }}</button
            ><button v-if="editable" @click="perform(deleteFile)">
              {{ t("delete") }}</button
            ><button
              v-if="owner && file.kind === 'document'"
              @click="
                perform(async () => {
                  await api(`/projects/${project.id}`, 'PATCH', {
                    revision: Number(project.revision),
                    target: file.path,
                  });
                  await refresh();
                })
              "
            >
              {{ t("target") }}
            </button>
          </div>
          <section v-if="headings.length" class="outline">
            <h3>{{ t("outline") }}</h3>
            <div
              v-for="heading in headings"
              :style="{ paddingLeft: (heading.level - 1) * 10 + 'px' }"
            >
              {{ heading.text }}
            </div>
          </section>
          <section v-if="refs.length" class="outline">
            <h3>{{ t("refs") }}</h3>
            <div v-for="ref in refs">{{ ref }}</div>
          </section>
        </div>
        <div v-if="tab === 'images'" class="sidebar-content">
          <label v-if="editable" class="button full"
            >＋ {{ t("upload")
            }}<input
              hidden
              multiple
              type="file"
              accept="image/png,image/jpeg"
              @change="uploadImages"
          /></label>
          <div v-for="im in images" class="asset-card">
            <img
              :src="`/api/projects/${project.id}/resource?path=${encodeURIComponent(im.path)}`"
              :alt="im.name || im.path"
            /><span>{{ im.name || im.path }}</span
            ><button v-if="editable" @click="reuseImage(im)">
              {{ t("insert") }}
            </button>
          </div>
        </div>
        <div v-if="tab === 'history'" class="sidebar-content">
          <button v-if="editable" class="full" @click="perform(makeCheckpoint)">
            ＋ {{ t("checkpoint") }}</button
          ><button
            v-for="h in history"
            class="history-row"
            @click="perform(() => compare(h.id))"
          >
            <strong>{{ h.label }}</strong
            ><small>{{ new Date(h.created).toLocaleString() }}</small
            ><span>r{{ h.revision }} · {{ h.git_hash?.slice(0, 7) }}</span>
          </button>
        </div>
        <div v-if="tab === 'members'" class="sidebar-content">
          <button v-if="owner" class="full" @click="perform(invite)">
            {{ t("invite") }}</button
          ><input
            v-if="inviteLink"
            :value="inviteLink"
            readonly
            @click="($event.target as HTMLInputElement).select()"
          />
          <div v-for="m in members" class="member">
            <strong>{{ m.name }}</strong
            ><small>{{ m.email }}</small
            ><select
              v-if="owner"
              :value="m.role"
              @change="
                perform(() =>
                  changeRole(m, ($event.target as HTMLSelectElement).value),
                )
              "
            >
              <option
                v-for="role in ['owner', 'editor', 'viewer']"
                :value="role"
              >
                {{ t(role as any) }}
              </option></select
            ><span v-else>{{ t(m.role) }}</span>
            <div v-if="owner && m.id !== user.id">
              <button @click="perform(() => changeRole(m, null))">
                {{ t("remove") }}</button
              ><button @click="perform(() => changeRole(m, 'owner', true))">
                {{ t("transfer") }}
              </button>
            </div>
          </div>
        </div>
        <div class="sidebar-bottom">
          <span class="status-dot saved" />{{ t("revision") }}
          {{ project.revision }}<span class="spacer" /><button
            @click="perform(refresh)"
            :title="t('refresh')"
          >
            ↻
          </button>
        </div>
      </aside>
      <main class="document-column">
        <div v-if="file" class="document-tabs">
          <strong>{{ file.path }}</strong
          ><span class="spacer" /><button
            v-if="file.kind === 'document'"
            :class="{ active: showSource }"
            @click="
              sourceVisible = editor?.source() || file.source;
              showSource = !showSource;
            "
          >
            {{ t("source") }}</button
          ><button
            v-if="editable && file.mode === 'visual'"
            @click="perform(startRaw)"
          >
            {{ t("raw") }}</button
          ><button @click="perform(reopen)">{{ t("reopen") }}</button>
        </div>
        <div v-if="!file" class="center-empty">{{ t("open") }}</div>
        <div v-else-if="file.kind === 'image'" class="image-preview">
          <img
            :src="`/api/projects/${project.id}/resource?path=${encodeURIComponent(file.path)}`"
            :alt="file.name"
          />
        </div>
        <div v-if="file && showSource" class="source-view">
          <button @click="downloadText(file.path, sourceVisible)">
            ↓ {{ t("download") }}
          </button>
          <pre>{{ sourceVisible }}</pre>
        </div>
        <div
          v-if="
            file && (file.mode === 'raw' || file.kind === 'text') && !showSource
          "
          class="raw-recovery"
        >
          <p>{{ t("rawHelp") }}</p>
          <textarea
            v-model="sourceDraft"
            :readonly="!editable"
            spellcheck="false"
          />
          <div v-if="editable" class="raw-buttons">
            <button v-if="file.mode === 'raw'" @click="perform(startRaw)">
              {{ t("raw") }}</button
            ><button
              class="primary"
              @click="
                perform(() =>
                  file.mode === 'raw' ? saveRaw(false) : saveText(),
                )
              "
            >
              {{ t("save") }}</button
            ><button
              v-if="file.mode === 'raw'"
              @click="perform(() => saveRaw(true))"
            >
              {{ t("visual") }}
            </button>
          </div>
        </div>
        <Editor
          v-if="file?.mode === 'visual'"
          v-show="!showSource"
          ref="editor"
          :key="`${file.id}:${sessionKey}`"
          :project="project"
          :file="file"
          :user="user"
          @revision="revision"
          @image="imageForm = $event"
          @changed="refresh().catch((e) => (error = errorText(e.code)))"
          @error="error = errorText($event)"
        />
      </main>
      <aside v-if="showPdf" class="preview-column">
        <div class="build-status">
          <span :class="['status-dot', latestBuild?.status]" /><span>{{
            latestBuild ? t(latestBuild.status) : t("pdf")
          }}</span
          ><small v-if="project.data.pdfRevision !== undefined"
            >r{{ project.data.pdfRevision }}
            <span
              v-if="
                project.data.pdfRevision < (project.data.contentRevision || 0)
              "
              >· {{ t("pending") }}</span
            ></small
          ><span class="spacer" /><button
            v-if="editable"
            @click="
              perform(async () => {
                await api(`/projects/${project.id}/builds`, 'POST', {
                  revision: Number(project.revision),
                });
                await refresh();
              })
            "
            :title="t('build')"
          >
            ↻
          </button>
        </div>
        <details v-if="latestBuild?.status === 'failed'" class="build-error">
          <summary>{{ t("failed") }}</summary>
          <pre>{{ latestBuild.log }}</pre>
        </details>
        <Pdf
          :project="project.id"
          :build="project.data.pdfBuild"
          :status="latestBuild?.status"
        />
      </aside>
    </div>
  </div>
  <div v-if="error" role="alert" class="toast">
    {{ error }}<button @click="error = ''">×</button>
  </div>
  <div v-if="imageForm" class="modal-backdrop">
    <form
      class="modal"
      @submit.prevent="
        editor?.insertImage(imageForm);
        imageForm = null;
      "
    >
      <h2>{{ t("images") }}</h2>
      <label class="button"
        >{{ t("replaceImage")
        }}<input
          hidden
          type="file"
          accept="image/png,image/jpeg"
          @change="uploadImages" /></label
      ><label v-for="field in ['caption', 'alt', 'width', 'identifier']"
        >{{ t(field as any) }}<input v-model="imageForm[field]" /></label
      ><label
        >{{ t("align")
        }}<select v-model="imageForm.align">
          <option>left</option>
          <option>center</option>
          <option>right</option>
        </select></label
      >
      <div class="modal-actions">
        <button type="button" @click="imageForm = null">
          {{ t("cancel") }}</button
        ><button class="primary">{{ t("insert") }}</button>
      </div>
    </form>
  </div>
  <div v-if="comparison" class="modal-backdrop">
    <div class="modal diff-modal">
      <header>
        <h2>{{ comparison.label }}</h2>
        <span class="spacer" /><button @click="comparison = null">×</button>
      </header>
      <p>{{ t("sourceDiff") }}</p>
      <div v-for="f in comparison.diffs" class="diff-file">
        <h3>{{ f.path }}</h3>
        <pre
          class="unified-diff"
        ><span v-for="part in f.changes" :class="{added:part.added,removed:part.removed}">{{part.value.split('\n').filter((line: string,i: number,a: string[]) => i!==a.length-1||line).map((line: string)=>(part.added?'+ ':part.removed?'- ':'  ')+line).join('\n')}}{{'\n'}}</span></pre>
      </div>
      <div class="modal-actions">
        <a
          class="button"
          :href="`/api/projects/${project.id}/history/${comparison.id}/export`"
          >{{ t("export") }}</a
        ><button
          v-if="owner"
          class="primary"
          @click="perform(() => restore(comparison.id))"
        >
          {{ t("restore") }}
        </button>
      </div>
    </div>
  </div>
</template>

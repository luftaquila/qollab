<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  watch,
  defineAsyncComponent,
  provide,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { api, base64, downloadText, uploadAsset } from "../api";
import { t, fmt, errorText } from "../i18n";
import { fail, notify, askText, askConfirm } from "../ui/feedback";
import { preference } from "../theme";
import Icon from "../ui/Icon.vue";
import type { Heading } from "../editor-commands";
import type { LabelIndex } from "../editor-labels";
import { workspaceKey } from "../workspace/context";
import WorkspaceHeader from "../workspace/WorkspaceHeader.vue";
import ActivityRail, { type PanelName } from "../workspace/ActivityRail.vue";
import FilesPanel from "../workspace/FilesPanel.vue";
import OutlinePanel from "../workspace/OutlinePanel.vue";
import HistoryPanel from "../workspace/HistoryPanel.vue";
import MembersPanel from "../workspace/MembersPanel.vue";
import SettingsPanel from "../workspace/SettingsPanel.vue";
import DocumentBar from "../workspace/DocumentBar.vue";
import ImageDialog from "../workspace/ImageDialog.vue";
import DiffDialog from "../workspace/DiffDialog.vue";
import SplitHandle from "../workspace/SplitHandle.vue";
import type { SyncAnchor } from "../pdf-sync";
const Editor = defineAsyncComponent(() => import("../Editor.vue"));
const Pdf = defineAsyncComponent(() => import("../Pdf.vue"));
const SourceEditor = defineAsyncComponent(() => import("../SourceEditor.vue"));
const HelpDialog = defineAsyncComponent(() => import("../HelpDialog.vue"));
const props = defineProps<{
  projectId: string;
  fileId?: string;
  user: any;
  anonymous?: boolean;
}>();
const emit = defineEmits<{
  leave: [];
  logout: [];
  file: [id: string | undefined];
}>();

const wide = matchMedia("(min-width: 1101px)"),
  roomy = matchMedia("(min-width: 801px)");
const docked = ref(wide.matches),
  splitView = ref(roomy.matches);
const savedPanel = preference<PanelName | null>("panel", "files");
// The image panel was folded into the toolbar's image dialog.
if (savedPanel.value.value === ("images" as PanelName)) savedPanel.save("files");
const panel = ref<PanelName | null>(docked.value ? savedPanel.value.value : null);
const pdfPreference = preference("pdf", true);
// Narrow screens open the PDF over the editor only on request.
const showPdf = ref(splitView.value && pdfPreference.value.value);
const pdfWidth = preference(
  "pdfWidth",
  Math.max(360, Math.round(innerWidth * 0.36)),
);

const project = ref<any>(),
  selected = ref<string>(),
  history = ref<any[]>([]),
  members = ref<any[]>([]),
  builds = ref<any[]>([]),
  comparison = ref<any>(),
  showSource = ref(false),
  sourceDraft = ref(""),
  sourceVisible = ref(""),
  editor = shallowRef<any>(),
  sessionKey = ref(0),
  imageForm = ref<any>(),
  editorStatus = ref("loading"),
  peers = ref<{ name: string; picture: string | null }[]>([]),
  liveOutline = ref<Heading[]>([]),
  frontMatter = ref<string | null>(null),
  labels = ref<LabelIndex | null>(null);
let stream: EventSource | undefined,
  alive = true;
const file = computed(() =>
  project.value?.data.files.find((f: any) => f.id === selected.value),
);
const editable = computed(() => project.value?.role !== "viewer");
const owner = computed(() => project.value?.role === "owner");
const latestBuild = computed(() => builds.value[0]);
const visual = computed(
  () => file.value?.kind === "document" && file.value.mode === "visual",
);
const outline = computed<Heading[]>(() =>
  visual.value
    ? liveOutline.value
    : [...(file.value?.source || "").matchAll(/^(#{1,6})\s+(.+)$/gm)].map(
        (m: any) => ({ level: m[1].length, text: m[2] }),
      ),
);

const resource = (path: string) =>
  `/api/projects/${project.value.id}/resource?path=${encodeURIComponent(path)}`;

function savePending() {
  if (editor.value?.pending())
    downloadText(file.value.path, editor.value.source());
}
async function refresh() {
  if (!project.value) return;
  const p = await api("/projects/" + project.value.id);
  if (p.id !== project.value?.id) return;
  if (p.data.epoch < project.value.data.epoch) return;
  if (p.data.epoch === project.value.data.epoch) {
    // Events may arrive while this request is in flight. Keep the latest known
    // content revision, and retain the displayed PDF until that content is built.
    p.revision = Math.max(Number(p.revision), Number(project.value.revision));
    p.data.contentRevision = Math.max(
      p.data.contentRevision ?? 0,
      project.value.data.contentRevision ?? 0,
    );
    if (
      editor.value?.pending() ||
      (p.data.pdfRevision ?? -1) < p.data.contentRevision ||
      (p.data.pdfRevision ?? -1) < (project.value.data.pdfRevision ?? -1)
    ) {
      p.data.pdfBuild = project.value.data.pdfBuild;
      p.data.pdfRevision = project.value.data.pdfRevision;
    }
  }
  project.value = p;
  builds.value = await api(`/projects/${p.id}/builds`);
  if (panel.value === "history")
    history.value = await api(`/projects/${p.id}/history`);
  if (panel.value === "members")
    members.value = await api(`/projects/${p.id}/members`);
}
function refreshLater() {
  void refresh().catch(fail);
}
async function openProject(id: string) {
  savePending();
  stream?.close();
  const opened = await api("/projects/" + id);
  if (!alive) return;
  project.value = opened;
  const files = project.value.data.files;
  selected.value = (
    files.find((f: any) => f.id === props.fileId) ||
    files.find((f: any) => f.path === project.value.data.target) ||
    files.find((f: any) => f.kind === "document")
  )?.id;
  sourceDraft.value =
    files.find((f: any) => f.id === selected.value)?.source || "";
  sessionKey.value++;
  showSource.value = false;
  await refresh();
  // The workspace may have closed while the project loaded.
  if (!alive) return;
  stream = new EventSource(`/api/projects/${id}/events`);
  let timer: ReturnType<typeof setTimeout>;
  stream.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (project.value?.id !== id) return;
    if (event.type === "heartbeat") return;
    if (event.type === "document") {
      revision(event.revision);
      project.value.data.contentRevision = Math.max(
        project.value.data.contentRevision ?? 0,
        event.revision,
      );
      return;
    }
    if (
      event.type === "build" &&
      project.value?.id === id &&
      event.epoch === project.value.data.epoch &&
      event.pdfBuild &&
      !editor.value?.pending() &&
      event.pdfRevision >= (project.value.data.contentRevision ?? 0) &&
      event.pdfRevision >= (project.value.data.pdfRevision ?? -1)
    ) {
      project.value.data.pdfBuild = event.pdfBuild;
      project.value.data.pdfRevision = event.pdfRevision;
    }
    clearTimeout(timer);
    timer = setTimeout(refreshLater, 200);
  };
}
function revision(value: number) {
  if (project.value)
    project.value.revision = Math.max(Number(project.value.revision), value);
}
const rev = () => Number(project.value.revision);
async function guarded(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    fail(e);
  }
}

async function selectFile(f: any) {
  if (!docked.value) panel.value = null;
  if (f.id === selected.value) return;
  savePending();
  await releaseSource();
  selected.value = f.id;
  sessionKey.value++;
  showSource.value = false;
  editorStatus.value = "loading";
  peers.value = [];
  liveOutline.value = [];
  frontMatter.value = null;
  labels.value = null;
  sourceDraft.value = f.source || "";
  sourceStatus.value = "saved";
}
async function addFile(folder = "") {
  const path = await askText({
    title: t("newFile"),
    label: t("filePath"),
    value: folder + "chapter.qmd",
    hint: t("filePathHint"),
    confirm: t("create"),
  });
  if (!path) return;
  await guarded(async () => {
    const r = await api(`/projects/${project.value.id}/files`, "POST", {
      revision: rev(),
      path,
      source: "",
    });
    await refresh();
    const created = project.value.data.files.find(
      (f: any) => f.id === r.result?.id,
    );
    if (created) await selectFile(created);
  });
}
async function renameFile(f: any) {
  const path = await askText({
    title: t("renameFile"),
    label: t("filePath"),
    value: f.path,
    hint: t("filePathHint"),
    confirm: t("save"),
  });
  if (!path || path === f.path) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}/files/${f.id}`, "PATCH", {
      revision: rev(),
      path,
    });
    await refresh();
  });
}
async function deleteFile(f: any) {
  const ok = await askConfirm({
    title: t("deleteFile"),
    message: fmt("deleteFileConfirm", { name: f.path }),
    confirm: t("delete"),
    danger: true,
  });
  if (!ok) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}/files/${f.id}`, "DELETE", {
      revision: rev(),
    });
    if (selected.value === f.id) selected.value = undefined;
    await refresh();
  });
}
async function moveFile(f: any, folder: string) {
  const path = (folder ? folder + "/" : "") + f.path.split("/").pop();
  if (path === f.path) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}/files/${f.id}`, "PATCH", {
      revision: rev(),
      path,
    });
    await refresh();
  });
}
async function addFolder(parent = "") {
  const path = await askText({
    title: t("newFolder"),
    label: t("folderPath"),
    value: parent ? parent + "/" : "",
    hint: t("folderHint"),
    confirm: t("create"),
  });
  if (!path) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}/folders`, "POST", {
      revision: rev(),
      path: path.replace(/\/+$/, ""),
    });
    await refresh();
  });
}
async function renameFolder(from: string) {
  const to = await askText({
    title: t("renameFolder"),
    label: t("folderPath"),
    value: from,
    hint: t("folderHint"),
    confirm: t("save"),
  });
  if (!to || to === from) return;
  await guarded(async () => {
    savePending();
    await api(`/projects/${project.value.id}/folders`, "PATCH", {
      revision: rev(),
      from,
      to: to.replace(/\/+$/, ""),
    });
    await refresh();
  });
}
async function deleteFolder(path: string) {
  const count = project.value.data.files.filter((f: any) =>
    f.path.startsWith(path + "/"),
  ).length;
  const ok = await askConfirm({
    title: t("deleteFolder"),
    message: fmt("deleteFolderConfirm", { name: path, n: count }),
    confirm: t("delete"),
    danger: true,
  });
  if (!ok) return;
  await guarded(async () => {
    if (file.value?.path.startsWith(path + "/")) savePending();
    await api(`/projects/${project.value.id}/folders`, "DELETE", {
      revision: rev(),
      path,
    });
    await refresh();
    if (!project.value.data.files.some((f: any) => f.id === selected.value))
      selected.value = undefined;
  });
}
async function setTarget(f: any) {
  await guarded(async () => {
    await api(`/projects/${project.value.id}`, "PATCH", {
      revision: rev(),
      target: f.path,
    });
    await refresh();
  });
}
async function renameProject() {
  const name = await askText({
    title: t("renameProject"),
    label: t("projectName"),
    value: project.value.name,
    confirm: t("save"),
  });
  if (!name || name === project.value.name) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}`, "PATCH", {
      revision: rev(),
      name,
    });
    await refresh();
  });
}
async function makeCheckpoint() {
  const label = await askText({
    title: t("checkpoint"),
    label: t("checkpointName"),
    value: new Date().toLocaleString(),
    hint: t("checkpointHint"),
    confirm: t("save"),
  });
  if (!label) return;
  await guarded(async () => {
    await api(`/projects/${project.value.id}/history`, "POST", {
      revision: rev(),
      label,
    });
    await refresh();
  });
}
async function compare(id: string) {
  await guarded(async () => {
    const version = await api(`/projects/${project.value.id}/history/${id}`);
    version.created = history.value.find((h) => h.id === id)?.created;
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
        project.value.data.files.find((f: any) => f.path === path)?.source ||
          "",
      ),
    }));
    comparison.value = version;
  });
}
async function restore(id: string) {
  const ok = await askConfirm({
    title: t("restore"),
    message: t("restoreConfirm"),
    confirm: t("restore"),
    danger: true,
  });
  if (!ok) return;
  await guarded(async () => {
    savePending();
    await api(`/projects/${project.value.id}/history/${id}/restore`, "POST", {
      revision: rev(),
    });
    comparison.value = null;
    await openProject(project.value.id);
  });
}
// --- Markdown source editing ---------------------------------------------
// Visual documents are edited together through Yjs. Editing the Markdown
// directly takes the document's exclusive lock (raw mode) on the server:
// others read along until the editor returns to visual editing.
const sourceStatus = ref<"saved" | "saving" | "dirty" | "error">("saved");
const now = ref(Date.now());
const helpOpen = ref(false),
  sourceEditor = ref<{ insert(text: string): void }>();
const pdfView = ref<{ follow(anchor: SyncAnchor): void }>();
const canInsertHelp = computed(
  () =>
    (sourcePane.value && sourceEditable.value) ||
    (!sourcePane.value && visual.value && editable.value && editorStatus.value !== "stale"),
);
function insertHelp(entry: { insert: string }, text: string) {
  helpOpen.value = false;
  if (sourcePane.value) sourceEditor.value?.insert(text);
  else editor.value?.insertSnippet(text, entry.insert);
}
let sourceTimer: ReturnType<typeof setTimeout> | undefined,
  sourceQueue: Promise<unknown> = Promise.resolve();
const rawMine = computed(
  () => file.value?.mode === "raw" && file.value.rawOwner === props.user.id,
);
const rawLocked = computed(
  () =>
    file.value?.mode === "raw" &&
    !!file.value.rawOwner &&
    file.value.rawOwner !== props.user.id &&
    (file.value.rawUntil ?? 0) > now.value,
);
const sourcePane = computed(
  () =>
    !!file.value &&
    file.value.kind !== "image" &&
    (file.value.kind === "text" || file.value.mode === "raw" || showSource.value),
);
const sourceEditable = computed(
  () => editable.value && (file.value?.kind === "text" || rawMine.value),
);
const sourceText = computed(() => {
  if (sourceEditable.value) return sourceDraft.value;
  if (file.value?.kind === "text" || file.value?.mode === "raw")
    return file.value.source ?? "";
  return sourceVisible.value;
});
const sourceLanguage = computed(() => {
  const path = file.value?.path || "";
  if (/\.(qmd|md)$/i.test(path)) return "markdown";
  if (/\.ya?ml$/i.test(path)) return "yaml";
  return "text";
});
async function rawPut(source: string, visualMode: boolean) {
  const attempt = () =>
    api(`/projects/${project.value.id}/files/${file.value.id}/raw`, "PUT", {
      revision: rev(),
      epoch: file.value.epoch,
      rawVersion: file.value.rawVersion,
      source,
      visual: visualMode,
    });
  try {
    return await attempt();
  } catch (e: any) {
    // A newer project revision or an expired lease of our own: retry once.
    if (e.code === "REVISION_CONFLICT") await refresh();
    else if (e.code === "RAW_LOCKED" && !rawLocked.value) {
      await api(`/projects/${project.value.id}/files/${file.value.id}/raw`, "POST", {
        revision: rev(),
      });
      await refresh();
    } else throw e;
    return await attempt();
  }
}
async function persistSource(renew: boolean) {
  const f = file.value;
  if (!f || !sourceEditable.value) return;
  const text = sourceDraft.value;
  if (!renew && text === (f.source ?? "")) {
    sourceStatus.value = "saved";
    return;
  }
  sourceStatus.value = "saving";
  try {
    if (f.kind === "text")
      await api(`/projects/${project.value.id}/files/${f.id}/text`, "PUT", {
        revision: rev(),
        source: text,
      }).catch(async (e: any) => {
        if (e.code !== "REVISION_CONFLICT") throw e;
        await refresh();
        return api(`/projects/${project.value.id}/files/${f.id}/text`, "PUT", {
          revision: rev(),
          source: text,
        });
      });
    else await rawPut(text, false);
    await refresh();
    sourceStatus.value = sourceDraft.value === text ? "saved" : "dirty";
  } catch (e) {
    sourceStatus.value = "error";
    fail(e);
  }
}
function saveSource(renew = false) {
  clearTimeout(sourceTimer);
  sourceQueue = sourceQueue.then(() => persistSource(renew));
  return sourceQueue;
}
function onSourceInput(text: string) {
  if (!sourceEditable.value || text === sourceDraft.value) return;
  sourceDraft.value = text;
  sourceStatus.value = "dirty";
  clearTimeout(sourceTimer);
  sourceTimer = setTimeout(() => void saveSource(), 800);
}
async function startRaw() {
  await guarded(async () => {
    if (editor.value?.pending()) throw new Error("SAVING");
    await api(
      `/projects/${project.value.id}/files/${file.value.id}/raw`,
      "POST",
      { revision: rev() },
    );
    await refresh();
    sourceDraft.value = file.value.source ?? "";
    sourceStatus.value = "saved";
    showSource.value = true;
    sessionKey.value++;
  });
}
async function backToVisual() {
  await saveSource();
  await guarded(async () => {
    await rawPut(sourceDraft.value, true);
    await refresh();
    sessionKey.value++;
    showSource.value = false;
  });
}
/** Leaving a document returns it to shared visual editing when possible. */
async function releaseSource() {
  if (!rawMine.value) return;
  await saveSource();
  try {
    await rawPut(sourceDraft.value, true);
  } catch {
    /* Syntax that cannot be visual keeps the document in Markdown mode. */
  }
}
/** Adds image files to the project and returns the last one relative to the open document. */
async function uploadImages(files: File[]) {
  let relative: string | undefined;
  for (const f of files) {
    await guarded(async () => {
      const r = await uploadAsset(project.value.id, {
        revision: rev(),
        uploadId: crypto.randomUUID(),
        name: f.name,
        bytes: await base64(f),
        documentId: file.value?.kind === "document" ? file.value.id : undefined,
      });
      relative = r.result.relative;
      await refresh();
    });
  }
  return relative;
}
/** Saves _quarto.yml, creating it on first use. The server allows only owners. */
async function saveProjectConfig(text: string) {
  await guarded(async () => {
    const config = project.value.data.files.find(
      (f: any) => f.path === "_quarto.yml",
    );
    if (config)
      await api(
        `/projects/${project.value.id}/files/${config.id}/text`,
        "PUT",
        { revision: rev(), source: text },
      );
    else
      await api(`/projects/${project.value.id}/files`, "POST", {
        revision: rev(),
        path: "_quarto.yml",
        source: text,
      });
    await refresh();
  });
}
async function replaceFigure(files: File[]) {
  const src = await uploadImages(files);
  if (src && imageForm.value) imageForm.value = { ...imageForm.value, src };
}
async function invite(email: string, role: string) {
  try {
    const r = await api(`/projects/${project.value.id}/invites`, "POST", {
      revision: rev(),
      email,
      role,
    });
    await refresh();
    return r.result.url as string;
  } catch (e) {
    fail(e);
  }
}
async function changeRole(m: any, role: string | null, transfer = false) {
  if (role === null || transfer) {
    const ok = await askConfirm({
      title: role === null ? t("remove") : t("transfer"),
      message: fmt(role === null ? "removeConfirm" : "transferConfirm", {
        name: m.name,
      }),
      confirm: role === null ? t("remove") : t("transfer"),
      danger: true,
    });
    if (!ok) return;
  }
  await guarded(async () => {
    await api(
      `/projects/${project.value.id}/members/${encodeURIComponent(m.id)}`,
      "PATCH",
      { revision: rev(), role, transfer },
    );
    await refresh();
  });
}
async function reopen() {
  await guarded(async () => {
    savePending();
    await refresh();
    sessionKey.value++;
  });
}
async function rebuild() {
  await guarded(async () => {
    await api(`/projects/${project.value.id}/builds`, "POST", {
      revision: rev(),
    });
    await refresh();
  });
}
async function cancelBuild() {
  if (!latestBuild.value) return;
  await guarded(async () => {
    await api(
      `/projects/${project.value.id}/builds/${latestBuild.value.id}/cancel`,
      "POST",
      { revision: rev() },
    );
    await refresh();
  });
}
async function leave() {
  savePending();
  await releaseSource();
  stream?.close();
  emit("leave");
}
async function logout() {
  savePending();
  await releaseSource();
  stream?.close();
  emit("logout");
}
function choosePanel(value: PanelName) {
  panel.value = panel.value === value ? null : value;
  if (docked.value) savedPanel.save(panel.value);
  if (panel.value === "history" || panel.value === "members") refreshLater();
}
function togglePdf() {
  showPdf.value = !showPdf.value;
  if (splitView.value) pdfPreference.save(showPdf.value);
}
function insertFigure(form: any) {
  editor.value?.insertImage(form);
  imageForm.value = null;
}
const editorKey = computed(() => `${file.value?.id}:${sessionKey.value}`);
watch(
  () => [file.value?.id, file.value?.mode, rawMine.value] as const,
  () => {
    if (sourceStatus.value === "saved" && file.value)
      sourceDraft.value = file.value.source ?? "";
  },
);
// The address follows the open file; back/forward selects it again.
watch(selected, (id) => emit("file", id));
watch(
  () => props.fileId,
  (id) => {
    const target = project.value?.data.files.find((f: any) => f.id === id);
    if (target && id !== selected.value) void selectFile(target);
  },
);
const headerStatus = computed(() => {
  if (!visual.value) return undefined;
  const s = editorStatus.value;
  return {
    state: s,
    text:
      s === "stale"
        ? t("staleShort")
        : ["loading", "saving", "saved", "offline"].includes(s)
          ? t(s as any)
          : errorText(s),
  };
});
// A new document generation (rename, restore, permission change) closes the
// editor connection. Without unsent edits, reopening loses nothing.
let lastAutoReopen = 0;
function onEditorStatus(value: string) {
  editorStatus.value = value;
  if (
    value === "stale" &&
    !editor.value?.pending() &&
    !editor.value?.uploading() &&
    Date.now() - lastAutoReopen > 5000
  ) {
    lastAutoReopen = Date.now();
    void reopen();
  }
}

provide(workspaceKey, {
  project,
  user: props.user,
  file,
  editable,
  owner,
  history,
  members,
  outline,
  outlineLive: visual,
  labels,
  revealLabel: (id: string) => editor.value?.revealLabel(id),
  revealPosition: (pos: number) => editor.value?.revealPosition(pos),
  resource,
  selectFile,
  addFile,
  renameFile,
  deleteFile,
  setTarget,
  moveFile,
  addFolder,
  renameFolder,
  deleteFolder,
  uploadImages,
  makeCheckpoint,
  compare,
  restore,
  invite,
  changeRole,
  scrollToHeading: (index: number) => editor.value?.scrollToHeading(index),
  frontMatter,
  frontMatterEditable: computed(
    () =>
      visual.value &&
      editable.value &&
      !["loading", "stale"].includes(editorStatus.value),
  ),
  setFrontMatter: (text: string) => editor.value?.setFrontMatter(text),
  saveProjectConfig,
});

function onWide(e: MediaQueryListEvent) {
  docked.value = e.matches;
  panel.value = e.matches ? savedPanel.value.value : null;
}
function onRoomy(e: MediaQueryListEvent) {
  splitView.value = e.matches;
  showPdf.value = e.matches && pdfPreference.value.value;
}
// Keep our Markdown lock alive while the pane is open (15 minute lease).
const leaseTimer = setInterval(() => {
  now.value = Date.now();
  if (rawMine.value && sourceStatus.value !== "saving") void saveSource(true);
}, 4 * 60_000);
function warnUnsaved(e: BeforeUnloadEvent) {
  if (["dirty", "saving"].includes(sourceStatus.value)) e.preventDefault();
}
onMounted(async () => {
  addEventListener("beforeunload", warnUnsaved);
  wide.addEventListener("change", onWide);
  roomy.addEventListener("change", onRoomy);
  try {
    await openProject(props.projectId);
  } catch (e) {
    fail(e);
    emit("leave");
  }
});
onBeforeUnmount(() => {
  alive = false;
  clearInterval(leaseTimer);
  clearTimeout(sourceTimer);
  removeEventListener("beforeunload", warnUnsaved);
  stream?.close();
  wide.removeEventListener("change", onWide);
  roomy.removeEventListener("change", onRoomy);
});
</script>
<template>
  <div
    v-if="project"
    :class="['workspace', { docked, 'split-view': splitView }]"
  >
    <WorkspaceHeader
      :project="project"
      :user="user"
      :anonymous="anonymous"
      :status="headerStatus"
      :peers="peers"
      :show-pdf="showPdf"
      :editable="editable"
      :owner="owner"
      @leave="leave"
      @toggle-pdf="togglePdf"
      @share="choosePanel('members')"
      @rename="renameProject"
      @checkpoint="makeCheckpoint"
      @logout="logout"
      @help="helpOpen = true"
    />
    <div class="workspace-body">
      <ActivityRail :active="panel" @select="choosePanel" />
      <aside
        v-if="panel"
        class="side-panel"
        :aria-label="t(panel)"
      >
        <FilesPanel v-if="panel === 'files'" :selected="selected" />
        <OutlinePanel v-else-if="panel === 'outline'" />
        <HistoryPanel v-else-if="panel === 'history'" />
        <MembersPanel v-else-if="panel === 'members'" />
        <SettingsPanel v-else-if="panel === 'settings'" />
      </aside>
      <div
        v-if="panel && !docked"
        class="panel-scrim"
        aria-hidden="true"
        @click="panel = null"
      />
      <main class="document-column">
        <DocumentBar
          v-if="file"
          :file="file"
          :editable="editable"
          :show-source="showSource"
          :raw-mine="rawMine"
          :raw-locked="rawLocked"
          :source-status="sourceEditable ? sourceStatus : undefined"
          @toggle-source="
            sourceVisible = editor?.source() || file.source;
            showSource = !showSource;
          "
          @start-raw="startRaw"
          @back-to-visual="backToVisual"
          @reopen="reopen"
          @download-pending="downloadText(file.path, editor?.source() ?? file.source)"
          @rename="renameFile(file)"
        />
        <div v-if="!file" class="empty-state center-empty">
          <span class="empty-icon"><Icon name="fileText" :size="24" /></span>
          <strong>{{ t("noFileOpen") }}</strong>
        </div>
        <div v-else-if="file.kind === 'image'" class="image-preview scroll">
          <img :src="resource(file.path)" :alt="file.name || file.path" />
        </div>
        <section v-if="sourcePane" class="source-pane">
          <div
            :class="['source-notice', { warn: rawLocked || (file.mode === 'raw' && !rawMine) }]"
            role="status"
          >
            <Icon :name="rawMine || file.kind === 'text' ? 'pencil' : 'info'" :size="16" />
            <span v-if="file.kind === 'text'">{{ file.path }}</span>
            <span v-else-if="rawMine">{{ t("sourceEditingHint") }}</span>
            <span v-else-if="rawLocked">{{ t("rawByOther") }}</span>
            <span v-else-if="file.mode === 'raw' && file.rawOwner">{{ t("rawExpired") }}</span>
            <span v-else-if="file.mode === 'raw'">{{ t("rawUnsafe") }}</span>
            <span v-else>{{ t("sourceReadonlyHint") }}</span>
            <span class="spacer" />
            <button
              type="button"
              class="icon-btn sm"
              :aria-label="t('helpTitle')"
              :data-tip="t('helpTitle')"
              @click="helpOpen = true"
            >
              <Icon name="help" :size="17" />
            </button>
            <button
              v-if="editable && file.kind === 'document' && !rawMine && !rawLocked"
              type="button"
              class="btn sm primary"
              @click="startRaw"
            >
              <Icon name="pencil" :size="15" />{{
                file.mode === "raw" && file.rawOwner ? t("takeOver") : t("editMarkdown")
              }}
            </button>
          </div>
          <SourceEditor
            ref="sourceEditor"
            :key="`${file.id}:${file.mode}:${sourceEditable}`"
            :value="sourceText"
            :readonly="!sourceEditable"
            :language="sourceLanguage"
            :label="file.path"
            @update="onSourceInput"
            @save="saveSource()"
            @sync="pdfView?.follow($event)"
          />
        </section>
        <Editor
          v-if="visual"
          v-show="!sourcePane"
          ref="editor"
          :key="editorKey"
          :project="project"
          :file="file"
          :user="user"
          @revision="revision"
          @image="imageForm = $event"
          @changed="refreshLater"
          @error="fail($event)"
          @status="onEditorStatus"
          @peers="peers = $event"
          @outline="liveOutline = $event"
          @frontmatter="frontMatter = $event"
          @help="helpOpen = true"
          @labels="
            labels = $event;
            if (showSource) sourceVisible = editor?.source() ?? sourceVisible;
          "
          @notice="notify(t($event))"
          @reopen="reopen"
          @sync="pdfView?.follow($event)"
        />
      </main>
      <SplitHandle
        v-if="showPdf && splitView"
        :width="pdfWidth.value.value"
        @resize="pdfWidth.value.value = $event"
        @commit="pdfWidth.save($event)"
      />
      <aside
        v-if="showPdf"
        class="preview-column"
        :style="splitView ? { width: pdfWidth.value.value + 'px' } : undefined"
      >
        <Pdf
          ref="pdfView"
          :project="project.id"
          :build="project.data.pdfBuild"
          :status="latestBuild?.status"
          :pending="
            project.data.pdfRevision !== undefined &&
            project.data.pdfRevision < (project.data.contentRevision || 0)
          "
          :log="latestBuild?.log"
          :can-build="editable"
          @rebuild="rebuild"
          @cancel="cancelBuild"
        />
      </aside>
    </div>
    <ImageDialog
      v-if="imageForm"
      :form="imageForm"
      :resource="resource"
      :document-path="file?.path || ''"
      @submit="insertFigure"
      @replace="replaceFigure"
      @close="imageForm = null"
    />
    <HelpDialog
      v-if="helpOpen"
      :can-insert="canInsertHelp"
      @insert="insertHelp"
      @close="helpOpen = false"
    />
    <DiffDialog
      v-if="comparison"
      :comparison="comparison"
      :project-id="project.id"
      :owner="owner"
      @restore="restore(comparison.id)"
      @close="comparison = null"
    />
  </div>
  <div v-else class="boot" aria-busy="true">
    <span class="brand-mark">Q</span>
  </div>
</template>
<style>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg);
}
.workspace-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.side-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 280px;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}
.workspace:not(.docked) .side-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 48px;
  z-index: 20;
  width: min(320px, calc(100vw - 64px));
  box-shadow: var(--shadow-3);
}
.panel-scrim {
  position: absolute;
  inset: 0 0 0 48px;
  z-index: 19;
  background: var(--backdrop);
}
.document-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--editor-bg);
}
.workspace.split-view .document-column {
  min-width: 360px;
}
.preview-column {
  display: flex;
  flex: none;
  flex-direction: column;
  min-width: 300px;
  max-width: 70vw;
  min-height: 0;
  background: var(--pdf-bg);
}
.workspace:not(.split-view) .preview-column {
  position: absolute;
  inset: 0 0 0 48px;
  z-index: 15;
  max-width: none;
}
.center-empty {
  margin: auto;
}
.image-preview {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 40px;
  background: var(--surface-2);
}
.image-preview img {
  max-width: 100%;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-1);
}
.source-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.source-notice {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 12px 6px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: var(--text-sm);
  line-height: 1.45;
}
.source-notice > svg {
  flex: none;
  color: var(--accent-text);
}
.source-notice.warn {
  border-color: var(--warning-border);
  background: var(--warning-soft);
}
.source-notice.warn > svg {
  color: var(--warning);
}
</style>

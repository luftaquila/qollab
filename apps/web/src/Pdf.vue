<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  watch,
  onBeforeUnmount,
  nextTick,
} from "vue";
import {
  getDocument,
  GlobalWorkerOptions,
  PDFWorker,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { t } from "./i18n";
import Icon from "./ui/Icon.vue";
import { preference } from "./theme";
import { summarizeLog } from "./build-log";
import { indexPdf, locate, type SyncAnchor, type TextIndex } from "./pdf-sync";
GlobalWorkerOptions.workerSrc = worker;
// Document tasks release their own page/font state. Keep the parser worker
// ready for the next PDF until the panel closes.
let sharedWorker: PDFWorker | undefined;
const retiring = new Set<Promise<void>>();
async function destroy(previous: ReturnType<typeof getDocument> | undefined) {
  if (!previous) return;
  const pending = previous.destroy();
  retiring.add(pending);
  try {
    await pending;
  } finally {
    retiring.delete(pending);
  }
}
const props = defineProps<{
  project: string;
  build?: string;
  status?: string;
  pending?: boolean;
  log?: string;
  canBuild?: boolean;
}>();
const emit = defineEmits<{ rebuild: []; cancel: [] }>();
const doc = shallowRef<PDFDocumentProxy>();
const container = ref<HTMLElement>();
const pages = ref<number[]>([]);
// "fit" follows the panel width; a number is a fixed scale.
const scale = preference<"fit" | number>("pdfZoom", "fit");
// Scrolls to where the reader is in the editor; people can turn it off.
const following = preference("pdfFollow", true);
const zoom = ref(1);
const pageSize = ref({ width: 595, height: 842 });
const error = ref("");
const loading = ref(false);
const showLog = ref(false);
const cause = computed(() => summarizeLog(props.log));
const building = computed(
  () => props.status === "queued" || props.status === "running",
);
// People need to know whether the preview shows their latest edits, not build ids.
const state = computed(() => {
  if (building.value)
    return { dot: props.status!, text: t(props.status as "queued" | "running") };
  if (props.status === "failed") return { dot: "failed", text: t("buildFailed") };
  if (!props.build) return { dot: "", text: t("pdf") };
  return props.pending
    ? { dot: "queued", text: t("pdfBehind") }
    : { dot: "succeeded", text: t("pdfCurrent") };
});
let resize: ResizeObserver | undefined,
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
function fit() {
  if (scale.value.value !== "fit" || !container.value) return;
  const width = container.value.clientWidth - 40;
  if (width <= 0) return;
  const next = Math.max(0.25, Math.min(3, width / pageSize.value.width));
  if (Math.abs(next - zoom.value) > 0.01) zoom.value = next;
}
function setZoom(next: number) {
  const value = Math.round(Math.max(0.4, Math.min(3, next)) * 10) / 10;
  scale.save(value);
  zoom.value = value;
}
function fitWidth() {
  scale.save("fit");
  fit();
}
// --- Following the editor ---------------------------------------------------
const marker = ref<{ page: number; top: number; height: number; key: number }>();
let textIndex: TextIndex | null = null,
  lastAnchor: SyncAnchor | undefined,
  lastFound: number | undefined,
  markerTimer: ReturnType<typeof setTimeout> | undefined;
async function buildIndex(pdf: PDFDocumentProxy, v: number) {
  textIndex = null;
  lastFound = undefined;
  const index = await indexPdf(pdf, () => v === version).catch(() => null);
  if (v !== version || !index) return;
  textIndex = index;
  if (lastAnchor && following.value.value) await reveal(lastAnchor);
}
/** Puts the PDF line for the editor's anchor at about the same height. */
async function reveal(anchor: SyncAnchor) {
  const box = textIndex && locate(textIndex, anchor, lastFound);
  if (box) lastFound = box.at;
  await nextTick();
  const element = container.value,
    page = element?.querySelector<HTMLElement>(`[data-page="${box?.page}"]`);
  if (!box || !element || !page) return;
  const pageTop =
    page.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
  const top = pageTop + box.top * zoom.value,
    height = (box.bottom - box.top) * zoom.value;
  // Keep the line well inside the view even when the editor's is at an edge.
  const ratio = Math.min(0.7, Math.max(0.15, anchor.ratio));
  element.scrollTop = top - ratio * element.clientHeight;
  marker.value = { page: box.page, top: box.top * zoom.value, height, key: (marker.value?.key ?? 0) + 1 };
  clearTimeout(markerTimer);
  markerTimer = setTimeout(() => (marker.value = undefined), 1500);
}
function follow(anchor: SyncAnchor) {
  lastAnchor = anchor;
  if (following.value.value && doc.value) void reveal(anchor);
}
function toggleFollow() {
  following.save(!following.value.value);
  if (following.value.value && lastAnchor) void reveal(lastAnchor);
}
defineExpose({ follow });
// `version` identifies the loaded document; `generation` a render pass of it.
let task: ReturnType<typeof getDocument> | undefined,
  observer: IntersectionObserver | undefined,
  version = 0,
  generation = 0;
const renders = new Set<RenderTask>();
const rendered = new Set<number>();
function resetRenders() {
  generation++;
  observer?.disconnect();
  for (const r of renders) r.cancel();
  renders.clear();
  rendered.clear();
}
async function paint(page: number, element: HTMLCanvasElement, g: number) {
  if (!doc.value || rendered.has(page) || g !== generation) return;
  rendered.add(page);
  try {
    const p = await doc.value.getPage(page);
    if (g !== generation) return;
    const viewport = p.getViewport({ scale: zoom.value }),
      ratio = Math.min(devicePixelRatio, 2);
    element.height = viewport.height * ratio;
    element.width = viewport.width * ratio;
    element.style.width = viewport.width + "px";
    element.style.height = viewport.height + "px";
    const r = p.render({
      canvas: element,
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    renders.add(r);
    await r.promise;
    renders.delete(r);
  } catch (e: any) {
    if (g === generation && e.name !== "RenderingCancelledException")
      error.value = e.message;
  }
}
async function observe() {
  await nextTick();
  const g = generation;
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting)
          void paint(
            Number((e.target as HTMLElement).dataset.page),
            e.target.querySelector("canvas")!,
            g,
          );
    },
    { root: container.value, rootMargin: "600px" },
  );
  container.value
    ?.querySelectorAll("[data-page]")
    .forEach((e) => observer!.observe(e));
}
watch(
  () => [props.project, props.build],
  async () => {
    const v = ++version,
      scroll = container.value?.scrollTop || 0;
    error.value = "";
    resetRenders();
    const previous = task;
    task = undefined;
    loading.value = !!props.build;
    doc.value = undefined;
    pages.value = [];
    await destroy(previous);
    if (v !== version) return;
    if (!props.build) return;
    let current: ReturnType<typeof getDocument> | undefined;
    try {
      current = getDocument({
        worker: (sharedWorker ||= new PDFWorker()),
        url: `/api/projects/${props.project}/pdf?build=${props.build}`,
        withCredentials: true,
      });
      task = current;
      const pdf = await current.promise;
      if (v !== version) {
        await destroy(current);
        return;
      }
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      if (v !== version) return;
      pageSize.value = { width: first.width, height: first.height };
      if (scale.value.value === "fit") fit();
      else zoom.value = scale.value.value;
      doc.value = pdf;
      pages.value = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      await observe();
      if (container.value) container.value.scrollTop = scroll;
      void buildIndex(pdf, v);
    } catch (e: any) {
      if (v === version) error.value = e.message;
    } finally {
      if (v === version) loading.value = false;
    }
  },
  { immediate: true },
);
watch(zoom, () => {
  if (!doc.value) return;
  resetRenders();
  void observe();
  if (lastAnchor && following.value.value) void reveal(lastAnchor);
});
watch(container, (element) => {
  resize?.disconnect();
  if (!element) return;
  resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 120);
  });
  resize.observe(element);
});
onBeforeUnmount(() => {
  resize?.disconnect();
  clearTimeout(resizeTimer);
  clearTimeout(markerTimer);
  version++;
  resetRenders();
  void destroy(task)
    .catch(() => {})
    .then(() => Promise.allSettled([...retiring]))
    .finally(() => sharedWorker?.destroy());
});
</script>
<template>
  <div class="pdf-panel">
    <div class="pdf-bar">
      <span :class="['status-dot', state.dot]" />
      <span class="pdf-status">{{ state.text }}</span>
      <span class="spacer" />
      <button
        v-if="canBuild && building"
        type="button"
        class="icon-btn"
        :aria-label="t('cancelBuild')"
        :data-tip="t('cancelBuild')"
        @click="emit('cancel')"
      >
        <Icon name="stop" />
      </button>
      <button
        v-if="canBuild"
        type="button"
        class="icon-btn"
        :aria-label="t('build')"
        :data-tip="t('build')"
        :disabled="building"
        @click="emit('rebuild')"
      >
        <Icon name="refresh" />
      </button>
      <span class="pdf-sep" />
      <button
        type="button"
        class="icon-btn"
        :aria-pressed="following.value.value"
        :aria-label="t('followEditor')"
        :data-tip="t(following.value.value ? 'followEditorOn' : 'followEditorOff')"
        @click="toggleFollow"
      >
        <Icon name="target" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :aria-label="t('zoomOut')"
        :data-tip="t('zoomOut')"
        :disabled="loading || !doc"
        @click="setZoom(zoom - 0.1)"
      >
        <Icon name="zoomOut" />
      </button>
      <button
        type="button"
        :class="['pdf-zoom', { active: scale.value.value === 'fit' }]"
        :aria-label="t('fitWidth')"
        :data-tip="t('fitWidth')"
        :disabled="loading || !doc"
        @click="fitWidth"
      >
        {{ Math.round(zoom * 100) }}%
      </button>
      <button
        type="button"
        class="icon-btn"
        :aria-label="t('zoomIn')"
        :data-tip="t('zoomIn')"
        :disabled="loading || !doc"
        @click="setZoom(zoom + 0.1)"
      >
        <Icon name="zoomIn" />
      </button>
      <a
        v-if="build"
        class="icon-btn"
        :href="`/api/projects/${project}/pdf`"
        download="document.pdf"
        :aria-label="t('downloadPdf')"
        :data-tip="t('downloadPdf')"
        ><Icon name="download"
      /></a>
    </div>
    <div v-if="status === 'failed'" class="pdf-failure" role="status">
      <div class="pdf-failure-head">
        <Icon name="alert" />
        <span class="pdf-failure-text"
          >{{ t("failed")
          }}<strong v-if="cause">{{ t("cause") }}: {{ cause }}</strong></span
        >
        <span class="spacer" />
        <button
          v-if="log"
          type="button"
          class="btn sm ghost"
          :aria-expanded="showLog"
          @click="showLog = !showLog"
        >
          {{ showLog ? t("hideLog") : t("showLog") }}
        </button>
      </div>
      <pre v-if="showLog && log" class="pdf-log scroll">{{ log }}</pre>
    </div>
    <div ref="container" class="pdf-pages scroll">
      <div
        v-if="!build || loading"
        class="pdf-empty"
        role="status"
        aria-live="polite"
      >
        <div class="paper-icon"><Icon name="fileText" :size="28" /></div>
        <p>
          {{
            loading
              ? t("loading")
              : building
                ? t(status === "queued" ? "queued" : "running")
                : t("noPdf")
          }}
        </p>
        <progress v-if="building || loading" :aria-label="t('running')" />
        <small v-if="building && !loading">{{ t("firstPdf") }}</small>
      </div>
      <p v-if="error" class="notice">{{ error }}</p>
      <div
        v-for="page in pages"
        :key="page"
        :data-page="page"
        class="pdf-page"
        :style="{
          width: pageSize.width * zoom + 'px',
          minHeight: pageSize.height * zoom + 'px',
        }"
      >
        <canvas /><small>{{ page }}</small>
        <div
          v-if="marker?.page === page"
          :key="marker.key"
          class="pdf-follow-mark"
          :style="{ top: marker.top - 3 + 'px', height: marker.height + 6 + 'px' }"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>
<style>
.pdf-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.pdf-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 46px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-size: var(--text-sm);
}
.pdf-status {
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
}
.pdf-sep {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: var(--border);
}
.pdf-zoom {
  min-width: 52px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pdf-zoom:hover:not(:disabled) {
  background: var(--hover);
}
.pdf-zoom.active {
  color: var(--accent-text);
}
.pdf-failure {
  flex: none;
  border-bottom: 1px solid var(--warning-border);
  background: var(--warning-soft);
  font-size: var(--text-sm);
}
.pdf-failure-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 8px 4px 14px;
  color: var(--text);
}
.pdf-failure-head > svg {
  flex: none;
  color: var(--warning);
}
.pdf-failure-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.pdf-failure-text strong {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.pdf-log {
  max-height: 220px;
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--warning-border);
  background: var(--surface);
  font: 12px/1.55 var(--font-mono);
  white-space: pre-wrap;
}
.pdf-pages {
  flex: 1;
  min-height: 0;
  padding: 20px;
  background: var(--pdf-bg);
}
.pdf-page {
  position: relative;
  max-width: none;
  margin: 0 auto 28px;
  background: var(--paper);
  box-shadow: var(--shadow-1);
}
.pdf-page canvas {
  display: block;
}
/* The line the editor is at, briefly. */
.pdf-follow-mark {
  position: absolute;
  left: 0;
  right: 0;
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  pointer-events: none;
  animation: pdf-follow 1.5s ease-out forwards;
}
@keyframes pdf-follow {
  0%,
  60% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pdf-follow-mark {
    animation: none;
  }
}
.pdf-page small {
  position: absolute;
  right: 0;
  bottom: -20px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.pdf-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16vh 20px;
  color: var(--text-muted);
  font-size: var(--text-md);
  line-height: 1.6;
  text-align: center;
}
.pdf-empty p {
  margin: 0;
  color: var(--text-2);
  font-weight: 500;
}
.pdf-empty small {
  max-width: 280px;
  font-size: var(--text-sm);
}
.paper-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 70px;
  margin-bottom: 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
}
.pdf-empty progress {
  width: 180px;
  height: 6px;
  margin: 8px 0 12px;
  accent-color: var(--accent);
}
</style>

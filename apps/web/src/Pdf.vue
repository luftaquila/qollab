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
}>();
const doc = shallowRef<PDFDocumentProxy>();
const container = ref<HTMLElement>();
const pages = ref<number[]>([]);
const zoom = ref(1);
const error = ref("");
const loading = ref(false);
const building = computed(
  () => props.status === "queued" || props.status === "running",
);
let task: ReturnType<typeof getDocument> | undefined,
  observer: IntersectionObserver | undefined,
  version = 0;
const renders = new Set<RenderTask>();
const rendered = new Set<number>();
async function paint(page: number, element: HTMLCanvasElement, v: number) {
  if (!doc.value || rendered.has(page)) return;
  rendered.add(page);
  try {
    const p = await doc.value.getPage(page);
    if (v !== version) return;
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
    if (v === version && e.name !== "RenderingCancelledException")
      error.value = e.message;
  }
}
async function observe() {
  await nextTick();
  const v = version;
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting)
          void paint(
            Number((e.target as HTMLElement).dataset.page),
            e.target.querySelector("canvas")!,
            v,
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
    observer?.disconnect();
    for (const r of renders) r.cancel();
    renders.clear();
    rendered.clear();
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
      doc.value = pdf;
      pages.value = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      await observe();
      if (container.value) container.value.scrollTop = scroll;
    } catch (e: any) {
      if (v === version) error.value = e.message;
    } finally {
      if (v === version) loading.value = false;
    }
  },
  { immediate: true },
);
watch(zoom, () => {
  version++;
  for (const r of renders) r.cancel();
  renders.clear();
  rendered.clear();
  void observe();
});
onBeforeUnmount(() => {
  version++;
  observer?.disconnect();
  for (const r of renders) r.cancel();
  void destroy(task)
    .catch(() => {})
    .then(() => Promise.allSettled([...retiring]))
    .finally(() => sharedWorker?.destroy());
});
</script>
<template>
  <div class="pdf-panel">
    <div class="pdf-tools">
      <span>{{ t("pdf") }}</span
      ><span class="spacer" /><button
        :disabled="loading || !doc"
        @click="zoom = Math.max(0.4, zoom - 0.1)"
      >
        −</button
      ><span>{{ Math.round(zoom * 100) }}%</span
      ><button
        :disabled="loading || !doc"
        @click="zoom = Math.min(2, zoom + 0.1)"
      >
        +</button
      ><a
        v-if="build"
        :href="`/api/projects/${project}/pdf`"
        download="document.pdf"
        >↓ {{ t("download") }}</a
      >
    </div>
    <div ref="container" class="pdf-pages">
      <div
        v-if="!build || loading"
        class="pdf-empty"
        role="status"
        aria-live="polite"
      >
        <div class="paper-icon">PDF</div>
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
        :style="{ minHeight: 800 * zoom + 'px' }"
      >
        <canvas /><small>{{ page }}</small>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { errorText, t } from "./i18n";
import { pdfCacheKey } from "./pdf-cache";
import type { Numbering } from "../../../packages/codec/src/numbering";
const busy = ref(false),
  error = ref("");
let worker: Worker | undefined,
  timeout: ReturnType<typeof setTimeout> | undefined,
  controller: AbortController | undefined,
  preview: Window | null = null,
  cached: { key: string; url: string } | undefined;
const urls = new Set<string>();
function stop() {
  worker?.terminate();
  worker = undefined;
  controller?.abort();
  clearTimeout(timeout);
  busy.value = false;
}
function cancel() {
  stop();
  if (preview && !preview.closed) preview.close();
  preview = null;
}
function open(url: string) {
  const tab = window.open(url, "_blank");
  if (tab) {
    tab.opener = null;
  } else {
    error.value = errorText("POPUP_BLOCKED");
  }
  return tab;
}
function preparing(tab: Window) {
  const doc = tab.document;
  doc.title = t("pdfPreparing");
  doc.documentElement.lang = document.documentElement.lang;
  const style = doc.createElement("style");
  style.textContent = `
    :root { color-scheme: light dark; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; font:14px system-ui,sans-serif; }
    .status { display:flex; gap:12px; align-items:center; padding:20px 24px; border:1px solid #8885; border-radius:12px; box-shadow:0 8px 30px #0001; }
    .spinner { width:16px; height:16px; border:2px solid #8885; border-top-color:currentColor; border-radius:50%; animation:spin .8s linear infinite; }
    button { font:inherit; cursor:pointer; border:1px solid #8886; border-radius:6px; background:transparent; color:inherit; padding:6px 10px; }
    @keyframes spin { to { transform:rotate(360deg) } }
    @media(prefers-reduced-motion:reduce) { .spinner { animation:none } }
  `;
  doc.head.append(style);
  const card = doc.createElement("div");
  card.className = "status";
  card.setAttribute("role", "status");
  const spinner = doc.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = doc.createElement("span");
  text.textContent = t("pdfPreparing");
  const button = doc.createElement("button");
  button.textContent = t("cancel");
  button.addEventListener("click", cancel);
  card.append(spinner, text, button);
  doc.body.replaceChildren(card);
}
async function generate(
  project: string,
  target: string,
  overrides: Record<string, string>,
  numbering?: Numbering,
  assets: Record<string, string> = {},
) {
  cancel();
  error.value = "";
  const settings = numbering
    ? JSON.parse(JSON.stringify(numbering))
    : undefined;
  const sources = { ...overrides },
    images = { ...assets };
  const key = pdfCacheKey({
    project,
    target,
    overrides: sources,
    numbering: settings,
    assets: images,
  });
  // This path is synchronous with the click: no export, worker or popup delay.
  if (cached?.key === key) {
    open(cached.url + "#view=Fit");
    return;
  }
  // Reserve the tab during the user's click. A long compile must not turn the
  // result into an unsolicited popup that needs another browser permission.
  preview = open("about:blank");
  if (!preview) return;
  preparing(preview);
  busy.value = true;
  controller = new AbortController();
  const signal = controller.signal;
  const fail = (message: string) => {
    if (signal.aborted) return;
    error.value = message;
    cancel();
  };
  try {
    const r = await fetch(
      `/api/projects/${encodeURIComponent(project)}/export`,
      { signal },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const zip = await r.arrayBuffer();
    if (signal.aborted) return;
    worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onerror = (e) => fail(e.message);
    worker.onmessage = (e) => {
      if (signal.aborted) return;
      if (e.data.error) {
        fail(e.data.error);
        return;
      }
      if (e.data.bytes) {
        const url = URL.createObjectURL(
          new Blob([e.data.bytes], { type: "application/pdf" }),
        );
        urls.add(url);
        if (e.data.cacheable) cached = { key, url };
        busy.value = false;
        worker?.terminate();
        worker = undefined;
        clearTimeout(timeout);
        if (preview && !preview.closed)
          preview.location.replace(url + "#view=Fit");
        preview = null;
      }
    };
    timeout = setTimeout(() => fail(t("errTimeout")), 180000);
    worker.postMessage(
      { zip, target, overrides: sources, numbering: settings, assets: images },
      [zip],
    );
  } catch (e) {
    if (!signal.aborted) fail(String(e));
  }
}
defineExpose({ generate, busy });
onBeforeUnmount(() => {
  cancel();
  for (const url of urls) URL.revokeObjectURL(url);
});
</script>
<template>
  <Teleport to="body">
    <div v-if="busy || error" class="browser-pdf-result">
      <p v-if="busy" role="status">
        <span class="pdf-spinner" aria-hidden="true" />
        {{ t("pdfPreparing") }}
        <button class="btn sm" @click="cancel">{{ t("cancel") }}</button>
      </p>
      <p v-else role="alert">
        {{ error }}
        <button class="btn sm" @click="error = ''">{{ t("close") }}</button>
      </p>
    </div>
  </Teleport>
</template>
<style>
.browser-pdf-result {
  position: fixed;
  z-index: 100;
  right: 24px;
  bottom: 24px;
  max-width: min(420px, calc(100vw - 48px));
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  background: var(--surface);
  font-size: 13px;
}
.browser-pdf-result p {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  overflow-wrap: anywhere;
}
.pdf-spinner {
  width: 16px;
  height: 16px;
  flex: none;
  border: 2px solid var(--border);
  border-top-color: var(--text);
  border-radius: 50%;
  animation: pdf-spin 0.8s linear infinite;
}
@keyframes pdf-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .pdf-spinner {
    animation: none;
  }
}
</style>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from "vue";
import { renderDocument } from "./web-document";
import { api } from "./api";
import { t } from "./i18n";
import { fail } from "./ui/feedback";
import type { Numbering } from "../../../packages/codec/src/numbering";
import "./styles/document.css";
import { followWeb } from "./web-sync";
import type { SyncAnchor } from "./editor-sync";
import { preference } from "./theme";
import "katex/dist/katex.min.css";
const props = defineProps<{
  project: string;
  owner?: boolean;
  path: string;
  source: string;
  numbering?: Numbering;
  webFormat?: string;
  pdfBusy?: boolean;
}>();
const emit = defineEmits<{ pdf: [] }>();
const scroll = ref<HTMLElement>();
const following = preference("webFollow", true);
let anchor: SyncAnchor | undefined;
function follow(value: SyncAnchor) {
  anchor = value;
  if (following.value.value && scroll.value) followWeb(scroll.value, value);
}
function toggleFollow() {
  following.save(!following.value.value);
  if (anchor) follow(anchor);
}
watch(
  () => props.source,
  async () => {
    await nextTick();
    if (anchor) follow(anchor);
  },
);
defineExpose({ follow });
const rendered = computed(() =>
  renderDocument(props.source, {
    project: props.project,
    path: props.path,
    numbering: props.numbering,
    webFormat: props.webFormat,
  }),
);
const site = ref<{ published: boolean; url: string }>();
const publishing = ref(false);
onMounted(async () => {
  try {
    site.value = await api(`/projects/${props.project}/website`);
  } catch (e) {
    fail(e);
  }
});
async function publish() {
  const tab = window.open("about:blank", "_blank");
  if (tab) {
    tab.opener = null;
    tab.document.body.textContent = "웹 문서 생성 중…";
  }
  publishing.value = true;
  try {
    const result = await api(`/projects/${props.project}/website`, "POST");
    site.value = { published: true, url: result.url };
    if (tab) tab.location.replace(result.url);
  } catch (e) {
    tab?.close();
    fail(e);
  } finally {
    publishing.value = false;
  }
}
</script>
<template>
  <section class="web-preview">
    <div class="web-preview-tools">
      <strong>미리보기</strong>
      <button
        class="btn sm"
        :class="{ primary: following.value.value }"
        :aria-pressed="following.value.value"
        @click="toggleFollow"
      >
        커서 따라가기
      </button>
      <a
        v-if="site?.published"
        :href="site.url"
        target="_blank"
        rel="noopener"
        class="btn sm"
        >웹 문서 ↗</a
      >
      <button
        v-else-if="owner"
        class="btn sm"
        :disabled="publishing"
        @click="publish"
      >
        {{ publishing ? "웹 문서 생성 중…" : "웹 문서 발행" }}
      </button>
      <button
        type="button"
        class="btn sm"
        :disabled="pdfBusy"
        title="현재 내용을 브라우저에서 PDF로 생성해 새 탭에서 엽니다"
        @click="emit('pdf')"
      >
        PDF <span aria-hidden="true">↗</span>
      </button>
    </div>
    <div ref="scroll" class="web-preview-scroll">
      <details v-if="rendered.warnings.length" class="web-warning">
        <summary>
          일부 서식은 웹에서 간략히 표시됩니다 ({{ rendered.warnings.length }})
        </summary>
        <p v-for="warning in rendered.warnings" :key="warning">
          {{
            warning.startsWith("Typst:")
              ? "실행하지 않는 사용자 정의 함수: " + warning.slice(7)
              : warning === "webUnsupported"
                ? t("webUnsupported")
                : warning
          }}
        </p>
      </details>
      <p v-if="!rendered.html.trim()" class="empty-state">
        {{ t("noContent") }}
      </p>
      <article class="qollab-document" v-html="rendered.html" />
    </div>
  </section>
</template>
<style>
.web-preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  background: var(--surface);
}
.web-preview-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}
.web-preview-tools strong {
  margin-right: auto;
}
.web-preview-scroll {
  overflow: auto;
  padding: 16px 28px 80px;
  flex: 1;
}
.web-warning {
  font-size: 12px;
  background: var(--warning-soft);
  color: var(--warning);
  padding: 10px;
  border-radius: 6px;
}
</style>

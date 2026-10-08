<script setup lang="ts">
import { ref, computed } from "vue";
import Dialog from "./ui/Dialog.vue";
import Icon from "./ui/Icon.vue";
import type { LabelEntry } from "./editor-labels";
import { t, type Word } from "./i18n";
const props = defineProps<{ labels: LabelEntry[] }>();
const emit = defineEmits<{ choose: [LabelEntry]; close: [] }>();
const query = ref("");
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q
    ? props.labels.filter((l) => (l.id + " " + l.text).toLowerCase().includes(q))
    : props.labels;
});
</script>
<script lang="ts">
export const kindWord = (kind: string): Word =>
  (({ sec: "kindSec", fig: "kindFig", tbl: "kindTbl", eq: "kindEq", span: "kindSpan" }) as Record<
    string,
    Word
  >)[kind] || "kindOther";
/** What the label is on: a heading or figure regardless of its name's prefix. */
export const badgeWord = (label: LabelEntry): Word =>
  label.owner === "heading"
    ? "kindSec"
    : label.owner === "figure"
      ? "kindFig"
      : label.latex
        ? "kindLatex"
        : kindWord(label.kind);
</script>
<template>
  <Dialog :title="t('referenceTitle')" @close="emit('close')">
    <div class="modal-body reference-picker">
      <input
        v-model="query"
        class="input"
        type="search"
        autofocus
        :placeholder="t('searchLabels')"
        :aria-label="t('searchLabels')"
        @keydown.enter.prevent="shown[0] && emit('choose', shown[0])"
      />
      <p v-if="!labels.length" class="muted">{{ t("noLabels") }}</p>
      <ul class="label-choices">
        <li v-for="label in shown" :key="label.id">
          <button type="button" class="label-choice" @click="emit('choose', label)">
            <span :class="['badge', label.kind === 'span' && !label.latex ? '' : 'accent']">{{
              t(badgeWord(label))
            }}</span>
            <span class="label-choice-text">
              <strong>{{ label.text || label.id }}</strong>
              <code>#{{ label.id }}</code>
            </span>
            <small class="label-choice-result">{{
              t(label.latex || label.kind !== "span" ? "referenceNumber" : "referenceLink")
            }}</small>
            <Icon name="chevronRight" :size="16" />
          </button>
        </li>
      </ul>
    </div>
  </Dialog>
</template>
<style>
.reference-picker {
  min-height: 260px;
}
.label-choices {
  margin: 0;
  padding: 0;
  list-style: none;
}
.label-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.label-choice:hover,
.label-choice:focus-visible {
  background: var(--hover);
}
.label-choice-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.label-choice-text strong {
  overflow: hidden;
  font-size: var(--text-md);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label-choice-text code {
  color: var(--text-muted);
  font: var(--text-xs) var(--font-mono);
}
.label-choice-result {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>

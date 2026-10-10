<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "../ui/Icon.vue";
import { useWorkspace } from "./context";
import { t } from "../i18n";
const ws = useWorkspace();
const query = ref("");
const base = computed(() =>
  Math.min(6, ...ws.outline.value.map((h) => h.level)),
);
// Matching headings keep their index: scrolling goes by position in the outline.
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return ws.outline.value
    .map((heading, index) => ({ heading, index }))
    .filter(({ heading }) => heading.text.toLowerCase().includes(q));
});
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("outline") }}</h2>
  </div>
  <label v-if="ws.outline.value.length" class="panel-search">
    <Icon name="search" :size="16" />
    <input
      v-model="query"
      class="input"
      type="search"
      :placeholder="t('searchHeadings')"
      :aria-label="t('searchHeadings')"
    />
  </label>
  <div class="panel-body scroll">
    <div v-if="!ws.outline.value.length" class="empty-state compact">
      <span class="empty-icon"><Icon name="outline" :size="22" /></span>
      <span>{{ t("noHeadings") }}</span>
    </div>
    <p v-else-if="!shown.length" class="muted panel-note">{{ t("noResult") }}</p>
    <ol v-else class="outline-list">
      <li v-for="{ heading, index } in shown" :key="index">
        <button
          type="button"
          :class="['outline-item', 'level-' + heading.level]"
          :style="{ paddingLeft: 10 + (heading.level - base) * 14 + 'px' }"
          :disabled="!ws.outlineLive.value"
          @click="ws.scrollToHeading(index)"
        >
          {{ heading.text || "—" }}
        </button>
      </li>
    </ol>
  </div>
</template>
<style>
.empty-state.compact {
  padding: 32px 12px;
  font-size: var(--text-md);
}
.outline-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.outline-item {
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  font-size: var(--text-md);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}
.outline-item:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.outline-item:disabled {
  cursor: default;
}
.outline-item.level-1 {
  color: var(--text);
  font-weight: 600;
}
</style>

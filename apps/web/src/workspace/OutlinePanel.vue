<script setup lang="ts">
import { computed } from "vue";
import Icon from "../ui/Icon.vue";
import { useWorkspace } from "./context";
import { t, fmt } from "../i18n";
import { badgeWord } from "../ReferencePicker.vue";
import { labelKind } from "../../../../packages/codec/src/labels";
const ws = useWorkspace();
// One row per label with how often it is referenced, and references whose
// numbered target (fig-, tbl-, sec-, eq-) or #link target does not exist.
const labels = computed(() => {
  const index = ws.labels.value;
  if (!index) return [];
  return index.labels.map((label) => ({
    ...label,
    count: index.refs.filter((r) => r.key === label.id).length,
  }));
});
const missing = computed(() => {
  const index = ws.labels.value;
  if (!index) return [];
  const known = new Set(index.labels.map((l) => l.id)),
    groups = new Map<string, { key: string; pos: number; count: number }>();
  for (const ref of index.refs) {
    if (known.has(ref.key) || (!ref.link && labelKind(ref.key) === "span")) continue;
    const group = groups.get(ref.key) || { key: ref.key, pos: ref.pos, count: 0 };
    group.count++;
    groups.set(ref.key, group);
  }
  return [...groups.values()];
});
const base = computed(() =>
  Math.min(6, ...ws.outline.value.map((h) => h.level)),
);
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("outline") }}</h2>
  </div>
  <div class="panel-body scroll">
    <div v-if="!ws.outline.value.length" class="empty-state compact">
      <span class="empty-icon"><Icon name="outline" :size="22" /></span>
      <span>{{ t("noHeadings") }}</span>
    </div>
    <ol v-else class="outline-list">
      <li v-for="(heading, index) in ws.outline.value" :key="index">
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
    <template v-if="labels.length">
      <h3 class="panel-section-title">{{ t("labelsTitle") }} · {{ labels.length }}</h3>
      <ul class="label-list">
        <li v-for="label in labels" :key="label.id">
          <button type="button" class="label-row" @click="ws.revealLabel(label.id)">
            <span :class="['badge', label.kind === 'span' ? '' : 'accent']">{{
              t(badgeWord(label))
            }}</span>
            <span class="label-row-text">
              <span>{{ label.text || label.id }}</span>
              <code>#{{ label.id }}</code>
            </span>
            <span class="label-count">{{ fmt("refCount", { n: label.count }) }}</span>
          </button>
        </li>
      </ul>
    </template>
    <template v-if="missing.length">
      <h3 class="panel-section-title missing-title">
        <Icon name="alert" :size="14" />{{ t("brokenRefs") }}
      </h3>
      <ul class="label-list">
        <li v-for="ref in missing" :key="ref.key">
          <button type="button" class="label-row" @click="ws.revealPosition(ref.pos)">
            <code class="missing-key">@{{ ref.key }}</code>
            <span class="label-count">{{ fmt("refCount", { n: ref.count }) }}</span>
          </button>
        </li>
      </ul>
    </template>
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
.label-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.label-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}
.label-row:hover {
  background: var(--hover);
}
.label-row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: var(--text-md);
}
.label-row-text span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label-row-text code,
.missing-key {
  color: var(--text-muted);
  font: var(--text-xs) var(--font-mono);
}
.missing-key {
  flex: 1;
  color: var(--danger);
  font-size: var(--text-sm);
}
.label-count {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.missing-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--danger);
}
</style>

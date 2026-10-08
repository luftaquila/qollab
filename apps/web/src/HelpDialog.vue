<script setup lang="ts">
import { ref, computed } from "vue";
import Dialog from "./ui/Dialog.vue";
import Icon from "./ui/Icon.vue";
import { helpSections, pick } from "./help";
import { t } from "./i18n";
const emit = defineEmits<{ close: [] }>();
const section = ref(helpSections[0].id);
const query = ref("");
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return helpSections.filter((s) => s.id === section.value);
  return helpSections
    .map((s) => ({
      ...s,
      entries: s.entries.filter((e) =>
        (pick(e.syntax) + " " + pick(e.text)).toLowerCase().includes(q),
      ),
    }))
    .filter((s) => s.entries.length);
});
</script>
<template>
  <Dialog :title="t('helpTitle')" wide @close="emit('close')">
    <div class="help-layout">
      <nav class="help-nav" :aria-label="t('helpTitle')">
        <input
          v-model="query"
          class="input"
          type="search"
          autofocus
          :placeholder="t('helpSearch')"
          :aria-label="t('helpSearch')"
        />
        <button
          v-for="s in helpSections"
          :key="s.id"
          type="button"
          :class="['help-tab', { active: !query && section === s.id }]"
          :aria-current="!query && section === s.id"
          @click="
            section = s.id;
            query = '';
          "
        >
          {{ pick(s.title) }}
        </button>
      </nav>
      <div class="help-body scroll">
        <section v-for="s in shown" :key="s.id" class="help-section">
          <h3>{{ pick(s.title) }}</h3>
          <p v-if="s.note" class="help-note">{{ pick(s.note) }}</p>
          <ul class="help-entries">
            <li v-for="(entry, i) in s.entries" :key="i" class="help-entry">
              <pre class="help-syntax">{{ pick(entry.syntax) }}</pre>
              <div class="help-text">
                <span>{{ pick(entry.text) }}</span>
              </div>
            </li>
          </ul>
        </section>
        <p v-if="!shown.length" class="muted">{{ t("noResult") }}</p>
      </div>
    </div>
  </Dialog>
</template>
<style>
.help-layout {
  display: grid;
  flex: 1;
  grid-template-columns: 220px 1fr;
  min-height: 0;
  border-top: 1px solid var(--border);
}
.help-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}
.help-nav .input {
  margin-bottom: 8px;
}
.help-tab {
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
}
.help-tab:hover {
  background: var(--hover);
}
.help-tab.active {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
.help-body {
  min-height: 0;
  padding: 8px 20px 24px;
}
.help-section h3 {
  margin: 12px 0 4px;
  font-size: var(--text-lg);
}
.help-note {
  margin: 0 0 8px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.55;
}
.help-entries {
  margin: 0;
  padding: 0;
  list-style: none;
}
.help-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.help-syntax {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--text);
  font: 13px/1.6 var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.help-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--text-2);
  font-size: var(--text-md);
  line-height: 1.5;
}
@media (max-width: 760px) {
  .help-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .help-nav {
    flex-direction: row;
    flex-wrap: wrap;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .help-entry {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>

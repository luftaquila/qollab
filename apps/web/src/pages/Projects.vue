<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, base64 } from "../api";
import { t, fmt } from "../i18n";
import { ago, fullTime } from "../ui/time";
import { perform, askText, askConfirm } from "../ui/feedback";
import Icon from "../ui/Icon.vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import { openContextMenu } from "../ui/context-menu";
import UserMenu from "../ui/UserMenu.vue";
defineProps<{ user: any; anonymous?: boolean }>();
const emit = defineEmits<{ open: [id: string]; logout: [] }>();
const projects = ref<any[]>([]),
  loaded = ref(false),
  query = ref(""),
  zipInput = ref<HTMLInputElement>();
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q
    ? projects.value.filter((p) => p.name.toLowerCase().includes(q))
    : projects.value;
});
async function load() {
  projects.value = await api("/projects");
  loaded.value = true;
}
async function create() {
  const name = await askText({
    title: t("newProject"),
    label: t("projectName"),
    confirm: t("create"),
  });
  if (!name) return;
  await perform(async () => {
    const p = await api("/projects", "POST", { name });
    emit("open", p.id);
  });
}
async function importZip(event: Event) {
  const input = event.target as HTMLInputElement,
    f = input.files?.[0];
  if (!f) return;
  await perform(async () => {
    const p = await api("/import", "POST", {
      name: f.name.replace(/\.zip$/i, ""),
      bytes: await base64(f),
    });
    emit("open", p.id);
  });
  input.value = "";
}
async function rename(p: any) {
  const name = await askText({
    title: t("renameProject"),
    label: t("projectName"),
    value: p.name,
    confirm: t("save"),
  });
  if (!name || name === p.name) return;
  await perform(async () => {
    await api(`/projects/${p.id}`, "PATCH", {
      revision: Number(p.revision),
      name,
    });
    await load();
  });
}
async function remove(p: any) {
  const ok = await askConfirm({
    title: t("deleteProject"),
    message: fmt("deleteProjectConfirm", { name: p.name }),
    confirm: t("delete"),
    danger: true,
  });
  if (!ok) return;
  await perform(async () => {
    await api(`/projects/${p.id}`, "DELETE", { revision: Number(p.revision) });
    await load();
  });
}
function actions(p: any, withOpen = false): MenuEntry[] {
  const items: MenuEntry[] = withOpen
    ? [{ label: t("openProject"), icon: "fileText", action: () => emit("open", p.id) }]
    : [];
  if (p.role === "owner") {
    if (items.length) items.push({ separator: true });
    items.push(
      { label: t("renameProject"), icon: "pencil", action: () => rename(p) },
      { separator: true },
      {
        label: t("deleteProject"),
        icon: "trash",
        danger: true,
        action: () => remove(p),
      },
    );
  }
  return items;
}
onMounted(() => void perform(load));
</script>
<template>
  <div class="projects-page">
    <header class="app-bar">
      <span class="brand"><span class="brand-mark">Q</span>qollab</span>
      <span class="spacer" />
      <UserMenu :user="user" :anonymous="anonymous" @logout="emit('logout')" />
    </header>
    <main class="projects-main">
      <p class="eyebrow">{{ t("workspaceEyebrow") }}</p>
      <div class="projects-head">
        <div>
          <h1>{{ t("projects") }}</h1>
          <p class="muted">{{ t("welcomeTitle") }}</p>
        </div>
        <span class="spacer" />
        <div class="projects-actions">
          <button type="button" class="btn" @click="zipInput?.click()">
            <Icon name="upload" />{{ t("import") }}
          </button>
          <input
            ref="zipInput"
            hidden
            type="file"
            accept=".zip"
            @change="importZip"
          />
          <button type="button" class="btn primary" @click="create">
            <Icon name="plus" />{{ t("newProject") }}
          </button>
        </div>
      </div>
      <label v-if="projects.length > 4" class="project-search">
        <Icon name="search" />
        <input
          v-model="query"
          class="input"
          type="search"
          :placeholder="t('searchProjects')"
          :aria-label="t('searchProjects')"
        />
      </label>
      <div v-if="loaded && !projects.length" class="empty-state">
        <span class="empty-icon"><Icon name="fileText" :size="24" /></span>
        <strong>{{ t("empty") }}</strong>
        <span>{{ t("emptyHint") }}</span>
        <button type="button" class="btn primary" @click="create">
          <Icon name="plus" />{{ t("newProject") }}
        </button>
      </div>
      <p v-else-if="loaded && !filtered.length" class="muted">
        {{ t("noMatch") }}
      </p>
      <ul class="project-grid">
        <li
          v-for="p in filtered"
          :key="p.id"
          class="project-card"
          @contextmenu="openContextMenu($event, actions(p, true), p.name)"
        >
          <button type="button" class="project-open" @click="emit('open', p.id)">
            <span class="project-icon"><Icon name="fileText" :size="22" /></span>
            <span class="project-name">{{ p.name }}</span>
            <span class="project-meta"
              ><span class="badge">{{ t(p.role) }}</span
              ><time :datetime="p.updated" :title="fullTime(p.updated)">{{
                fmt("editedAgo", { time: ago(p.updated) })
              }}</time></span
            >
          </button>
          <div v-if="p.role === 'owner'" class="project-menu">
            <Menu :label="t('more')" :items="actions(p)" />
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>
<style scoped>
.projects-page {
  min-height: 100dvh;
}
.app-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 clamp(16px, 4vw, 40px);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.projects-main {
  max-width: 1160px;
  margin: 0 auto;
  padding: 48px clamp(16px, 4vw, 40px) 64px;
}
.eyebrow {
  margin-bottom: 10px;
  color: var(--accent-text);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.projects-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
}
.projects-head h1 {
  margin-bottom: 6px;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.projects-head p {
  margin: 0;
  font-size: var(--text-lg);
}
.projects-actions {
  display: flex;
  gap: 8px;
}
.project-search {
  position: relative;
  display: block;
  max-width: 360px;
  margin-top: 28px;
  color: var(--text-muted);
}
.project-search svg {
  position: absolute;
  top: 9px;
  left: 10px;
}
.project-search .input {
  padding-left: 36px;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
}
.project-card {
  position: relative;
}
.project-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  min-height: 168px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    box-shadow 0.12s,
    transform 0.12s;
}
.project-open:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-2);
}
.project-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-text);
}
.project-name {
  margin-top: 8px;
  padding-right: 28px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.project-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.project-menu {
  position: absolute;
  top: 14px;
  right: 14px;
}
</style>

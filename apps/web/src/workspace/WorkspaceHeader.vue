<script setup lang="ts">
import { computed } from "vue";
import Icon from "../ui/Icon.vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import UserMenu from "../ui/UserMenu.vue";
import Avatar from "../ui/Avatar.vue";
import { t, fmt } from "../i18n";
const props = defineProps<{
  project: any;
  user: any;
  anonymous?: boolean;
  status?: { state: string; text: string };
  peers: { name: string; picture: string | null }[];
  showPdf: boolean;
  editable: boolean;
  owner: boolean;
}>();
const emit = defineEmits<{
  leave: [];
  togglePdf: [];
  share: [];
  rename: [];
  checkpoint: [];
  logout: [];
  help: [];
}>();
// One avatar per person even with several tabs open.
const others = computed(() => [
  ...new Map(props.peers.map((peer) => [peer.name, peer])).values(),
]);
const items = computed<MenuEntry[]>(() => [
  ...(props.owner
    ? [{ label: t("renameProject"), icon: "pencil" as const, action: () => emit("rename") }]
    : []),
  ...(props.editable
    ? [{ label: t("checkpoint"), icon: "flag" as const, action: () => emit("checkpoint") }]
    : []),
  { label: t("helpTitle"), icon: "help" as const, action: () => emit("help") },
  { separator: true },
  {
    label: t("export"),
    icon: "archive",
    href: `/api/projects/${props.project.id}/export`,
  },
  ...(props.project.data.pdfBuild
    ? [
        {
          label: t("downloadPdf"),
          icon: "download" as const,
          href: `/api/projects/${props.project.id}/pdf`,
          download: true,
        },
      ]
    : []),
]);
</script>
<template>
  <header class="workspace-header">
    <button
      type="button"
      class="home-button"
      :aria-label="t('back')"
      :data-tip="t('back')"
      @click="emit('leave')"
    >
      <span class="brand-mark">Q</span>
    </button>
    <nav class="crumbs" :aria-label="t('projects')">
      <button type="button" class="crumb-link" @click="emit('leave')">
        {{ t("projects") }}
      </button>
      <Icon name="chevronRight" :size="16" class="crumb-sep" />
      <h1 class="project-title">{{ project.name }}</h1>
    </nav>
    <span class="badge role-badge">{{ t(project.role) }}</span>
    <span
      v-if="status"
      :class="['save-chip', status.state]"
      role="status"
      aria-live="polite"
      :aria-label="status.text"
      ><span :class="['status-dot', status.state]" /><span class="save-text">{{
        status.text
      }}</span></span
    >
    <span class="spacer" />
    <div
      v-if="others.length"
      class="peers"
      :data-tip="others.map((p) => p.name).join(', ')"
      :aria-label="fmt('online', { n: others.length })"
      role="img"
    >
      <Avatar
        v-for="peer in others.slice(0, 3)"
        :key="peer.name"
        class="peer"
        :name="peer.name"
        :picture="peer.picture"
        :size="30"
      />
      <span v-if="others.length > 3" class="avatar peer more"
        >+{{ others.length - 3 }}</span
      >
    </div>
    <button
      type="button"
      class="btn share-button"
      :aria-label="t('share')"
      @click="emit('share')"
    >
      <Icon name="share" /><span class="label">{{ t("share") }}</span>
    </button>
    <button
      type="button"
      :class="['icon-btn', { active: showPdf }]"
      :aria-pressed="showPdf"
      :aria-label="t('pdf')"
      :data-tip="t('pdf')"
      @click="emit('togglePdf')"
    >
      <Icon name="panelRight" />
    </button>
    <Menu :label="t('more')" :items="items" />
    <UserMenu :user="user" :anonymous="anonymous" @logout="emit('logout')" />
  </header>
</template>
<style>
.workspace-header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 12px 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.home-button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}
.home-button .brand-mark {
  width: 28px;
  height: 28px;
  font-size: 21px;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.crumb-link {
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  font-size: var(--text-md);
  cursor: pointer;
  white-space: nowrap;
}
.crumb-link:hover {
  background: var(--hover);
  color: var(--text);
}
.crumb-sep {
  flex: none;
  color: var(--border-strong);
}
.project-title {
  margin: 0 0 0 4px;
  overflow: hidden;
  font-size: var(--text-lg);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.save-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.save-chip.offline,
.save-chip.stale {
  background: var(--danger-soft);
  color: var(--danger);
}
.peers {
  display: flex;
  align-items: center;
  padding-left: 6px;
}
.peers .peer {
  width: 30px;
  height: 30px;
  margin-left: -6px;
  border: 2px solid var(--surface);
}
.peers .peer.more {
  background: var(--surface-3);
  color: var(--text-2);
  font-size: var(--text-xs);
}
@media (max-width: 1100px) {
  .crumb-link,
  .crumbs .crumb-sep,
  .role-badge {
    display: none;
  }
}
@media (max-width: 800px) {
  .share-button .label,
  .peers {
    display: none;
  }
  .share-button {
    width: 32px;
    padding: 0;
  }
  .save-chip {
    width: 26px;
    padding: 0;
    justify-content: center;
  }
  .save-text {
    display: none;
  }
}
</style>

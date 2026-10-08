<script setup lang="ts">
import { ref } from "vue";
import Icon from "../ui/Icon.vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import Avatar from "../ui/Avatar.vue";
import { openContextMenu } from "../ui/context-menu";
import { useWorkspace } from "./context";
import { notify } from "../ui/feedback";
import { t } from "../i18n";
const ws = useWorkspace();
const email = ref(""),
  role = ref("editor"),
  link = ref(""),
  sending = ref(false);
async function invite() {
  if (!email.value.trim()) return;
  sending.value = true;
  try {
    const url = await ws.invite(email.value.trim(), role.value);
    if (url) {
      link.value = url;
      email.value = "";
    }
  } finally {
    sending.value = false;
  }
}
const manageable = (m: any) => ws.owner.value && m.id !== ws.user.id;
function actions(m: any): MenuEntry[] {
  return [
    {
      label: t("makeEditor"),
      icon: "pencil",
      disabled: m.role === "editor",
      action: () => ws.changeRole(m, "editor"),
    },
    {
      label: t("makeViewer"),
      icon: "users",
      disabled: m.role === "viewer",
      action: () => ws.changeRole(m, "viewer"),
    },
    {
      label: t("transfer"),
      icon: "crown",
      disabled: m.role === "owner",
      action: () => ws.changeRole(m, "owner", true),
    },
    { separator: true },
    {
      label: t("remove"),
      icon: "trash",
      danger: true,
      action: () => ws.changeRole(m, null),
    },
  ];
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    notify(t("copied"));
  } catch {
    (document.getElementById("invite-link") as HTMLInputElement)?.select();
  }
}
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("members") }}</h2>
  </div>
  <div class="panel-body scroll">
    <form v-if="ws.owner.value" class="invite-form" @submit.prevent="invite">
      <h3 class="panel-section-title">{{ t("inviteTitle") }}</h3>
      <input
        v-model="email"
        class="input"
        type="email"
        required
        :placeholder="t('email')"
        :aria-label="t('email')"
      />
      <div class="invite-row">
        <select v-model="role" class="select" :aria-label="t('role')">
          <option value="editor">{{ t("editor") }}</option>
          <option value="viewer">{{ t("viewer") }}</option>
        </select>
        <button class="btn primary" :disabled="sending || !email.trim()">
          {{ t("invite") }}
        </button>
      </div>
      <p class="field-hint">{{ t("inviteHint") }}</p>
      <div v-if="link" class="invite-link">
        <input
          id="invite-link"
          :value="link"
          class="input"
          readonly
          :aria-label="t('invite')"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <button
          type="button"
          class="icon-btn"
          :aria-label="t('copyLink')"
          :data-tip="t('copyLink')"
          @click="copy"
        >
          <Icon name="copy" />
        </button>
      </div>
    </form>
    <h3 class="panel-section-title">
      {{ t("members") }} · {{ ws.members.value.length }}
    </h3>
    <ul class="member-list">
      <li
        v-for="m in ws.members.value"
        :key="m.id"
        class="member-row"
        @contextmenu="manageable(m) && openContextMenu($event, actions(m), m.name)"
      >
        <Avatar :name="m.name" :picture="m.picture" :size="32" />
        <span class="member-text">
          <strong
            >{{ m.name }}
            <span v-if="m.id === ws.user.id" class="muted">({{ t("you") }})</span></strong
          >
          <small>{{ m.email }}</small>
        </span>
        <select
          v-if="manageable(m)"
          class="select member-role"
          :value="m.role"
          :aria-label="`${t('role')} · ${m.name}`"
          @change="ws.changeRole(m, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="r in ['owner', 'editor', 'viewer']" :key="r" :value="r">
            {{ t(r as any) }}
          </option>
        </select>
        <span v-else class="badge">{{ t(m.role) }}</span>
        <Menu
          v-if="manageable(m)"
          :label="t('more')"
          trigger-class="icon-btn sm"
          :items="actions(m)"
        />
      </li>
    </ul>
    <p v-if="ws.owner.value" class="field-hint">{{ t("roleChangeNote") }}</p>
  </div>
</template>
<style>
.invite-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}
.invite-form .panel-section-title {
  margin-top: 4px;
}
.invite-row {
  display: flex;
  gap: 8px;
}
.invite-row .select {
  flex: 1;
}
.invite-row .btn {
  height: 36px;
}
.invite-link {
  display: flex;
  gap: 4px;
}
.invite-link .input {
  font: var(--text-sm) var(--font-mono);
}
.member-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--border);
}
.member-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.member-text strong {
  overflow: hidden;
  font-size: var(--text-md);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-text small {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-role {
  width: auto;
  min-height: 30px;
  padding: 2px 24px 2px 8px;
  font-size: var(--text-sm);
}
</style>

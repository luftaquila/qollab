<script setup lang="ts">
import { ref } from "vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import Avatar from "../ui/Avatar.vue";
import { openContextMenu } from "../ui/context-menu";
import { useWorkspace } from "./context";
import { t } from "../i18n";
const ws = useWorkspace();
const email = ref(""),
  role = ref("editor"),
  sending = ref(false);
async function invite() {
  if (!email.value.trim()) return;
  sending.value = true;
  try {
    if (await ws.invite(email.value.trim(), role.value)) email.value = "";
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
      disabled: m.pending || m.role === "owner",
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
    </form>
    <h3 class="panel-section-title">
      {{ t("members") }} · {{ ws.members.value.length }}
    </h3>
    <ul class="member-list">
      <li
        v-for="m in ws.members.value"
        :key="m.id"
        class="member-row"
        @contextmenu="
          manageable(m) && openContextMenu($event, actions(m), m.name)
        "
      >
        <Avatar :name="m.name" :picture="m.picture" :size="32" />
        <span class="member-text">
          <strong :title="m.name"
            >{{ m.name }}
            <span v-if="m.id === ws.user.id" class="muted"
              >({{ t("you") }})</span
            ></strong
          >
          <small :title="m.email">{{ m.email }}</small>
        </span>
        <select
          v-if="manageable(m)"
          class="select member-role"
          :value="m.role"
          :aria-label="`${t('role')} · ${m.name}`"
          @change="ws.changeRole(m, ($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="r in m.pending
              ? ['editor', 'viewer']
              : ['owner', 'editor', 'viewer']"
            :key="r"
            :value="r"
          >
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
        <small
          v-if="m.mail"
          class="member-mail"
          :class="{ failed: m.mail.status === 'failed' }"
        >
          {{
            t(
              m.mail.status === "sent"
                ? "mailSent"
                : m.mail.status === "failed"
                  ? "mailFailed"
                  : m.mail.status === "cancelled"
                    ? "mailCancelled"
                    : "mailPending",
            )
          }}
          <button
            v-if="ws.owner.value && m.mail.status === 'failed'"
            type="button"
            class="btn sm"
            @click="ws.retryMemberMail(m)"
          >
            {{ t("retryMail") }}
          </button>
        </small>
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
.member-mail {
  grid-column: 2 / -1;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.member-mail.failed {
  color: var(--danger);
}
.member-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.member-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px 10px;
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

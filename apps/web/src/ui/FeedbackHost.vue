<script setup lang="ts">
import { ref, watch } from "vue";
import Dialog from "./Dialog.vue";
import Icon from "./Icon.vue";
import ContextMenuHost from "./ContextMenuHost.vue";
import { toasts, dismiss, ask } from "./feedback";
import { t } from "../i18n";
const draft = ref("");
watch(ask, (value) => {
  draft.value = value?.value || "";
});
function submit() {
  const current = ask.value;
  if (!current) return;
  if (current.kind === "text") {
    const value = draft.value.trim();
    if (value) current.resolve(value);
  } else current.resolve(true);
}
</script>
<template>
  <div class="toasts">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', toast.kind]"
      :role="toast.kind === 'error' ? 'alert' : 'status'"
    >
      <Icon v-if="toast.kind === 'error'" name="alert" />
      <span>{{ toast.text }}</span>
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('close')"
        @click="dismiss(toast.id)"
      >
        <Icon name="x" :size="16" />
      </button>
    </div>
  </div>
  <ContextMenuHost />
  <Dialog v-if="ask" :title="ask.title" @close="ask.resolve(null)">
    <form @submit.prevent="submit">
      <div class="modal-body">
        <p v-if="ask.message">{{ ask.message }}</p>
        <label v-if="ask.kind === 'text'" class="field"
          >{{ ask.label
          }}<input
            v-model="draft"
            class="input"
            autofocus
            spellcheck="false"
            @focus="($event.target as HTMLInputElement).select()"
          /><span v-if="ask.hint" class="field-hint">{{ ask.hint }}</span>
        </label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="ask.resolve(null)">
          {{ t("cancel") }}
        </button>
        <button
          :class="['btn', ask.danger ? 'danger' : 'primary']"
          :disabled="ask.kind === 'text' && !draft.trim()"
          :autofocus="ask.kind === 'confirm' && !ask.danger"
        >
          {{ ask.confirm }}
        </button>
      </div>
    </form>
  </Dialog>
</template>

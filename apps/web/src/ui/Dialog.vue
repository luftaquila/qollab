<script lang="ts">
// Only the top-most dialog handles Escape and focus trapping.
const stack: number[] = [];
let sequence = 0;
</script>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import Icon from "./Icon.vue";
import { t } from "../i18n";
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const id = ++sequence;
const titleId = `dialog-title-${id}`;
let previous: Element | null = null;
const focusable = () =>
  [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []),
  ].filter((e) => !e.hidden && e.offsetParent !== null);
function onKey(e: KeyboardEvent) {
  if (stack[stack.length - 1] !== id) return;
  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
  } else if (e.key === "Tab") {
    const items = focusable();
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
onMounted(async () => {
  previous = document.activeElement;
  stack.push(id);
  document.addEventListener("keydown", onKey);
  await nextTick();
  const preferred = panel.value?.querySelector<HTMLElement>("[autofocus]");
  (preferred || focusable()[1] || focusable()[0])?.focus();
});
onBeforeUnmount(() => {
  stack.splice(stack.indexOf(id), 1);
  document.removeEventListener("keydown", onKey);
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
});
</script>
<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="emit('close')">
      <div
        ref="panel"
        :class="['modal', { wide }]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header class="modal-head">
          <h2 :id="titleId">{{ title }}</h2>
          <span class="spacer" />
          <slot name="head" />
          <button
            type="button"
            class="icon-btn"
            :aria-label="t('close')"
            @click="emit('close')"
          >
            <Icon name="x" />
          </button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

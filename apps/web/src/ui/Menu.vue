<script setup lang="ts">
// Menu items keep the page's text selection (mousedown is prevented) so editor
// actions apply to what was selected when the menu opened.
import { ref, nextTick, onBeforeUnmount } from "vue";
import Icon from "./Icon.vue";
import type { IconName } from "./icons";
export interface MenuEntry {
  label?: string;
  icon?: IconName;
  /** A color dot shown instead of an icon. */
  swatch?: string;
  action?: () => unknown;
  href?: string;
  download?: boolean;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  heading?: boolean;
}
const props = withDefaults(
  defineProps<{
    items: MenuEntry[];
    label: string;
    icon?: IconName;
    triggerClass?: string;
    align?: "start" | "end";
    tip?: boolean;
    /** Context menus have no trigger button. */
    bare?: boolean;
  }>(),
  { icon: "more", triggerClass: "icon-btn", align: "end", tip: true },
);
const emit = defineEmits<{ closed: [] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const style = ref<Record<string, string>>({});
let returnFocus: Element | null = null;
function focusables() {
  return [
    ...(menu.value?.querySelectorAll<HTMLElement>(
      ".menu-item:not([disabled])",
    ) || []),
  ];
}
async function place(x: number, y: number, anchor?: DOMRect) {
  if (!open.value) returnFocus = document.activeElement;
  open.value = true;
  style.value = { top: `${y}px`, left: `${x}px`, visibility: "hidden" };
  await nextTick();
  const box = menu.value!.getBoundingClientRect();
  let left = anchor
    ? props.align === "end"
      ? anchor.right - box.width
      : anchor.left
    : x;
  let top = anchor ? anchor.bottom + 4 : y;
  if (top + box.height > innerHeight - 8)
    top = Math.max(8, (anchor ? anchor.top - 4 : y) - box.height);
  left = Math.min(Math.max(8, left), innerWidth - box.width - 8);
  style.value = { top: `${top}px`, left: `${left}px` };
  // Focus once the menu is visible; hidden elements cannot take focus.
  await nextTick();
  focusables()[0]?.focus();
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", escape, true);
  addEventListener("resize", resized);
  addEventListener("scroll", scrolled, true);
}
function toggle() {
  if (open.value) close();
  else {
    const rect = trigger.value!.getBoundingClientRect();
    void place(rect.left, rect.bottom, rect);
  }
}
/** Opens at pointer coordinates, for context menus. */
function openAt(x: number, y: number) {
  void place(x, y);
}
function close(restore = false) {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", escape, true);
  removeEventListener("resize", resized);
  removeEventListener("scroll", scrolled, true);
  const target = trigger.value || returnFocus;
  if (restore && target instanceof HTMLElement && target.isConnected)
    target.focus();
  emit("closed");
}
function escape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  close(true);
}
function resized() {
  close();
}
// Close only when the scrolled area carries the trigger away. Context menus stay
// where they opened; unrelated scrolling (e.g. images loading) must not close them.
function scrolled(e: Event) {
  const area = e.target as Node;
  if (trigger.value && area !== trigger.value && area.contains?.(trigger.value))
    close();
}
function outside(e: Event) {
  const node = e.target as Node;
  if (menu.value?.contains(node) || trigger.value?.contains(node)) return;
  close();
}
function run(item: MenuEntry) {
  close(true);
  void item.action?.();
}
function keys(e: KeyboardEvent) {
  const list = focusables(),
    index = list.indexOf(document.activeElement as HTMLElement);
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close(true);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    list[(index + step + list.length) % list.length]?.focus();
  } else if (e.key === "Home") list[0]?.focus();
  else if (e.key === "End") list[list.length - 1]?.focus();
  else if (e.key === "Tab") close(true);
}
defineExpose({ openAt, close });
onBeforeUnmount(() => close());
</script>
<template>
  <button
    v-if="!bare"
    ref="trigger"
    type="button"
    :class="triggerClass"
    :aria-label="label"
    :data-tip="tip ? label : undefined"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click.stop="toggle"
  >
    <slot><Icon :name="icon" /></slot>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="menu"
      role="menu"
      :aria-label="label"
      :style="style"
      @keydown="keys"
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.separator" class="menu-separator" role="separator" />
        <div v-else-if="item.heading" class="menu-label">{{ item.label }}</div>
        <a
          v-else-if="item.href"
          class="menu-item"
          role="menuitem"
          :href="item.href"
          :download="item.download ? '' : undefined"
          @mousedown.prevent
          @click="close(true)"
          ><Icon v-if="item.icon" :name="item.icon" />{{ item.label }}</a
        >
        <button
          v-else
          type="button"
          role="menuitem"
          :class="['menu-item', { danger: item.danger, checked: item.checked }]"
          :disabled="item.disabled"
          @mousedown.prevent
          @click="run(item)"
        >
          <span
            v-if="item.swatch"
            class="menu-swatch"
            :style="{ background: item.swatch }"
            aria-hidden="true"
          />
          <Icon v-else-if="item.icon" :name="item.icon" />
          <span class="spacer" style="text-align: left">{{ item.label }}</span>
          <Icon v-if="item.checked" name="check" :size="16" />
        </button>
      </template>
    </div>
  </Teleport>
</template>

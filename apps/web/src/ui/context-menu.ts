import { shallowRef } from "vue";
import type { MenuEntry } from "./Menu.vue";
import { t } from "../i18n";
export interface ContextMenuRequest {
  x: number;
  y: number;
  items: MenuEntry[];
  label: string;
}
export const contextMenu = shallowRef<ContextMenuRequest | null>(null);
/** Shows a menu at the pointer, or below the element for the keyboard menu key. */
export function openContextMenu(
  event: MouseEvent,
  items: MenuEntry[],
  label: string = t("more"),
) {
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  let { clientX: x, clientY: y } = event;
  if (!x && !y && event.currentTarget instanceof Element) {
    const rect = event.currentTarget.getBoundingClientRect();
    x = rect.left + 16;
    y = rect.bottom;
  }
  openMenuAt(x, y, items, label);
}
export function openMenuAt(x: number, y: number, items: MenuEntry[], label: string) {
  contextMenu.value = { x, y, items, label };
}

import { reactive, shallowRef } from "vue";
import { errorText } from "../i18n";
export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}
export const toasts = reactive<Toast[]>([]);
let sequence = 0;
export function dismiss(id: number) {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
/** Errors stay until dismissed. A newer error replaces the previous one. */
export function notify(text: string, kind: Toast["kind"] = "info") {
  if (kind === "error")
    for (const toast of toasts.filter((toast) => toast.kind === "error"))
      dismiss(toast.id);
  const id = ++sequence;
  toasts.push({ id, text, kind });
  if (kind === "info") setTimeout(() => dismiss(id), 3500);
  return id;
}
export function fail(error: any) {
  notify(
    errorText(
      typeof error === "string"
        ? error
        : error?.code || error?.message || "NETWORK",
    ),
    "error",
  );
}
export async function perform<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    fail(e);
    return undefined;
  }
}

export interface Ask {
  kind: "text" | "confirm";
  title: string;
  message?: string;
  label?: string;
  hint?: string;
  value?: string;
  confirm: string;
  danger?: boolean;
  resolve: (value: any) => void;
}
export const ask = shallowRef<Ask | null>(null);
function open<T>(request: Omit<Ask, "resolve">) {
  ask.value?.resolve(null);
  return new Promise<T>((resolve) => {
    ask.value = {
      ...request,
      resolve: (value: T) => {
        ask.value = null;
        resolve(value);
      },
    };
  });
}
/** In-page replacement for window.prompt. Resolves null when cancelled. */
export function askText(request: {
  title: string;
  label: string;
  value?: string;
  hint?: string;
  confirm: string;
}) {
  return open<string | null>({ kind: "text", ...request });
}
export async function askConfirm(request: {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
}) {
  return !!(await open<boolean | null>({ kind: "confirm", ...request }));
}

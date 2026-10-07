import { $view } from "@milkdown/kit/utils";
import {
  imageBlockSchema,
  imageBlockConfig,
} from "@milkdown/kit/component/image-block";
import { NodeSelection } from "@milkdown/kit/prose/state";
import { imageWidth } from "../../../packages/codec/src/image";
import { t } from "./i18n";

/** Quarto widths are the authoritative visual size, including drag and undo. */
export const quartoImageView = $view(imageBlockSchema.node, (ctx) => {
  const config = ctx.get(imageBlockConfig.key);
  return (initial, view, getPos) => {
    let node = initial,
      disposed = false,
      dragging = false,
      percent = 100;
    const dom = document.createElement("div");
    dom.className = "qollab-image-block";
    dom.contentEditable = "false";
    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";
    const img = document.createElement("img");
    img.draggable = false;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "image-resize-handle";
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", t("resizeImage"));
    handle.setAttribute("aria-valuemin", "5");
    handle.setAttribute("aria-valuemax", "100");
    const caption = document.createElement("input");
    caption.className = "caption-input";
    caption.placeholder = t("caption");
    caption.setAttribute("aria-label", t("caption"));
    const upload = document.createElement("button");
    upload.type = "button";
    upload.textContent = t("upload");
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/png,image/jpeg";
    picker.hidden = true;
    wrapper.append(img, handle);
    dom.append(wrapper, caption, upload, picker);
    function commit(attrs: Record<string, unknown>) {
      const pos = getPos();
      if (disposed || !view.editable || pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (current?.type !== initial.type) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          qollabId: current.attrs.qollabId || "image-" + crypto.randomUUID(),
          ...attrs,
        }),
      );
    }
    function select() {
      const pos = getPos();
      if (pos == null || disposed) return;
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
      );
    }
    function sync() {
      const src = String(node.attrs.src || "");
      if (src !== img.dataset.source) {
        img.dataset.source = src;
        Promise.resolve(config.proxyDomURL ? config.proxyDomURL(src) : src)
          .then((url) => {
            if (!disposed && img.dataset.source === src && src) img.src = url;
          })
          .catch(() => {});
      }
      img.alt = String(node.attrs.alt || node.attrs.caption || "");
      wrapper.hidden = !src;
      if (src) picker.remove();
      else if (picker.parentNode !== dom) dom.append(picker);
      upload.hidden = !!src;
      upload.disabled = !view.editable;
      caption.hidden = !src;
      caption.readOnly = !view.editable;
      handle.disabled = !view.editable;
      if (document.activeElement !== caption)
        caption.value = String(node.attrs.caption || "");
      if (!dragging)
        wrapper.style.width = imageWidth(node.attrs) || "fit-content";
      img.style.width = imageWidth(node.attrs) ? "100%" : "auto";
      wrapper.style.marginLeft = node.attrs.align === "left" ? "0" : "auto";
      wrapper.style.marginRight = node.attrs.align === "right" ? "0" : "auto";
      const width = dom.getBoundingClientRect().width;
      if (width)
        percent =
          Math.round((wrapper.getBoundingClientRect().width / width) * 10000) /
          100;
      handle.setAttribute("aria-valuenow", String(percent));
      handle.setAttribute("aria-valuetext", `${percent}%`);
    }
    const cleanDrag = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    let startX = 0,
      startWidth = 0,
      containerWidth = 0;
    function move(e: PointerEvent) {
      if (!dragging) return;
      e.preventDefault();
      percent = Math.max(
        5,
        Math.min(
          100,
          Math.round(
            ((startWidth + e.clientX - startX) / containerWidth) * 10000,
          ) / 100,
        ),
      );
      wrapper.style.width = `${percent}%`;
      img.style.width = "100%";
      handle.setAttribute("aria-valuenow", String(percent));
      handle.setAttribute("aria-valuetext", `${percent}%`);
    }
    function finish() {
      cleanDrag();
      commit({ width: `${percent}%`, ratio: 1 });
      view.focus();
    }
    function cancel() {
      cleanDrag();
      sync();
    }
    handle.onpointerdown = (e) => {
      if (!view.editable) return;
      e.preventDefault();
      e.stopPropagation();
      select();
      startX = e.clientX;
      startWidth = wrapper.getBoundingClientRect().width;
      containerWidth = dom.getBoundingClientRect().width;
      if (!containerWidth) return;
      dragging = true;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    };
    handle.onkeydown = (e) => {
      if (
        !view.editable ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
      )
        return;
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 5
          : e.key === "End"
            ? 100
            : percent + (e.key === "ArrowLeft" ? -5 : 5);
      commit({ width: `${Math.max(5, Math.min(100, next))}%`, ratio: 1 });
    };
    img.onclick = () => {
      select();
      view.focus();
    };
    img.onload = sync;
    caption.oninput = () => commit({ caption: caption.value });
    caption.onblur = () =>
      queueMicrotask(() => {
        if (!disposed) sync();
      });
    upload.onclick = () => picker.click();
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file || !view.editable) return;
      upload.disabled = true;
      try {
        commit({ src: await config.onUpload(file), width: "80%", ratio: 1 });
      } catch {
        /* The upload adapter reports the error; no broken URL is saved. */
      } finally {
        if (!disposed) {
          picker.value = "";
          upload.disabled = !view.editable;
        }
      }
    };
    sync();
    return {
      dom,
      update(next) {
        if (next.type !== initial.type) return false;
        node = next;
        sync();
        return true;
      },
      selectNode() {
        dom.classList.add("selected");
      },
      deselectNode() {
        dom.classList.remove("selected");
      },
      stopEvent(e) {
        return (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLButtonElement
        );
      },
      ignoreMutation: () => true,
      destroy() {
        disposed = true;
        cleanDrag();
      },
    };
  };
});

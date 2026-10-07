import { JSDOM } from "jsdom";
import * as Y from "yjs";
import {
  prosemirrorToYDoc,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import {
  decode,
  encode,
  validateDocument,
  type CodecRuntime,
  type Preservation,
} from "../../../packages/codec/src/index.js";
const dom = new JSDOM(
  '<!doctype html><html><body><div id="editor"></div></body></html>',
  { pretendToBeVisual: true },
);
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "MutationObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as any)[name],
    configurable: true,
    writable: true,
  });
}
for (const name of ["addEventListener", "removeEventListener", "dispatchEvent"])
  (globalThis as any)[name] = (dom.window as any)[name].bind(dom.window);
(globalThis as any).CustomEvent = dom.window.CustomEvent;
(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
let runtime: CodecRuntime;
export async function initCodec() {
  if (runtime) return runtime;
  const [
    { CrepeBuilder },
    { codeMirror },
    { latex },
    { imageBlock },
    core,
    schema,
  ] = await Promise.all([
    import("@milkdown/crepe/builder"),
    import("@milkdown/crepe/feature/code-mirror"),
    import("@milkdown/crepe/feature/latex"),
    import("@milkdown/crepe/feature/image-block"),
    import("@milkdown/kit/core"),
    import("../../../packages/codec/src/schema.js"),
  ]);
  const builder = new CrepeBuilder({
    root: document.querySelector("#editor")!,
  });
  builder
    .addFeature(codeMirror, { languages: [] })
    .addFeature(latex)
    .addFeature(imageBlock);
  builder.editor
    .use(schema.rawNode)
    .use(schema.imageAttributes)
    .use(schema.sourceIds);
  await builder.create();
  runtime = builder.editor.action((ctx) => ({
    schema: ctx.get(core.schemaCtx),
    parse: ctx.get(core.parserCtx),
    serialize: ctx.get(core.serializerCtx),
  }));
  return runtime;
}
export function initialize(source: string) {
  const decoded = decode(source, runtime);
  const doc = prosemirrorToYDoc(decoded.doc);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  doc.destroy();
  return {
    state,
    preservation: decoded.preservation,
    mode: decoded.safe ? ("visual" as const) : ("raw" as const),
    reason: decoded.reason,
  };
}
export function updateDocument(
  state: string,
  update: Uint8Array,
  preservation: Preservation,
) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(state, "base64"));
    Y.applyUpdate(doc, update);
    if ([...doc.share.keys()].some((key) => key !== "prosemirror"))
      throw new Error("INVALID_ROOT");
    const pm = yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment("prosemirror"),
      runtime.schema,
    );
    validateDocument(pm);
    const source = encode(pm, preservation, runtime);
    const parsed = decode(source, runtime);
    if (!parsed.safe) throw new Error("UNSAFE_BOUNDARY");
    return {
      source,
      state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
    };
  } finally {
    doc.destroy();
  }
}
export function getRuntime() {
  return runtime;
}

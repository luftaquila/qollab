import { $node } from "@milkdown/kit/utils";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
export const rawNode = $node("qollab_raw", () => ({
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: "pre[data-qollab-raw]" }],
  toDOM: () => [
    "pre",
    { "data-qollab-raw": "true", class: "qollab-raw", spellcheck: "false" },
    ["code", 0],
  ],
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: (n) => n.type.name === "qollab_raw",
    runner: (state, node) => {
      state.addNode("code", undefined, node.textContent, {
        lang: "quarto-source",
      });
    },
  },
}));
export const imageAttributes = imageBlockSchema.extendSchema(
  (prev) => (ctx) => {
    const schema = prev(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        alt: { default: "" },
        width: { default: "" },
        align: { default: "" },
        identifier: { default: "" },
      },
    };
  },
);

import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { createTimer } from "@milkdown/kit/ctx";
import { nodesCtx, schemaTimerCtx, InitReady } from "@milkdown/kit/core";
const SourceIdsReady = createTimer("QollabSourceIdsReady");
// IDs are part of both schemas and therefore survive Yjs updates. Identical
// paragraphs with different original spelling never borrow each other's source.
export const sourceIds: MilkdownPlugin = (ctx) => {
  ctx.record(SourceIdsReady);
  ctx.update(schemaTimerCtx, (timers) => [...timers, SourceIdsReady]);
  return async () => {
    await ctx.wait(InitReady);
    ctx.update(nodesCtx, (nodes) =>
      nodes.map(([name, spec]) => [
        name,
        spec.group?.split(" ").includes("block")
          ? {
              ...spec,
              attrs: {
                ...spec.attrs,
                qollabId: { default: null, validate: "string|null" },
              },
            }
          : spec,
      ]),
    );
    ctx.done(SourceIdsReady);
    return () => {
      ctx.clearTimer(SourceIdsReady);
    };
  };
};

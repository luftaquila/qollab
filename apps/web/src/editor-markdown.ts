import { $inputRule, $prose } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Plugin } from "@milkdown/kit/prose/state";
import { parserCtx } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";

// Heading prefixes mean an absolute level, including inside an existing heading.
// Preserve source identity and labels when changing the block's type.
export const markdownHeading = $inputRule(
  () =>
    new InputRule(/^(#{1,6}) $/, (state, match, start, end) => {
      const parent = state.selection.$from.parent;
      if (!["paragraph", "heading"].includes(parent.type.name)) return null;
      return state.tr
        .delete(start, end)
        .setBlockType(start, start, state.schema.nodes.heading, {
          ...parent.attrs,
          level: match[1].length,
        });
    }),
);

// Enter after a fence is the common Markdown workflow. The upstream rule only
// triggers on a trailing space. Never interpret code/raw blocks or IME Enter.
export const markdownInput = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.isComposing ||
            view.composing ||
            !view.editable
          )
            return false;
          const { $from, empty } = view.state.selection;
          if (!empty || $from.parent.type.name !== "paragraph") return false;
          const match = /^(`{3,}|~{3,})([\w+-]*)$/.exec(
            $from.parent.textContent,
          );
          if (!match || $from.parentOffset !== $from.parent.content.size)
            return false;
          view.dispatch(
            view.state.tr
              .delete($from.start(), $from.end())
              .setBlockType(
                $from.start(),
                $from.start(),
                view.state.schema.nodes.code_block,
                { ...$from.parent.attrs, language: match[2] },
              ),
          );
          return true;
        },
        handlePaste(view, event) {
          if (
            !view.editable ||
            view.composing ||
            view.state.selection.$from.parent.type.spec.code
          )
            return false;
          const data = event.clipboardData;
          if (!data || data.files.length || data.getData("text/html"))
            return false;
          const text = data.getData("text/plain");
          if (
            !/(^|\n)(?:#{1,6} |[-*+] |\d+[.)] |>|```|~~~|\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(
              text,
            )
          )
            return false;
          // Quarto and YAML must continue through the source-preserving codec.
          if (/^---\r?\n|(^|\n):::/m.test(text)) return false;
          try {
            const doc = ctx.get(parserCtx)(text);
            view.dispatch(
              view.state.tr
                .replaceSelection(new Slice(doc.content, 0, 0))
                .scrollIntoView(),
            );
            return true;
          } catch {
            return false;
          }
        },
      },
    }),
);

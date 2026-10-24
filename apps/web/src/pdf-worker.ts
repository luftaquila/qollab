/// <reference lib="webworker" />
import { unzipSync } from "fflate";
// The package's browser entry assumes a WASM bundler plugin; use its core with
// our pinned, same-origin WASM asset instead.
// @ts-expect-error The upstream core has no TypeScript declaration.
import { createPandocInstance } from "../../../node_modules/pandoc-wasm/src/core.js";
import initTypst, {
  TypstCompilerBuilder,
} from "@myriaddreamin/typst-ts-web-compiler";
import { preparePdf, resolvePath } from "./pdf-source";
import type { Numbering } from "../../../packages/codec/src/numbering";
import { verifyPdfAssets } from "./pdf-cache";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const initPandoc = createPandocInstance as (bytes: ArrayBuffer) => Promise<{
  convert: (
    options: unknown,
    source: string,
    files: unknown,
  ) => Promise<{ stdout: string; stderr: string }>;
}>;
scope.onmessage = async (
  event: MessageEvent<{
    zip: ArrayBuffer;
    target: string;
    overrides: Record<string, string>;
    numbering?: Numbering;
    assets?: Record<string, string>;
  }>,
) => {
  try {
    const { zip, target, overrides, numbering, assets = {} } = event.data;
    const files = unzipSync(new Uint8Array(zip));
    for (const [path, source] of Object.entries(overrides))
      files[path] = new TextEncoder().encode(source);
    const cacheable = await verifyPdfAssets(files, assets);
    const prepared = preparePdf(files, target, numbering);
    const [pandoc, compilerBytes, fonts] = await Promise.all([
      fetch("/pdf-assets/pandoc.wasm")
        .then((r) => {
          if (!r.ok) throw new Error("Pandoc engine unavailable");
          return r.arrayBuffer();
        })
        .then((bytes) => initPandoc(bytes)),
      fetch("/pdf-assets/typst.wasm").then((r) => {
        if (!r.ok) throw new Error("Typst engine unavailable");
        return r.arrayBuffer();
      }),
      Promise.all(
        prepared.fonts.map(async (n) => {
          const r = await fetch("/pdf-assets/" + n);
          if (!r.ok) throw new Error("Missing font: " + n);
          return new Uint8Array(await r.arrayBuffer());
        }),
      ),
    ]);
    const converted = await pandoc.convert(
      prepared.options,
      prepared.body,
      prepared.inputs,
    );
    if (!converted.stdout || /(^|\n)ERROR:/.test(converted.stderr))
      throw new Error(converted.stderr || "Document conversion failed");
    // Preserve uploads named .jpg that actually contain PNGs, as render.py does.
    const typst = converted.stdout
      .replace(
        /\bimage\(("(?:\\.|[^"\\])*")\s*,/g,
        (whole: string, quoted: string) => {
          const path = resolvePath(target, JSON.parse(quoted));
          const data = files[path];
          return data?.[0] === 137 ? `image(${quoted}, format: "png",` : whole;
        },
      )
      .replace(
        "block(fill: bgcolor, blocks)",
        "block(fill: bgcolor, width: 100%, inset: 8pt, radius: 2pt, blocks)",
      );
    await initTypst({ module_or_path: compilerBytes });
    const builder = new TypstCompilerBuilder();
    for (const font of fonts) await builder.add_raw_font(font);
    const compiler = await builder.build();
    for (const [path, bytes] of Object.entries(files))
      compiler.map_shadow("/" + path, bytes);
    for (const [path, bytes] of Object.entries(prepared.assets))
      compiler.map_shadow("/" + path, bytes);
    const main = "/" + target.replace(/\.[^.]+$/, ".qollab-preview.typ");
    compiler.add_source(main, typst);
    const world = compiler.snapshot("/", main);
    const result = world.get_artifact(1, 2);
    if (!result.result)
      throw new Error(
        result.diagnostics?.join("\n") || "PDF compilation failed",
      );
    const bytes = Uint8Array.from(result.result).buffer;
    scope.postMessage({ bytes, cacheable }, [bytes]);
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
